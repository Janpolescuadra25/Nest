import { Router, Response } from 'express';
import { AppError, asyncHandler } from '../lib/errors';
import bcrypt from 'bcryptjs';
import { UserRole, UserStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'Admin' });
import { requireCapacity } from '../middleware/capacity';
import { prisma } from '../lib/prisma';
import { sendTeamChangeAlert, sendWelcomeEmail, sendTrialRenewed } from '../lib/email';
import { validate } from '../middleware/validate';
import { teamInviteSchema, patchTeamMemberSchema, inviteLinkSchema, teamAllocationSchema } from '../lib/validators';
import { parsePagination, buildPaginationMeta } from '../lib/pagination';
import { logAction } from '../middleware/audit';
import { createInviteLink } from '../utils/invite.utils';
import { enforceEffectiveRole, UserForAccess, EffectiveAccess, getEffectiveAccess } from '../middleware/effective-role';
import { ALL_FEATURES, ALL_ACTIONS, getPermissionDefaults } from '../middleware/permissions';
import { mergePermissions } from '../lib/permission-utils';

const router = Router();

async function maybeSendTeamChangeAlert(params: {
  userId: string;
  to: string;
  name: string | null;
  memberName: string | null;
  memberEmail: string;
  action: 'joined' | 'removed';
}): Promise<void> {
  const prefs = await prisma.notificationPreference.findUnique({ where: { userId: params.userId } });
  if (prefs && !prefs.teamChangeAlerts) return;

  const result = await sendTeamChangeAlert({
    to: params.to,
    name: params.name ?? params.to,
    memberName: params.memberName ?? params.memberEmail,
    memberEmail: params.memberEmail,
    action: params.action,
  });
  if (!result.success) {
    log.error({ error: result.error }, 'sendTeamChangeAlert failed');
  }
}

function buildUserForAccess(user: {
  role: string;
  status: string;
  blocked: boolean;
  timeBombAt: Date | string | null;
  gracePeriodHours: number;
  permissions: unknown;
}): UserForAccess {
  return {
    role: user.role as UserRole,
    status: user.status as UserStatus,
    blocked: user.blocked,
    timeBombAt: user.timeBombAt,
    gracePeriodHours: user.gracePeriodHours,
    permissions: user.permissions,
  };
}

// All admin routes require authentication + at least OWNER, ADMIN, or MANAGER role
router.use(authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'));
router.use(enforceEffectiveRole);  // defense-in-depth: blocks TIME_BOMBED/BLOCKED/PENDING_APPROVAL writes

// ── GET /api/admin/team  (ADMIN only) ─────────────────────────────────────────
router.get('/team', requireRole('ADMIN', 'MANAGER'), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip, take } = parsePagination(req.query);
    const where = { adminId: req.user!.userId };
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          permissions: true,
          trialExpiresAt: true,
          customExpiryMessage: true,
          mustChangePassword: true,
          createdAt: true,
          timeBombAt: true,
          gracePeriodHours: true,
          allocatedScans: true,
          allocatedLocations: true,
          allocatedTemplates: true,
          admin: {
            select: {
              subscriptionSource: true,
              currentPlan: true,
              currentPeriodEnd: true,
              cancelAtPeriodEnd: true,
              paymentIssue: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take,
      }),
    ]);
    return res.json({ users, pagination: buildPaginationMeta(total, page, limit) });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'getTeam error');
    throw new AppError('Internal server error.', 500);
  }
}))

