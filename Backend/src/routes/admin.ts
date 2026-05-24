import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'fallback-secret';

// ── Types ─────────────────────────────────────────────────────────────────────
interface AdminRequest extends Request {
  adminUser?: { userId: string; email: string; role: string };
}

// ── Admin auth middleware ─────────────────────────────────────────────────────
function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as {
      userId: string;
      email: string;
      role?: string;
    };

    if (payload.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    req.adminUser = { userId: payload.userId, email: payload.email, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── POST /api/admin/auth ──────────────────────────────────────────────────────
// Admin login with email + password
router.post('/auth', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.role !== 'admin') {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (!user.password) {
      res.status(401).json({ error: 'Password not set for this account' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' } as jwt.SignOptions
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name ?? '', role: user.role },
    });
  } catch (err) {
    console.error('[Admin] auth error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true, isVerified: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ users });
  } catch (err) {
    console.error('[Admin] getUsers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/admin/users/:id ──────────────────────────────────────────────────
router.put('/users/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { role, name } = req.body as { role?: string; name?: string };

    const updateData: Record<string, unknown> = {};
    if (role !== undefined) updateData['role'] = role;
    if (name !== undefined) updateData['name'] = name;

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, email: true, name: true, role: true },
    });

    res.json({ user });
  } catch (err) {
    console.error('[Admin] updateUser error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/invite ────────────────────────────────────────────────────
router.post('/invite', requireAdmin, async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { email, name } = req.body as { email?: string; name?: string };

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }

    const inviterUserId = req.adminUser!.userId;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Delete any existing unused invitation for this email from this admin
    await prisma.invitation.deleteMany({
      where: { email, createdBy: inviterUserId, usedAt: null },
    });

    const invitation = await prisma.invitation.create({
      data: {
        email,
        name: name ?? '',
        token,
        createdBy: inviterUserId,
        expiresAt,
      },
    });

    const registerUrl = `${process.env.FRONTEND_URL ?? 'https://nest-backend-mddn.onrender.com'}/register?token=${token}`;

    // Send invitation email if Gmail is configured
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      });
      await transporter.sendMail({
        from: `"Nest App" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: "You've been invited to Nest",
        text: `You've been invited to join Nest. Register here: ${registerUrl}\n\nThis link expires in 7 days.`,
        html: `<div style="font-family:sans-serif;max-width:400px">
          <h2 style="color:#06b6d4">🪹 Nest</h2>
          <p>You've been invited to join Nest${name ? `, ${name}` : ''}!</p>
          <p><a href="${registerUrl}" style="background:#06b6d4;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Accept Invitation</a></p>
          <p style="color:#666;font-size:12px">This link expires in 7 days.</p>
        </div>`,
      });
    } else {
      console.log(`[Admin] Invitation for ${email}: ${registerUrl}`);
    }

    res.json({
      message: 'Invitation sent',
      registerUrl,
      expiresIn: '7 days',
      invitationId: invitation.id,
    });
  } catch (err) {
    console.error('[Admin] invite error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
router.get('/stats', requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const [totalUsers, activeInvitations, totalSyncs] = await Promise.all([
      prisma.user.count(),
      prisma.invitation.count({ where: { usedAt: null, expiresAt: { gt: new Date() } } }),
      prisma.syncLog.count({ where: { status: 'SUCCESS' } }),
    ]);

    res.json({ totalUsers, activeInvitations, totalSyncs });
  } catch (err) {
    console.error('[Admin] stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
