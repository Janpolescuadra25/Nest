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

router.post('/request', passwordResetLimiter, validate(passwordResetRequestSchema), async (req, res) => {
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
    console.error('[PasswordReset] request error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/password-reset/verify ──────────────────────────────────────────

router.post('/verify', passwordResetLimiter, validate(passwordResetVerifySchema), async (req, res) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }

  if (!newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    if (resetToken.usedAt !== null) {
      return res.status(400).json({ error: 'This link has already been used' });
    }

    if (resetToken.expiresAt < new Date()) {
      return res.status(400).json({ error: 'This link has expired' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
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
    console.error('[PasswordReset] verify error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