// ── GET /api/admin/stats  (ADMIN only) ───────────────────────────────────────
router.get('/stats', requireRole('ADMIN', 'MANAGER'), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const adminId = req.user!.userId;
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const [teamSize, maxUsersValue, totalScans, totalSynced, totalFailed, expiringSoon, totalPending] = await Promise.all([
      prisma.user.count({ where: { adminId } }),
      prisma.user.findUnique({ where: { id: adminId }, select: { maxUsers: true } }),
      prisma.scanRecord.count({ where: { location: { adminId } } }),
      prisma.syncLog.count({ where: { status: 'SUCCESS', scanRecord: { location: { adminId } } } }),
      prisma.syncLog.count({ where: { status: 'FAILED', scanRecord: { location: { adminId } } } }),
      prisma.user.count({
        where: {
          adminId,
          status: 'ACTIVE',
          trialExpiresAt: {
            gte: now,
            lte: threeDaysFromNow,
          },
        },
      }),
      prisma.scanRecord.count({
        where: {
          location: { adminId },
          status: { in: ['PENDING', 'MAPPED'] },
        },
      }),
    ]);

    return res.json({
      teamSize,
      maxUsers: maxUsersValue?.maxUsers ?? 0,
      totalScans,
      totalSynced,
      totalFailed,
      expiringSoon,
      totalPending,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'stats error');
    throw new AppError('Internal server error.', 500);
  }
}))

// ── GET /api/admin/audit-log  (ADMIN only) ───────────────────────────────────
router.get('/audit-log', requireRole('ADMIN'), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const adminId = req.user!.userId;
    const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '10'), 10) || 10));

    const teamMembers = await prisma.user.findMany({
      where: { adminId },
      select: { id: true },
    });
    const actorIds = [adminId, ...teamMembers.map(member => member.id)];

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: { actorId: { in: actorIds } },
        include: {
          actor: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where: { actorId: { in: actorIds } } }),
    ]);

    return res.json({ logs, total, page, limit });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'audit-log error');
    throw new AppError('Internal server error.', 500);
  }
}))

// ── POST /api/admin/team/invite  (ADMIN only) ─────────────────────────────────
router.post('/team/invite', requireRole('ADMIN', 'MANAGER'), requireCapacity('user'), validate(teamInviteSchema), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const { email, role, name, trialDays, customExpiryMessage } = req.body as { email?: string; role?: string; name?: string; trialDays?: number; customExpiryMessage?: string };

    const adminUser = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { subscriptionSource: true } });
    if (adminUser?.subscriptionSource === 'stripe' && (trialDays || customExpiryMessage)) {
      throw new AppError('Stripe subscribers cannot set trial expiry on invites. Manage your subscription through Stripe billing.', 403);
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError('Valid email is required.', 400);
    }
    const validRoles = ['STAFF', 'ACCOUNTANT', 'VIEWER', 'MANAGER'];
    if (!role || !validRoles.includes(role)) {
      throw new AppError('Role must be one of: STAFF, ACCOUNTANT, VIEWER, MANAGER.', 400);
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new AppError('A user with this email already exists.', 409);

    const perms = getPermissionDefaults(role as UserRole);

    const tempPassword = randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const trialExpiresAt = trialDays ? new Date(Date.now() + trialDays * 86_400_000) : undefined;

    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name?.trim() ?? null,
        password: hashedPassword,
        role: role as 'STAFF' | 'ACCOUNTANT' | 'VIEWER',
        adminId: req.user!.userId,
        managedById: req.user!.userId,
        status: 'ACTIVE',
        mustChangePassword: true,
        ...(trialExpiresAt !== undefined && { trialExpiresAt }),
        ...(customExpiryMessage ? { customExpiryMessage: customExpiryMessage.trim() } : {}),
        permissions: perms,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        action: 'USER_INVITED',
        targetUserId: newUser.id,
        details: { role, email: normalizedEmail },
      },
    });

    const emailResult = await sendWelcomeEmail({ to: newUser.email, name: newUser.name, tempPassword });

    await maybeSendTeamChangeAlert({
      userId: req.user!.userId,
      to: req.user!.email,
      name: req.user!.name ?? req.user!.email,
      memberName: newUser.name ?? newUser.email,
      memberEmail: newUser.email,
      action: 'joined',
    });

    return res.status(201).json({
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role, adminId: newUser.adminId },
      tempPassword,
      emailWarning: !emailResult.success ? 'Account created but welcome email failed to send. Please share the temporary password manually.' : undefined,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'inviteTeamMember error');
    throw new AppError('Internal server error.', 500);
  }
}))

