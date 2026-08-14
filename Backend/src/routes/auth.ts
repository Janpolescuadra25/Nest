import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { AppError, asyncHandler } from '../lib/errors';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { authLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { loginSchema, registerSchema, changePasswordSchema } from '../lib/validators';
import { sendVerificationEmail } from '../lib/email';
import { hashToken } from '../lib/encryption';

function mergeTeamBilling(user: any) {
  const teamOwner = user.admin ?? {};
  return {
    subscriptionSource: user.subscriptionSource ?? teamOwner.subscriptionSource ?? null,
    stripeCustomerId: user.stripeCustomerId ?? teamOwner.stripeCustomerId ?? null,
    stripeSubscriptionId: user.stripeSubscriptionId ?? teamOwner.stripeSubscriptionId ?? null,
    currentPlan: user.currentPlan ?? teamOwner.currentPlan ?? null,
    planInterval: user.planInterval ?? teamOwner.planInterval ?? null,
    currentPeriodEnd: user.currentPeriodEnd ?? teamOwner.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: user.cancelAtPeriodEnd ?? teamOwner.cancelAtPeriodEnd ?? false,
    paymentIssue: user.paymentIssue ?? teamOwner.paymentIssue ?? false,
    maxUsers: user.maxUsers ?? teamOwner.maxUsers ?? null,
    maxLocations: user.maxLocations ?? teamOwner.maxLocations ?? null,
    bonusScans: user.bonusScans ?? teamOwner.bonusScans ?? 0,
    welcomedAt: user.welcomedAt ?? teamOwner.welcomedAt ?? null,
    brandName: teamOwner.brandName ?? null,
    brandColor: teamOwner.brandColor ?? null,
    logoUrl: teamOwner.logoUrl ?? null,
  };
}

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// POST /api/auth/login
router.post('/login', authLimiter, validate(loginSchema), asyncHandler(async(req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new AppError('Email and password are required.', 400);
    }
    const user = await prisma.user.findUnique({
      where: { email: (email as string).toLowerCase() },
      include: {
        admin: {
          select: {
            subscriptionSource: true,
            stripeCustomerId: true,
            stripeSubscriptionId: true,
            currentPlan: true,
            planInterval: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
            paymentIssue: true,
            maxUsers: true,
            maxLocations: true,
            bonusScans: true,
            welcomedAt: true,
            brandName: true,
            brandColor: true,
            logoUrl: true,
          },
        },
      },
    });
    if (!user) throw new AppError('Invalid email or password.', 401);
    if (!user.password) throw new AppError('Account password not set. Please contact your admin.', 401);
    if (user.status === 'DISABLED') throw new AppError('Account is disabled.', 403);
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new AppError('Invalid email or password.', 401);
    const jwtExpiresIn = process.env.JWT_EXPIRES_IN ?? '7d';
    const token = jwt.sign(
      { sub: user.id },
      JWT_SECRET,
      { expiresIn: jwtExpiresIn as SignOptions['expiresIn'] },
    );
    const billing = mergeTeamBilling(user);
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
        mustChangePassword: user.mustChangePassword,
        permissions: user.permissions as Record<string, boolean> | null,
        trialExpiresAt: user.trialExpiresAt,
        customExpiryMessage: user.customExpiryMessage,
        ...billing,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Auth] Login error:', err);
    throw new AppError('Internal server error.', 500);
  }
}))

router.get('/usage', authenticate, asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const teamId = req.user!.adminId ?? req.user!.userId;
    const team = await prisma.user.findUnique({
      where: { id: teamId },
      select: { maxStorageBytes: true },
    });

    const locations = await prisma.location.findMany({
      where: { userId: teamId },
      select: { id: true },
    });
    const locationIds = locations.map((l) => l.id);

    if (locationIds.length === 0) {
      return res.json({
        userId: req.user!.userId,
        totalStorageBytes: 0,
        scanCount: 0,
        locationCount: 0,
        attachmentCount: 0,
        storageLimitBytes: team?.maxStorageBytes ?? null,
      });
    }

    const [scanAttachments, locationAttachments, scanCount, scanAttachmentCount, locationAttachmentCount] = await Promise.all([
      prisma.attachment.aggregate({
        _sum: { fileSize: true },
        where: { scanRecord: { locationId: { in: locationIds } } },
      }),
      prisma.locationAttachment.aggregate({
        _sum: { fileSize: true },
        where: { locationId: { in: locationIds } },
      }),
      prisma.scanRecord.count({
        where: { locationId: { in: locationIds } },
      }),
      prisma.attachment.count({
        where: { scanRecord: { locationId: { in: locationIds } } },
      }),
      prisma.locationAttachment.count({
        where: { locationId: { in: locationIds } },
      }),
    ]);

    const totalStorageBytes = (scanAttachments._sum.fileSize || 0) + (locationAttachments._sum.fileSize || 0);

    res.json({
      userId: req.user!.userId,
      totalStorageBytes,
      scanCount,
      locationCount: locationIds.length,
      attachmentCount: scanAttachmentCount + locationAttachmentCount,
      storageLimitBytes: team?.maxStorageBytes ?? null,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Auth] get usage error:', err);
    throw new AppError('Failed to fetch usage', 500);
  }
}))

