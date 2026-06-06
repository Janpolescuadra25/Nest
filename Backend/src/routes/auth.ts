import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { authLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { loginSchema, registerSchema, changePasswordSchema } from '../lib/validators';
import { sendVerificationEmail } from '../lib/email';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// POST /api/auth/login
router.post('/login', authLimiter, validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const user = await prisma.user.findUnique({
      where: { email: (email as string).toLowerCase() },
    });
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    if (!user.password) return res.status(401).json({ error: 'Account password not set. Please contact your admin.' });
    if (user.status === 'DISABLED') return res.status(403).json({ error: 'Account is disabled.' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
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
        canScan: user.canScan,
        canMap: user.canMap,
        canSync: user.canSync,
        canManageLocs: user.canManageLocs,
        trialExpiresAt: user.trialExpiresAt,
        customExpiryMessage: user.customExpiryMessage,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/auth/register
// Creates a new VIEWER account. No admin approval required.
router.post('/register', authLimiter, validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const normalizedEmail = (email as string).toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name ?? null,
        password: hashedPassword,
        role: 'VIEWER',
        status: 'ACTIVE',
        mustChangePassword: false,
      },
    });

    try {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.$transaction([
        prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
        prisma.emailVerificationToken.create({ data: { userId: user.id, token: verificationToken, expiresAt } }),
      ]);
      await sendVerificationEmail({
        to: user.email,
        name: user.name,
        verificationLink: `${process.env.APP_URL}/api/email-verification/verify/${verificationToken}`,
      });
    } catch (emailErr) {
      console.error('[Auth] Verification email failed:', emailErr);
    }

    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
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
        canScan: user.canScan,
        canMap: user.canMap,
        canSync: user.canSync,
        canManageLocs: user.canManageLocs,
      },
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/auth/change-password  (requires authentication)
router.post('/change-password', authenticate, validate(changePasswordSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user || !user.password) {
      return res.status(400).json({ error: 'Password not set for this account.' });
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword, mustChangePassword: false } });

    return res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('[Auth] Change password error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/auth/me  (requires authentication)
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
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
        canScan: true,
        canMap: true,
        canSync: true,
        canManageLocs: true,
        mustChangePassword: true,
        trialExpiresAt: true,
        customExpiryMessage: true,
        maxUsers: true,
        createdAt: true,
        _count: { select: { teamMembers: true } },
      },
    });
    if (!user) return res.status(401).json({ error: 'User not found.' });

    return res.json({ user });
  } catch (err) {
    console.error('[Auth] Me error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/auth/session  — kept for backward compatibility, delegates to /me logic
router.get('/session', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, role: true, name: true, status: true, emailVerified: true, mustChangePassword: true, canScan: true, canMap: true, canSync: true, canManageLocs: true, trialExpiresAt: true, customExpiryMessage: true },
    });
    if (!user) return res.status(401).json({ error: 'User not found.' });
    return res.json({ user });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Session expired' });
    }
    return res.status(500).json({
      error: process.env.NODE_ENV === 'production' ? 'Session check failed' : ((err as Error).message || 'Unknown error'),
    });
  }
});

export default router;