// ── POST /api/admin/invite  (OWNER + ADMIN) ──────────────────────────────────
router.post('/invite', validate(inviteLinkSchema), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const { roleHint, expiresInHours, maxUses, maxStorageBytes, maxScans, maxLocations } = req.body as {
      roleHint?: string;
      expiresInHours?: number;
      maxUses?: number;
      maxStorageBytes?: number | null;
      maxScans?: number | null;
      maxLocations?: number | null;
    };

    // Role hint restrictions based on caller role
    const validAdminRoles: string[] = ['STAFF', 'VIEWER', 'ACCOUNTANT', 'MANAGER'];
    const validOwnerRoles: string[] = ['STAFF', 'VIEWER', 'ACCOUNTANT', 'ADMIN', 'MANAGER'];
    const allRoles = Object.values(UserRole) as string[];

    if (roleHint && !allRoles.includes(roleHint)) {
      throw new AppError('Invalid role hint.', 400);
    }

    const isOwner = req.user!.role === 'OWNER';
    const allowedRoles = isOwner ? validOwnerRoles : validAdminRoles;
    const resolvedRoleHint = (roleHint && allowedRoles.includes(roleHint) ? roleHint : 'VIEWER') as UserRole;

    if (isOwner && roleHint && roleHint !== 'ADMIN') {
      throw new AppError('Owners can only create admin invite links', 400);
    }

    if (isOwner && (maxScans !== undefined || maxLocations !== undefined)) {
      throw new AppError('Owners can only set storage limits on invite links', 400);
    }

    const effectiveRole = isOwner ? 'ADMIN' : resolvedRoleHint;

    if (roleHint && !allowedRoles.includes(roleHint)) {
      throw new AppError('Cannot invite users with admin role.', 400);
    }

    // ExpiresInHours bounds: > 0 and <= 720
    const hours = expiresInHours ?? 72;
    if (hours <= 0 || hours > 720) {
      throw new AppError('expiresInHours must be between 1 and 720.', 400);
    }

    // MaxUses bounds: > 0 and <= 100
    const uses = maxUses ?? 1;
    if (uses <= 0 || uses > 100) {
      throw new AppError('maxUses must be between 1 and 100.', 400);
    }

    // User limit check — only enforce if maxUsers is non-null
    if (req.user!.maxUsers !== null) {
      const teamSize = await prisma.user.count({
        where: { adminId: req.user!.userId, status: { not: 'DISABLED' } },
      });
      if (teamSize >= req.user!.maxUsers) {
        throw new AppError('User limit reached. Request an increase from the account owner.', 403);
      }
    }

    // Pool validation for admins only
    if (!isOwner && (maxScans !== undefined || maxLocations !== undefined || maxStorageBytes !== undefined)) {
      const admin = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: {
          poolScans: true,
          poolLocations: true,
          poolStorageBytes: true,
          teamMembers: {
            select: {
              allocatedScans: true,
              allocatedLocations: true,
              allocatedStorageBytes: true,
            },
          },
        },
      });

      const totalAllocatedScans = (admin?.teamMembers ?? []).reduce((s, m) => s + (m.allocatedScans ?? 0), 0);
      const totalAllocatedLocations = (admin?.teamMembers ?? []).reduce((s, m) => s + (m.allocatedLocations ?? 0), 0);
      const totalAllocatedStorage = (admin?.teamMembers ?? []).reduce((s, m) => s + (m.allocatedStorageBytes ?? 0), 0);

      if (maxScans != null && admin?.poolScans != null && totalAllocatedScans + maxScans > admin.poolScans) {
        throw new AppError(`Insufficient scan pool. Remaining: ${admin.poolScans - totalAllocatedScans}`, 400);
      }
      if (maxLocations != null && admin?.poolLocations != null && totalAllocatedLocations + maxLocations > admin.poolLocations) {
        throw new AppError(`Insufficient location pool. Remaining: ${admin.poolLocations - totalAllocatedLocations}`, 400);
      }
      if (maxStorageBytes != null && admin?.poolStorageBytes != null && totalAllocatedStorage + maxStorageBytes > admin.poolStorageBytes) {
        throw new AppError(`Insufficient storage pool. Remaining: ${admin.poolStorageBytes - totalAllocatedStorage} bytes`, 400);
      }
    }

    // Create invite via shared utility
    const invite = await createInviteLink({
      createdBy: req.user!.userId,
      roleHint: effectiveRole,
      maxUses: uses,
      expiresInHours: hours,
      maxStorageBytes: maxStorageBytes ?? null,
      maxScans: maxScans ?? null,
      maxLocations: maxLocations ?? null,
    });

    await logAction({
      actorId: req.user!.userId,
      action: 'INVITE_CREATED',
      details: { roleHint: effectiveRole, maxUses: uses, expiresInHours: hours, maxStorageBytes: maxStorageBytes ?? null },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      invite: {
        id: invite.id,
        token: invite.token,         // full plaintext token — only the creator gets this
        roleHint: invite.roleHint,
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
        maxStorageBytes: invite.maxStorageBytes ?? null,
        maxScans: invite.maxScans ?? null,
        maxLocations: invite.maxLocations ?? null,
        createdAt: invite.createdAt,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'createInviteLink error');
    throw new AppError('Internal server error.', 500);
  }
}))

