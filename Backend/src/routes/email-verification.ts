import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { AppError, asyncHandler } from '../lib/errors';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { sendVerificationEmail } from '../lib/email';
import { emailVerificationLimiter } from '../middleware/rate-limit';

const router = Router();

// ── POST /api/email-verification/request ─────────────────────────────────────
router.post('/request', authenticate, emailVerificationLimiter, asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw new AppError('User not found', 404);
    if (user.emailVerified) return res.json({ message: 'Email already verified' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
      prisma.emailVerificationToken.create({ data: { userId: user.id, token, expiresAt } }),
    ]);

    const result = await sendVerificationEmail({
      to: user.email,
      name: user.name,
      verificationLink: `${process.env.APP_URL}/api/email-verification/verify/${token}`,
    });
    if (!result.success) {
      throw new AppError('Failed to send verification email. Please try again.', 500);
    }

    return res.json({ message: 'Verification email sent' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[EmailVerification] request error:', err);
    throw new AppError('Internal server error', 500);
  }
}));

// ── GET /api/email-verification/verify/:token ────────────────────────────────
router.get('/verify/:token', asyncHandler(async (req: Request, res: Response) => {
  try {
    const tokenParam = String(req.params.token || '').trim();
    if (!tokenParam) {
      return res.redirect(`${process.env.APP_URL}/verify-email?status=invalid`);
    }

    const token = await prisma.emailVerificationToken.findUnique({ where: { token: tokenParam } });
    if (!token) {
      return res.redirect(`${process.env.APP_URL}/verify-email?status=invalid`);
    }

    if (token.expiresAt < new Date()) {
      await prisma.emailVerificationToken.delete({ where: { id: token.id } });
      return res.redirect(`${process.env.APP_URL}/verify-email?status=expired`);
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: token.userId }, data: { emailVerified: true } }),
      prisma.emailVerificationToken.delete({ where: { id: token.id } }),
      prisma.auditLog.create({
        data: {
          actorId: token.userId,
          action: 'EMAIL_VERIFIED',
          targetUserId: token.userId,
        },
      }),
    ]);

    return res.redirect(`${process.env.APP_URL}/verify-email?status=success`);
  } catch (err) {
    console.error('[EmailVerification] verify error:', err);
    return res.redirect(`${process.env.APP_URL}/verify-email?status=invalid`);
  }
}));

export default router;
