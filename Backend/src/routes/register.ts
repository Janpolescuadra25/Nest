import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

const router = Router();

// ── GET /register ──────────────────────────────────────────────────────────────
// Validate invitation token and return invite info
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.query as { token?: string };

    if (!token) {
      res.status(400).json({ error: 'Invitation token is required' });
      return;
    }

    const invitation = await prisma.invitation.findUnique({ where: { token } });

    if (!invitation) {
      res.status(404).json({ error: 'Invalid invitation token' });
      return;
    }

    if (invitation.usedAt) {
      res.status(400).json({ error: 'Invitation has already been used' });
      return;
    }

    if (invitation.expiresAt < new Date()) {
      res.status(400).json({ error: 'Invitation has expired' });
      return;
    }

    // Check if a user already exists with this email
    const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });
    if (existingUser) {
      res.status(400).json({ error: 'An account already exists for this email' });
      return;
    }

    res.json({
      email: invitation.email,
      name: invitation.name,
      expiresAt: invitation.expiresAt,
    });
  } catch (err) {
    console.error('[Register] GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /register ─────────────────────────────────────────────────────────────
// Create user account using invitation token
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, name, password } = req.body as {
      token?: string;
      name?: string;
      password?: string;
    };

    if (!token || !password) {
      res.status(400).json({ error: 'token and password are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const invitation = await prisma.invitation.findUnique({ where: { token } });

    if (!invitation) {
      res.status(404).json({ error: 'Invalid invitation token' });
      return;
    }

    if (invitation.usedAt) {
      res.status(400).json({ error: 'Invitation has already been used' });
      return;
    }

    if (invitation.expiresAt < new Date()) {
      res.status(400).json({ error: 'Invitation has expired' });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });
    if (existingUser) {
      res.status(400).json({ error: 'An account already exists for this email' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const [user] = await prisma.$transaction([
      prisma.user.create({
        data: {
          email: invitation.email,
          name: name ?? invitation.name ?? '',
          password: hashedPassword,
          role: 'user',
          isVerified: true,
          invitedById: invitation.createdBy,
        },
        select: { id: true, email: true, name: true, role: true },
      }),
      prisma.invitation.update({
        where: { token },
        data: { usedAt: new Date() },
      }),
    ]);

    res.status(201).json({ message: 'Account created successfully', user });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    console.error('[Register] POST error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
