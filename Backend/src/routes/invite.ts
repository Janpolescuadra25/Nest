import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import path from 'path';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import { hashToken } from '../lib/encryption';
import jwt, { SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { AppError, asyncHandler } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { authLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { validateInviteLink, InviteError } from '../utils/invite.utils';
import { logAction } from '../middleware/audit';
import { getPermissionDefaults } from '../middleware/permissions';
import { sendVerificationEmail } from '../lib/email';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// Inline Zod schema for signup via invite (do NOT modify validators.ts)
const signupViaInviteSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// ── POST /api/invite/signup/:token  (Public — signup via invite) ──────────────
// MUST be registered BEFORE GET /:token to prevent Express matching "signup" as a token
router.post('/signup/:token', authLimiter, validate(signupViaInviteSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const tokenParam = String(req.params.token || '').trim();
    if (!tokenParam) {
      throw new AppError('Invite token is required.', 400);
    }

    // Validate invite link using shared utility
    let invite;
    try {
      invite = await validateInviteLink(tokenParam);
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof InviteError) {
        const statusMap: Record<string, number> = {
          NOT_FOUND: 404,
          EXPIRED: 410,
          MAX_USES_REACHED: 410,
          ALREADY_USED: 410,
        };
        throw new AppError(err.message, statusMap[err.code] ?? 400);
      }
      throw err;
    }

    // Normalize email
    const email = req.body.email.toLowerCase().trim();

    // Check email uniqueness
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError('An account with this email already exists.', 409);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(req.body.password, 12);

    // Determine status and adminId based on creator role
    const isOwnerInvite = invite.creator.role === 'OWNER';
    const status = isOwnerInvite ? 'ACTIVE' : 'PENDING_APPROVAL';
    const adminId = invite.creator.role === 'ADMIN' ? invite.createdBy : null;

    // Create user + increment invite in a transaction (atomic)
    const role = invite.roleHint ?? 'VIEWER';
    const perms = getPermissionDefaults(role as UserRole);
    let emailResult: { success: boolean; error?: string } | undefined;
    const result = await prisma.$transaction(async (tx) => {
      // Re-check capacity at consumption time
      const creator = invite.creator;
      const teamLeadId = creator.adminId ?? creator.id;
      const teamLead = await tx.user.findUnique({ where: { id: teamLeadId } });
      if (teamLead) {
        if (teamLead.subscriptionSource === 'stripe' && teamLead.currentPlan) {
          const currentCount = await tx.user.count({ where: { adminId: teamLeadId } });
          const maxUsers = teamLead.maxUsers ?? 1;
          if (currentCount >= maxUsers) {
            throw new AppError('This team has reached its user limit. Please upgrade your plan.', 403);
          }
        }
      }

      const user = await tx.user.create({
        data: {
          name: req.body.name,
          email,
          password: hashedPassword,
          role,
          status,
          adminId,
          managedById: invite.createdBy,
          invitedById: invite.createdBy,
          approvedAt: isOwnerInvite ? new Date() : null,
          approvedById: isOwnerInvite ? invite.createdBy : null,
          mustChangePassword: false,
          permissions: perms,
          maxStorageBytes: invite.maxStorageBytes ?? null,
        },
      });

      // Increment invite useCount, set usedAt if maxUses reached
      const newCount = invite.useCount + 1;
      await tx.inviteLink.update({
        where: { token: invite.token },
        data: {
          useCount: newCount,
          ...(newCount >= invite.maxUses ? { usedAt: new Date() } : {}),
        },
      });

      return user;
    });

    try {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.$transaction([
        prisma.emailVerificationToken.deleteMany({ where: { userId: result.id } }),
        prisma.emailVerificationToken.create({ data: { userId: result.id, token: hashToken(verificationToken), expiresAt } }),
      ]);
      emailResult = await sendVerificationEmail({
        to: result.email,
        name: result.name,
        verificationLink: `${process.env.APP_URL}/api/email-verification/verify/${verificationToken}`,
      });
      if (!emailResult.success) {
        console.error('[Invite] Verification email failed:', emailResult.error);
      }
    } catch (emailErr) {
      console.error('[Invite] signup setup error:', emailErr);
    }

    // Log audit actions
    await logAction({
      actorId: invite.createdBy,
      action: 'USER_CREATED',
      targetUserId: result.id,
      details: { method: 'invite', roleHint: invite.roleHint, inviteId: invite.id, status },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    await logAction({
      actorId: invite.createdBy,
      action: 'INVITE_USED',
      targetUserId: result.id,
      details: { inviteId: invite.id },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Generate JWT — same pattern as auth.ts
    const jwtExpiresIn = process.env.JWT_EXPIRES_IN ?? '7d';
    const token = jwt.sign(
      { sub: result.id },
      JWT_SECRET,
      { expiresIn: jwtExpiresIn as SignOptions['expiresIn'] },
    );

    // Return response matching login response shape exactly
    return res.status(201).json({
      token,
      user: {
        id: result.id,
        email: result.email,
        name: result.name,
        role: result.role,
        status: result.status,
        emailVerified: result.emailVerified,
        mustChangePassword: result.mustChangePassword,
        permissions: result.permissions as Record<string, boolean> | null,
      },
      emailWarning: !emailResult?.success ? 'Account created but verification email failed. Please request a new verification link from Settings.' : undefined,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Invite] signupViaInvite error:', err);
    throw new AppError('Internal server error.', 500);
  }
}));

// ── GET /api/invite/:token  (Public — view invite details) ───────────────────
router.get('/:token', authLimiter, asyncHandler(async (req: Request, res: Response) => {
  const wantsHtml = req.headers.accept?.includes('text/html') &&
                    !req.headers.accept?.includes('application/json');
  if (wantsHtml) {
    return res.sendFile(path.join(__dirname, '../../public/invite/index.html'));
  }
  try {
    const tokenParam = String(req.params.token || '').trim();
    if (!tokenParam) {
      throw new AppError('Invite token is required.', 400);
    }

    // Validate invite link using shared utility
    let invite;
    try {
      invite = await validateInviteLink(tokenParam);
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof InviteError) {
        const statusMap: Record<string, number> = {
          NOT_FOUND: 404,
          EXPIRED: 410,
          MAX_USES_REACHED: 410,
          ALREADY_USED: 410,
        };
        throw new AppError(err.message, statusMap[err.code] ?? 400);
      }
      throw err;
    }

    // Compute isActive
    const isActive = new Date() <= invite.expiresAt && invite.useCount < invite.maxUses;

    // Get creator name only (do NOT expose email, id, or other PII on public endpoint)
    const creator = await prisma.user.findUnique({
      where: { id: invite.createdBy },
      select: { name: true },
    });

    return res.json({
      invite: {
        id: invite.id,
        roleHint: invite.roleHint,
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
        useCount: invite.useCount,
        creatorName: creator?.name ?? null,
        isActive,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Invite] getInvite error:', err);
    throw new AppError('Internal server error.', 500);
  }
}));

export default router;
