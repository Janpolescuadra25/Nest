import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'fallback-secret';

// ── Types ─────────────────────────────────────────────────────────────────────
interface AdminRequest extends Request {
  adminUser?: { userId: string; email: string; role: string; name?: string | null };
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
      sub: string; email: string; role?: string; name?: string | null;
    };

    if (!['OWNER', 'ADMIN'].includes(payload.role ?? '')) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    req.adminUser = { userId: payload.sub, email: payload.email, role: payload.role!, name: payload.name };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ users });
  } catch (err) {
    console.error('[Admin] getUsers error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/admin/requests ───────────────────────────────────────────────────
router.get('/requests', requireAdmin, async (_req: AdminRequest, res: Response) => {
  try {
    const requests = await prisma.accessRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ requests });
  } catch (err) {
    console.error('[Admin] Get requests error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── POST /api/admin/requests/:id/approve ─────────────────────────────────────
router.post('/requests/:id/approve', requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const request = await prisma.accessRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been processed.' });

    await prisma.accessRequest.update({
      where: { id },
      data: { status: 'APPROVED' },
    });

    return res.json({ message: 'Request approved.' });
  } catch (err) {
    console.error('[Admin] Approve request error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── POST /api/admin/requests/:id/reject ──────────────────────────────────────
router.post('/requests/:id/reject', requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const request = await prisma.accessRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been processed.' });
    await prisma.accessRequest.update({ where: { id }, data: { status: 'REJECTED' } });
    return res.json({ message: 'Request rejected.' });
  } catch (err) {
    console.error('[Admin] Reject request error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────
router.delete('/users/:id', requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    if (req.adminUser && req.adminUser.userId === id) {
      return res.status(403).json({ error: 'You cannot delete your own account.' });
    }
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await prisma.user.update({ where: { id }, data: { status: 'DISABLED' } });
    return res.json({ message: 'User disabled successfully.' });
  } catch (err) {
    console.error('[Admin] Delete user error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