// ── GET /api/admin/invites  (OWNER + ADMIN) ──────────────────────────────────
router.get('/invites', asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip, take } = parsePagination(req.query);
    const where = { createdBy: req.user!.userId };

    const [total, inviteLinks] = await Promise.all([
      prisma.inviteLink.count({ where }),
      prisma.inviteLink.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    // Compute isActive per invite and strip token
    const invites = inviteLinks.map((inv) => ({
      id: inv.id,
      roleHint: inv.roleHint,
      expiresAt: inv.expiresAt,
      usedAt: inv.usedAt,
      maxUses: inv.maxUses,
      maxStorageBytes: inv.maxStorageBytes ?? null,
      maxScans: inv.maxScans ?? null,
      maxLocations: inv.maxLocations ?? null,
      useCount: inv.useCount,
      createdAt: inv.createdAt,
      isActive: new Date() <= inv.expiresAt && inv.useCount < inv.maxUses,
    }));

    return res.json({ invites, pagination: buildPaginationMeta(total, page, limit) });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'listInviteLinks error');
    throw new AppError('Internal server error.', 500);
  }
}))

// ── DELETE /api/admin/invites/:id  (OWNER + ADMIN) ──────────────────────────
router.delete('/invites/:id', asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const inviteId = req.params['id'] as string;
    const invite = await prisma.inviteLink.findUnique({ where: { id: inviteId } });
    if (!invite) {
      throw new AppError('Invite not found.', 404);
    }
    if (invite.createdBy !== req.user!.userId) {
      throw new AppError("Cannot revoke an invite you didn't create.", 403);
    }

    // Hard delete the invite
    await prisma.inviteLink.delete({ where: { id: inviteId } });

    await logAction({
      actorId: req.user!.userId,
      action: 'INVITE_REVOKED',
      details: { inviteId: invite.id, useCountAtRevocation: invite.useCount },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ message: 'Invite revoked' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'revokeInviteLink error');
    throw new AppError('Internal server error.', 500);
  }
}))

