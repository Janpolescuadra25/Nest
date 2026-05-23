import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET ?? 'fallback-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';

// In-memory OTP store (MVP — replace with Redis or DB in production)
const otpStore: Record<string, { code: string; expiresAt: number }> = {};

// ── POST /api/auth/login ─────────────────────────────────────────────────────
// Accepts email, generates 6-digit OTP, logs it (MVP — no email sending yet)
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body as { email?: string };

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Upsert user
    await prisma.user.upsert({
      where: { email },
      update: { verificationCode: code, codeExpiresAt: new Date(expiresAt) },
      create: { email, verificationCode: code, codeExpiresAt: new Date(expiresAt) },
    });

    otpStore[email] = { code, expiresAt };

    // MVP: log the code — replace with real email service later
    console.log(`[Auth] OTP for ${email}: ${code}`);

    res.json({ message: 'Verification code sent', email });
  } catch (err) {
    console.error('[Auth] login error:', err);
    res.status(500).json({ error: 'Failed to generate verification code' });
  }
});

// ── POST /api/auth/verify ────────────────────────────────────────────────────
// Accepts email + code, returns JWT token
router.post('/verify', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, code } = req.body as { email?: string; code?: string };

    if (!email || !code) {
      res.status(400).json({ error: 'email and code are required' });
      return;
    }

    const stored = otpStore[email];
    if (!stored) {
      res.status(400).json({ error: 'No pending verification for this email' });
      return;
    }

    if (Date.now() > stored.expiresAt) {
      delete otpStore[email];
      res.status(400).json({ error: 'Verification code has expired' });
      return;
    }

    if (stored.code !== code) {
      res.status(400).json({ error: 'Invalid verification code' });
      return;
    }

    // Mark user as verified
    const user = await prisma.user.update({
      where: { email },
      data: { isVerified: true, verificationCode: null, codeExpiresAt: null },
    });

    delete otpStore[email];

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );

    res.json({ message: 'Verified successfully', token, userId: user.id });
  } catch (err) {
    console.error('[Auth] verify error:', err);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

// ── GET /api/auth/session ────────────────────────────────────────────────────
// Validate a token and return the session payload
router.get('/session', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    res.json({ userId: user.id, email: user.email, isVerified: user.isVerified });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export default router;