router.get('/usage', authenticate, asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const teamId = req.user!.adminId ?? req.user!.userId;
    const team = await prisma.user.findUnique({
      where: { id: teamId },
      select: { maxStorageBytes: true },
    });

    const locations = await prisma.location.findMany({
      where: { userId: teamId },
      select: { id: true },
    });
    const locationIds = locations.map((l) => l.id);

    if (locationIds.length === 0) {
      return res.json({
        userId: req.user!.userId,
        totalStorageBytes: 0,
        scanCount: 0,
        locationCount: 0,
        attachmentCount: 0,
        storageLimitBytes: team?.maxStorageBytes ?? null,
      });
    }

    const [scanAttachments, locationAttachments, scanCount, scanAttachmentCount, locationAttachmentCount] = await Promise.all([
      prisma.attachment.aggregate({
        _sum: { fileSize: true },
        where: { scanRecord: { locationId: { in: locationIds } } },
      }),
      prisma.locationAttachment.aggregate({
        _sum: { fileSize: true },
        where: { locationId: { in: locationIds } },
      }),
      prisma.scanRecord.count({
        where: { locationId: { in: locationIds } },
      }),
      prisma.attachment.count({
        where: { scanRecord: { locationId: { in: locationIds } } },
      }),
      prisma.locationAttachment.count({
        where: { locationId: { in: locationIds } },
      }),
    ]);

    res.json({
      userId: req.user!.userId,
      totalStorageBytes: (scanAttachments._sum.fileSize || 0) + (locationAttachments._sum.fileSize || 0),
      scanCount,
      locationCount: locationIds.length,
      attachmentCount: scanAttachmentCount + locationAttachmentCount,
      storageLimitBytes: team?.maxStorageBytes ?? null,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Auth] get usage error:', err);
    throw new AppError('Failed to fetch usage', 500);
  }
}))

// POST /api/auth/register
// Creates a new VIEWER account. No admin approval required.
router.post('/register', authLimiter, validate(registerSchema), asyncHandler(async(req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
    if (!email || !password) {
      throw new AppError('Email and password are required.', 400);
    }
    if (password.length < 8) {
      throw new AppError('Password must be at least 8 characters.', 400);
    }
    const normalizedEmail = (email as string).toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new AppError('An account with this email already exists.', 409);

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name ?? null,
        password: hashedPassword,
        role: 'ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        subscriptionSource: 'stripe',
        currentPlan: 'free',
      },
    });

    let emailResult: { success: boolean; error?: string } | undefined;
    try {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.$transaction([
        prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
        prisma.emailVerificationToken.create({ data: { userId: user.id, token: hashToken(verificationToken), expiresAt } }),
      ]);
      emailResult = await sendVerificationEmail({
        to: user.email,
        name: user.name,
        verificationLink: `${process.env.APP_URL}/api/email-verification/verify/${verificationToken}`,
      });
      if (!emailResult.success) {
        console.error('[Auth] Verification email failed:', emailResult.error);
      }
    } catch (emailErr) {
      console.error('[Auth] Registration setup error:', emailErr);
    }

    const jwtExpiresIn = process.env.JWT_EXPIRES_IN ?? '7d';
    const token = jwt.sign(
      { sub: user.id },
      JWT_SECRET,
      { expiresIn: jwtExpiresIn as SignOptions['expiresIn'] },
    );
    return res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
        mustChangePassword: user.mustChangePassword,
        permissions: user.permissions as Record<string, boolean> | null,
        trialExpiresAt: user.trialExpiresAt,
        customExpiryMessage: user.customExpiryMessage,
        subscriptionSource: user.subscriptionSource ?? null,
        stripeCustomerId: user.stripeCustomerId ?? null,
        stripeSubscriptionId: user.stripeSubscriptionId ?? null,
        currentPlan: user.currentPlan ?? null,
        planInterval: user.planInterval ?? null,
        currentPeriodEnd: user.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: user.cancelAtPeriodEnd ?? false,
        paymentIssue: user.paymentIssue ?? false,
        maxUsers: user.maxUsers ?? null,
        maxLocations: user.maxLocations ?? null,
        bonusScans: user.bonusScans ?? 0,
        welcomedAt: user.welcomedAt ?? null,
      },
      emailWarning: !emailResult?.success ? 'Account created but verification email failed. Please request a new verification link from Settings.' : undefined,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Auth] Register error:', err);
    throw new AppError('Internal server error.', 500);
  }
}))