// ── PATCH /api/admin/team/:id  (ADMIN only) ───────────────────────────────────
router.patch('/team/:id', requireRole('ADMIN'), validate(patchTeamMemberSchema), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const {
      role, permissions, trialExpiresAt, customExpiryMessage, status,
    } = req.body as {
      role?: string;
      permissions?: Record<string, boolean>;
      trialExpiresAt?: string | null;
      customExpiryMessage?: string | null;
      status?: string;
    };

    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        status: true,
        adminId: true,
        subscriptionSource: true,
        permissions: true,
        trialExpiresAt: true,
        customExpiryMessage: true,
      },
    });
    if (!target) throw new AppError('User not found.', 404);
    if (target.adminId !== req.user!.userId) {
      throw new AppError('You can only manage your own team members.', 403);
    }
    if (target.role === 'OWNER' || target.role === 'ADMIN') {
      throw new AppError('Cannot modify OWNER or ADMIN accounts.', 403);
    }

    const adminUser = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { subscriptionSource: true } });
    if (adminUser?.subscriptionSource === 'stripe' && (trialExpiresAt !== undefined || customExpiryMessage !== undefined)) {
      throw new AppError(
        'Stripe subscribers cannot set manual expiry dates. Manage your subscription through Stripe billing.',
        403
      );
    }

    const permissionPayload = permissions;

    if (permissionPayload !== undefined) {
      if (typeof permissionPayload !== 'object' || permissionPayload === null || Array.isArray(permissionPayload)) {
        throw new AppError('permissions must be an object', 400);
      }

      const validKeys = new Set<string>();
      for (const f of ALL_FEATURES) {
        for (const a of ALL_ACTIONS) {
          validKeys.add(`${f}:${a}`);
        }
      }

      const invalidKeys = Object.keys(permissionPayload).filter(key => !validKeys.has(key));
      if (invalidKeys.length > 0) {
        throw new AppError('Invalid permission keys', 400);
      }

      for (const [key, value] of Object.entries(permissionPayload)) {
        if (typeof value !== 'boolean') {
          throw new AppError('Permission values must be boolean', 400);
        }
      }
    }

    // ── Trial-reset branch (only when trialExpiresAt is set to a date) ─────────
    let isTrialReset = false;
    let newExpiryDate: Date | null = null;

    if (trialExpiresAt) {
      newExpiryDate = new Date(trialExpiresAt);
      if (isNaN(newExpiryDate.getTime()) || newExpiryDate <= new Date()) {
        throw new AppError('trialExpiresAt must be a future date', 400);
      }
      if (target.status === 'DISABLED') {
        throw new AppError('Cannot reset trial for a disabled user', 400);
      }
      isTrialReset = true;
    }

    const updateData: Record<string, unknown> = {};
    if (role !== undefined) updateData['role'] = role;

    let finalPermissions = target.permissions as Record<string, boolean> | null;
    const reactivationDefault = isTrialReset && target.status === 'EXPIRED' && status === 'ACTIVE' && permissionPayload === undefined;

    if (permissionPayload !== undefined) {
      finalPermissions = mergePermissions(finalPermissions, permissionPayload);
    } else if (reactivationDefault) {
      finalPermissions = mergePermissions(
        finalPermissions,
        {
          'scan:read': true,
          'scan:write': true,
          'scan:execute': true,
          'map:read': true,
          'map:write': true,
          'map:execute': true,
          'sync:read': true,
          'sync:execute': true,
          'locations:read': true,
          'locations:write': true,
        },
      );
    }

    if (isTrialReset && target.status === 'EXPIRED' && status === 'ACTIVE') {
      updateData['status'] = 'ACTIVE';
      updateData['permissions'] = finalPermissions;
    } else {
      if (permissionPayload !== undefined) {
        updateData['permissions'] = finalPermissions;
      }
      if (status !== undefined) updateData['status'] = status;
    }

    if (trialExpiresAt !== undefined) updateData['trialExpiresAt'] = newExpiryDate;
    if (customExpiryMessage !== undefined) updateData['customExpiryMessage'] = customExpiryMessage;

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true, email: true, name: true, role: true, status: true,
        permissions: true,
        trialExpiresAt: true, customExpiryMessage: true, mustChangePassword: true,
      },
    });

    const safeUpdated = updated;

    // ── Standard audit entries ────────────────────────────────────────────────
    const auditEntries: Array<{ actorId: string; action: string; targetUserId: string; details?: object }> = [];
    if (role !== undefined) {
      auditEntries.push({ actorId: req.user!.userId, action: 'ROLE_CHANGED', targetUserId: id, details: { newRole: role } });
    }
    if (!isTrialReset) {
      if (permissionPayload !== undefined) {
        auditEntries.push({
          actorId: req.user!.userId,
          action: 'PERMISSION_UPDATED',
          targetUserId: id,
          details: { permissions: permissionPayload },
        });
      }
      if (trialExpiresAt !== undefined || customExpiryMessage !== undefined) {
        auditEntries.push({ actorId: req.user!.userId, action: 'TIMEBOMB_SET', targetUserId: id, details: { trialExpiresAt, customExpiryMessage } });
      }
      if (status !== undefined) {
        auditEntries.push({ actorId: req.user!.userId, action: 'USER_STATUS_CHANGED', targetUserId: id, details: { newStatus: status } });
      }
    }
    if (auditEntries.length > 0) {
      await prisma.auditLog.createMany({ data: auditEntries });
    }

    // ── Trial-reset post-processing ───────────────────────────────────────────
    let trialEmailResult: { success: boolean; error?: string } | undefined;

    if (isTrialReset && newExpiryDate) {
      // Always delete old warning logs so the cron re-fires for the new expiry
      await prisma.auditLog.deleteMany({
        where: { targetUserId: id, action: 'TRIAL_EXPIRY_WARNING' },
      });

      await prisma.auditLog.create({
        data: {
          actorId: req.user!.userId,
          targetUserId: id,
          action: 'TRIAL_RESET',
          details: {
            previousStatus: target.status,
            previousTrialExpiresAt: target.trialExpiresAt,
            newTrialExpiresAt: newExpiryDate,
            permissionsSet: updated.permissions,
          },
        },
      });

      trialEmailResult = await sendTrialRenewed({
        to: updated.email,
        name: updated.name,
        newExpiryDate,
        customExpiryMessage: updated.customExpiryMessage,
      });
    }

    return res.json({
      user: safeUpdated,
      emailWarning: !trialEmailResult?.success ? 'Trial was renewed but the notification email failed to send.' : undefined,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'patchTeamMember error');
    throw new AppError('Internal server error.', 500);
  }
}))

