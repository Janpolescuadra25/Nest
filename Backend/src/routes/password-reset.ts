import { AppError, asyncHandler } from '../lib/errors';
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { sendPasswordResetEmail } from '../lib/email';
import { passwordResetLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { passwordResetRequestSchema, passwordResetVerifySchema } from '../lib/validators';

const router = Router();

// ── POST /api/password-reset/request ─────────────────────────────────────────

router.post('/request', passwordResetLimiter, validate(passwordResetRequestSchema), asyncHandler(async (req, res) => {
  const { email } = req.body as { email?: string };

  const GENERIC_RESPONSE = { message: 'If an account exists, a reset link has been sent.' };

  if (!email || typeof email !== 'string') {
    return res.json(GENERIC_RESPONSE);
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

    // Always return the same response — do NOT reveal whether email exists
    if (!user) {
      return res.json(GENERIC_RESPONSE);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Delete old tokens + create new one atomically (prevents race condition on double-click)
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      prisma.passwordResetToken.create({ data: { userId: user.id, token, expiresAt } }),
    ]);

    sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetLink: `${process.env.APP_URL}/reset-password?token=${token}`,
    }).catch((err) => {
      console.error('[PasswordReset] Failed to send reset email:', err);
    });

    return res.json(GENERIC_RESPONSE);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[PasswordReset] request error:', err);
    throw new AppError('Internal server error', 500);
  }
}));

// ── POST /api/password-reset/verify ──────────────────────────────────────────

router.post('/verify', passwordResetLimiter, validate(passwordResetVerifySchema), asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };

  if (!token || typeof token !== 'string') {
    throw new AppError('Invalid or expired reset link', 400);
  }

  if (!newPassword || typeof newPassword !== 'string') {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  try {
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken) {
      throw new AppError('Invalid or expired reset link', 400);
    }

    if (resetToken.usedAt !== null) {
      throw new AppError('This link has already been used', 400);
    }

    if (resetToken.expiresAt < new Date()) {
      throw new AppError('This link has expired', 400);
    }

    if (newPassword.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const userId = resetToken.userId;

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword, mustChangePassword: false },
    });

    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        targetUserId: userId,
        action: 'PASSWORD_RESET',
        details: { method: 'magic_link' },
      },
    });

    return res.json({ message: 'Password updated successfully. You can now log in.' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[PasswordReset] verify error:', err);
    throw new AppError('Internal server error', 500);
  }
}));

export default router;