// POST /api/auth/change-password  (requires authentication)
router.post('/change-password', authenticate, validate(changePasswordSchema), asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) {
      throw new AppError('currentPassword and newPassword are required.', 400);
    }
    if (newPassword.length < 8) {
      throw new AppError('New password must be at least 8 characters.', 400);
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user || !user.password) {
      throw new AppError('Password not set for this account.', 400);
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new AppError('Current password is incorrect.', 401);

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword, mustChangePassword: false } });

    return res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Auth] Change password error:', err);
    throw new AppError('Internal server error.', 500);
  }
}))

// GET /api/auth/me  (requires authentication)
router.get('/me', authenticate, asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        emailVerified: true,
        adminId: true,
        permissions: true,
        mustChangePassword: true,
        trialExpiresAt: true,
        customExpiryMessage: true,
        subscriptionSource: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        currentPlan: true,
        planInterval: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        paymentIssue: true,
        maxUsers: true,
        maxLocations: true,
        bonusScans: true,
        welcomedAt: true,
        brandName: true,
        brandColor: true,
        logoUrl: true,
        createdAt: true,
        _count: { select: { teamMembers: true } },
        admin: {
          select: {
            subscriptionSource: true,
            stripeCustomerId: true,
            stripeSubscriptionId: true,
            currentPlan: true,
            planInterval: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
            paymentIssue: true,
            maxUsers: true,
            maxLocations: true,
            bonusScans: true,
            welcomedAt: true,
            brandName: true,
            brandColor: true,
            logoUrl: true,
          },
        },
      },
    });
    if (!user) throw new AppError('User not found.', 401);
    const billing = mergeTeamBilling(user);
    return res.json({ user: { ...user, ...billing, admin: undefined } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Auth] Me error:', err);
    throw new AppError('Internal server error.', 500);
  }
}))

// GET /api/auth/session  — kept for backward compatibility, delegates to /me logic
router.get('/session', authenticate, asyncHandler(async(req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        status: true,
        emailVerified: true,
        mustChangePassword: true,
        permissions: true,
        trialExpiresAt: true,
        customExpiryMessage: true,
        subscriptionSource: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        currentPlan: true,
        planInterval: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        paymentIssue: true,
        maxUsers: true,
        maxLocations: true,
        bonusScans: true,
        welcomedAt: true,
        brandName: true,
        brandColor: true,
        logoUrl: true,
        admin: {
          select: {
            subscriptionSource: true,
            stripeCustomerId: true,
            stripeSubscriptionId: true,
            currentPlan: true,
            planInterval: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
            paymentIssue: true,
            maxUsers: true,
            maxLocations: true,
            bonusScans: true,
            welcomedAt: true,
            brandName: true,
            brandColor: true,
            logoUrl: true,
          },
        },
      },
    });
    if (!user) throw new AppError('User not found.', 401);
    const billing = mergeTeamBilling(user);
    return res.json({ user: { ...user, ...billing, admin: undefined } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      throw new AppError('Session expired', 401);
    }
    throw new AppError(process.env.NODE_ENV === 'production' ? 'Session check failed' : ((err as Error).message || 'Unknown error'), 500);
  }
}))

router.post('/welcome', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const teamId = req.user!.adminId ?? req.user!.userId;
  await prisma.user.update({
    where: { id: teamId },
    data: { welcomedAt: new Date() },
  });
  return res.json({ success: true });
}));

export default router;