// ── POST /api/admin/team/:id/disable  (ADMIN only) ───────────────────────────
router.post('/team/:id/disable', requireRole('ADMIN'), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, role: true, adminId: true } });
    if (!target) throw new AppError('User not found.', 404);
    if (target.adminId !== req.user!.userId) {
      throw new AppError('You can only manage your own team members.', 403);
    }
    if (target.role === 'OWNER' || target.role === 'ADMIN') {
      throw new AppError('Cannot disable OWNER or ADMIN accounts.', 403);
    }

    await prisma.user.update({ where: { id }, data: { status: 'DISABLED' } });

    await maybeSendTeamChangeAlert({
      userId: req.user!.userId,
      to: req.user!.email,
      name: req.user!.name ?? req.user!.email,
      memberName: target.name ?? target.email,
      memberEmail: target.email,
      action: 'removed',
    });

    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, action: 'USER_DISABLED', targetUserId: id },
    });

    return res.json({ message: 'User disabled successfully.' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'disableTeamMember error');
    throw new AppError('Internal server error.', 500);
  }
}))

router.patch('/team/:id/allocation', requireRole('ADMIN'), validate(teamAllocationSchema), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user!.userId;
    const userId = String(req.params['id']);

    const { allocatedScans, allocatedLocations, allocatedTemplates } = req.body as {
      allocatedScans?: number | null;
      allocatedLocations?: number | null;
      allocatedTemplates?: number | null;
    };

    const member = await prisma.user.findFirst({
      where: { id: userId, managedById: adminId },
    });
    if (!member) {
      throw new AppError('Member not found or not managed by you', 404);
    }

    const admin = await prisma.user.findFirst({ where: { id: adminId } });
    const siblings = await prisma.user.findMany({
      where: { managedById: adminId, id: { not: userId } },
      select: { allocatedScans: true, allocatedLocations: true, allocatedTemplates: true },
    });

    if (allocatedScans !== undefined) {
      const totalScansAllocated = siblings.reduce((sum, s) => sum + (s.allocatedScans ?? 0), 0) + (allocatedScans ?? 0);
      if (admin?.poolScans != null && totalScansAllocated > admin.poolScans) {
        throw new AppError(`Total allocated scans (${totalScansAllocated}) would exceed pool (${admin.poolScans})`, 400);
      }
    }

    if (allocatedLocations !== undefined) {
      const totalLocationsAllocated = siblings.reduce((sum, s) => sum + (s.allocatedLocations ?? 0), 0) + (allocatedLocations ?? 0);
      if (admin?.poolLocations != null && totalLocationsAllocated > admin.poolLocations) {
        throw new AppError(`Total allocated locations (${totalLocationsAllocated}) would exceed pool (${admin.poolLocations})`, 400);
      }
    }

    if (allocatedTemplates !== undefined) {
      const totalTemplatesAllocated = siblings.reduce((sum, s) => sum + (s.allocatedTemplates ?? 0), 0) + (allocatedTemplates ?? 0);
      if (admin?.poolTemplates != null && totalTemplatesAllocated > admin.poolTemplates) {
        throw new AppError(`Total allocated templates (${totalTemplatesAllocated}) would exceed pool (${admin.poolTemplates})`, 400);
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(allocatedScans !== undefined && { allocatedScans }),
        ...(allocatedLocations !== undefined && { allocatedLocations }),
        ...(allocatedTemplates !== undefined && { allocatedTemplates }),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        action: 'PERMISSION_OVERRIDE',
        targetUserId: userId,
        details: { type: 'allocation_update', allocatedScans, allocatedLocations, allocatedTemplates, adminId },
      },
    });

    res.json(updated);
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'patchTeamAllocation error');
    throw new AppError('Internal server error.', 500);
  }
}))

