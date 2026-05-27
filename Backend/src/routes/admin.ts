import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';

const router = Router();

// All admin routes require authentication + OWNER or ADMIN role
router.use(authenticate, requireRole('OWNER', 'ADMIN'));

// -- GET /api/admin/users
router.get('/users', async (_req: Request, res: Response) => {
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

// -- GET /api/admin/requests
router.get('/requests', async (_req: Request, res: Response) => {
  try {
    const requests = await prisma.adminRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ requests });
  } catch (err) {
    console.error('[Admin] Get requests error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// -- POST /api/admin/requests/:id/approve
router.post('/requests/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const request = await prisma.adminRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been processed.' });

    await prisma.adminRequest.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: req.user!.userId },
    });

    return res.json({ message: 'Request approved.' });
  } catch (err) {
    console.error('[Admin] Approve request error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// -- POST /api/admin/requests/:id/reject
router.post('/requests/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const request = await prisma.adminRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been processed.' });
    await prisma.adminRequest.update({
      where: { id },
      data: { status: 'REJECTED', approvedById: req.user!.userId },
    });
    return res.json({ message: 'Request rejected.' });
  } catch (err) {
    console.error('[Admin] Reject request error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// -- DELETE /api/admin/users/:id
router.delete('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    if (req.user!.userId === id) {
      return res.status(403).json({ error: 'You cannot disable your own account.' });
    }
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await prisma.user.update({ where: { id }, data: { status: 'DISABLED' } });
    return res.json({ message: 'User disabled successfully.' });
  } catch (err) {
    console.error('[Admin] Disable user error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
