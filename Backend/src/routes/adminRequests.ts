import { Router, Request, Response } from 'express';
import { AppError, asyncHandler } from '../lib/errors';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { sendWelcomeEmail } from '../lib/email';
import { validate } from '../middleware/validate';
import { authLimiter } from '../middleware/rate-limit';
import { getPermissionDefaults } from '../middleware/permissions';
import { adminRequestSchema } from '../lib/validators';

const router = Router();

// ── POST /api/admin-requests  (public — no auth) ──────────────────────────────
router.post('/', authLimiter, validate(adminRequestSchema), asyncHandler(async(req: Request, res: Response) => {
  try {
    const { email, name, description, company } = req.body as {
      email?: string;
      name?: string;
      description?: string;
      company?: string;
    };

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError('Valid email is required.', 400);
    }
    if (!description || description.trim().length < 10) {
      throw new AppError('Description must be at least 10 characters.', 400);
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await prisma.adminRequest.findFirst({
      where: { email: normalizedEmail, status: 'PENDING' },
    });
    if (existing) throw new AppError('This email is not available for an admin request. Please contact support if you believe this is an error.', 409);

    const existingAdmin = await prisma.user.findFirst({
      where: { email: normalizedEmail, role: 'ADMIN' },
    });
    if (existingAdmin) throw new AppError('This email is not available for an admin request. Please contact support if you believe this is an error.', 409);

    const request = await prisma.adminRequest.create({
      data: {
        email: normalizedEmail,
        name: name?.trim() ?? null,
        description: description.trim(),
        company: company?.trim() ?? null,
        status: 'PENDING',
      },
    });

    return res.status(201).json({
      id: request.id,
      email: request.email,
      status: request.status,
      createdAt: request.createdAt,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[AdminRequests] create error:', err);
    throw new AppError('Internal server error.', 500);
  }
}))

// ── GET /api/admin-requests  (OWNER only) ─────────────────────────────────────
router.get('/', authenticate, requireRole('OWNER'), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '20'), 10) || 20));
    const status = req.query['status'] as string | undefined;

    const where = status ? { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' } : {};

    const [requests, total] = await prisma.$transaction([
      prisma.adminRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          approvedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.adminRequest.count({ where }),
    ]);

    return res.json({ requests, total, page, limit });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[AdminRequests] list error:', err);
    throw new AppError('Internal server error.', 500);
  }
}))

// ── POST /api/admin-requests/:id/approve  (OWNER only) ───────────────────────
router.post('/:id/approve', authenticate, requireRole('OWNER'), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const { poolScans, poolLocations, maxMembers } = req.body as {
      poolScans?: number;
      poolLocations?: number;
      maxMembers?: number;
    };
    const request = await prisma.adminRequest.findUnique({ where: { id } });
    if (!request) throw new AppError('Request not found.', 404);
    if (request.status !== 'PENDING') throw new AppError('This request has already been processed.', 400);

    const existingUser = await prisma.user.findUnique({ where: { email: request.email } });
    if (existingUser) throw new AppError('A user with this email already exists.', 409);

    const tempPassword = randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const newUser = await prisma.$transaction(async (tx) => {
      await tx.adminRequest.update({
        where: { id },
        data: { status: 'APPROVED', approvedById: req.user!.userId },
      });

      const createdUser = await tx.user.create({
        data: {
          email: request.email,
          name: request.name ?? null,
          password: hashedPassword,
          role: 'ADMIN',
          status: 'ACTIVE',
          subscriptionSource: 'owner',
          poolScans: poolScans ?? 200,
          poolLocations: poolLocations ?? 50,
          maxMembers: maxMembers ?? 5,
          maxUsers: 5,
          permissions: getPermissionDefaults('ADMIN'),
          mustChangePassword: true,
          emailVerified: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: 'EMAIL_VERIFIED',
          targetUserId: createdUser.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: 'ADMIN_APPROVED',
          targetUserId: createdUser.id,
          details: { requestId: request.id, requestEmail: request.email },
        },
      });

      return createdUser;
    });

    const emailResult = await sendWelcomeEmail({ to: request.email, name: request.name, tempPassword });

    return res.json({
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
      emailWarning: !emailResult.success ? 'Account created but welcome email failed to send.' : undefined,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[AdminRequests] approve error:', err);
    throw new AppError('Internal server error.', 500);
  }
}))

// ── POST /api/admin-requests/:id/reject  (OWNER only) ────────────────────────
router.post('/:id/reject', authenticate, requireRole('OWNER'), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const request = await prisma.adminRequest.findUnique({ where: { id } });
    if (!request) throw new AppError('Request not found.', 404);
    if (request.status !== 'PENDING') throw new AppError('This request has already been processed.', 400);

    await prisma.adminRequest.update({
      where: { id },
      data: { status: 'REJECTED', approvedById: req.user!.userId },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        action: 'ADMIN_REJECTED',
        targetUserId: null,
        details: { requestId: request.id, requestEmail: request.email },
      },
    });

    return res.json({ message: 'Request rejected.' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[AdminRequests] reject error:', err);
    throw new AppError('Internal server error.', 500);
  }
}))

export default router;