// ── PATCH /api/admin/users/:id/timebomb  (OWNER + ADMIN) ───────────────────
router.patch('/users/:id/timebomb', requireRole('OWNER', 'ADMIN'), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const { timeBombAt, gracePeriodHours } = req.body as { timeBombAt?: string; gracePeriodHours?: number };

    if (typeof timeBombAt !== 'string') {
      throw new AppError('timeBombAt is required', 400);
    }
    if (id === req.user!.userId) {
      throw new AppError('Cannot modify your own account', 400);
    }

    const adminUser = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { subscriptionSource: true } });
    if (adminUser?.subscriptionSource === 'stripe') {
      throw new AppError('Stripe subscribers cannot set manual expiry dates. Manage your subscription through Stripe billing.', 403);
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, adminId: true },
    });
    if (!target) throw new AppError('User not found.', 404);
    if (target.role === 'OWNER' || target.role === 'ADMIN') {
      throw new AppError('Cannot set a time bomb on this user', 403);
    }
    if (target.adminId !== req.user!.userId) {
      throw new AppError('You can only manage users in your team', 403);
    }

    const bombDate = new Date(timeBombAt);
    if (isNaN(bombDate.getTime()) || bombDate <= new Date()) {
      throw new AppError('timeBombAt must be a future date', 400);
    }
    if (gracePeriodHours !== undefined && (typeof gracePeriodHours !== 'number' || gracePeriodHours <= 0)) {
      throw new AppError('gracePeriodHours must be a positive number', 400);
    }

    const updateData: Record<string, unknown> = { timeBombAt: bombDate };
    if (gracePeriodHours !== undefined) updateData.gracePeriodHours = gracePeriodHours;

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true, email: true, name: true, role: true, status: true,
        adminId: true, blocked: true, timeBombAt: true, gracePeriodHours: true,
        approvedAt: true, approvedById: true, permissions: true,
        createdAt: true, updatedAt: true,
      },
    });

    await logAction({
      actorId: req.user!.userId,
      action: 'TIME_BOMB_SET',
      targetUserId: id,
      details: { timeBombAt: bombDate, gracePeriodHours: updated.gracePeriodHours, targetRole: updated.role },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ user: { ...updated, effectiveAccess: getEffectiveAccess(buildUserForAccess(updated)) } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'setTimeBomb error');
    throw new AppError('Internal server error.', 500);
  }
}))

// ── PATCH /api/admin/users/:id/timebomb/clear  (OWNER + ADMIN) ────────────────
router.patch('/users/:id/timebomb/clear', requireRole('OWNER', 'ADMIN'), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    if (id === req.user!.userId) {
      throw new AppError('Cannot modify your own account', 400);
    }

    const adminUser = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { subscriptionSource: true },
    });
    if (adminUser?.subscriptionSource === 'stripe') {
      throw new AppError(
        'Stripe subscribers cannot clear manual expiry dates. Manage your subscription through Stripe billing.',
        403
      );
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, timeBombAt: true, status: true, role: true, adminId: true },
    });
    if (!target) throw new AppError('User not found.', 404);
    if (target.role === 'OWNER' || target.role === 'ADMIN') {
      throw new AppError('Cannot modify this user', 403);
    }
    if (target.adminId !== req.user!.userId) {
      throw new AppError('You can only manage users in your team', 403);
    }
    if (!target.timeBombAt) {
      throw new AppError('No time bomb set', 400);
    }

    const updateData: Record<string, unknown> = { timeBombAt: null };
    if (target.status === 'GRACE_PERIOD' || target.status === 'TIME_BOMBED') {
      updateData.status = 'ACTIVE';
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true, email: true, name: true, role: true, status: true,
        adminId: true, blocked: true, timeBombAt: true, gracePeriodHours: true,
        approvedAt: true, approvedById: true, permissions: true,
        createdAt: true, updatedAt: true,
      },
    });

    await logAction({
      actorId: req.user!.userId,
      action: 'TIME_BOMB_CLEARED',
      targetUserId: id,
      details: { previousStatus: target.status },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ user: { ...updated, effectiveAccess: getEffectiveAccess(buildUserForAccess(updated)) } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'clearTimeBomb error');
    throw new AppError('Internal server error.', 500);
  }
}))

// ── PATCH /api/admin/users/:id/role  (OWNER + ADMIN) ─────────────────────────
router.patch('/users/:id/role', requireRole('OWNER', 'ADMIN'), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const { role } = req.body as { role?: string };

    if (!role || typeof role !== 'string') {
      throw new AppError('Role is required', 400);
    }
    if (id === req.user!.userId) {
      throw new AppError('Cannot modify your own account', 400);
    }

    const allowedRoles: string[] = ['STAFF', 'ACCOUNTANT', 'VIEWER', 'MANAGER'];
    if (!allowedRoles.includes(role)) {
      throw new AppError('Allowed roles for admin assignment: STAFF, ACCOUNTANT, VIEWER, MANAGER', 400);
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, status: true, adminId: true },
    });
    if (!target) throw new AppError('User not found.', 404);
    if (target.role === 'OWNER' || target.role === 'ADMIN') {
      throw new AppError("Cannot change this user's role", 403);
    }
    if (target.adminId !== req.user!.userId) {
      throw new AppError('You can only manage users in your team', 403);
    }

    // No-op check — still return consistent response shape
    if (target.role === role) {
      const fullUser = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true, email: true, name: true, role: true, status: true,
          adminId: true, blocked: true, timeBombAt: true, gracePeriodHours: true,
          approvedAt: true, approvedById: true, permissions: true,
          createdAt: true, updatedAt: true,
        },
      });
      return res.json({ user: { ...fullUser!, effectiveAccess: getEffectiveAccess(buildUserForAccess(fullUser!)) } });
    }

    const updateData: Record<string, unknown> = { role };
    // Auto-approve PENDING_APPROVAL users on role change (same as owner.ts)
    if (target.status === 'PENDING_APPROVAL') {
      updateData.approvedAt = new Date();
      updateData.approvedById = req.user!.userId;
      updateData.status = 'ACTIVE';
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true, email: true, name: true, role: true, status: true,
        adminId: true, blocked: true, timeBombAt: true, gracePeriodHours: true,
        approvedAt: true, approvedById: true, permissions: true,
        createdAt: true, updatedAt: true,
      },
    });

    await logAction({
      actorId: req.user!.userId,
      action: 'ROLE_CHANGE',
      targetUserId: id,
      details: { previousRole: target.role, newRole: role },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ user: { ...updated, effectiveAccess: getEffectiveAccess(buildUserForAccess(updated)) } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'changeUserRole error');
    throw new AppError('Internal server error.', 500);
  }
}))

export default router;
