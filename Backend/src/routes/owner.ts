import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { parsePagination, buildPaginationMeta } from '../lib/pagination';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate, requireRole('OWNER'));

// ── GET /api/owner/admins ─────────────────────────────────────────────────────
router.get('/admins', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip, take } = parsePagination(req.query);
    const where = { role: 'ADMIN' as const };
    const [total, admins] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          maxUsers: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { teamMembers: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    // Join description/company from AdminRequest by email (no DB relation)
    const adminEmails = admins.map(a => a.email);
    const requests = await prisma.adminRequest.findMany({
      where: { email: { in: adminEmails } },
      select: { email: true, description: true, company: true },
      orderBy: { createdAt: 'desc' },
    });

    const requestMap = new Map<string, { description: string | null; company: string | null }>();
    for (const r of requests) {
      if (!requestMap.has(r.email)) {
        requestMap.set(r.email, { description: r.description, company: r.company });
      }
    }

    const result = admins.map(a => ({
      ...a,
      currentTeamSize: a._count.teamMembers,
      description: requestMap.get(a.email)?.description ?? null,
      company: requestMap.get(a.email)?.company ?? null,
    }));

    return res.json({ admins: result, pagination: buildPaginationMeta(total, page, limit) });
  } catch (err) {
    console.error('[Owner] getAdmins error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/owner/stats ─────────────────────────────────────────────────────
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const [
      totalPartners,
      totalTeamMembers,
      totalLocations,
      totalScans,
      totalSynced,
      totalFailed,
      totalPendingRequests,
      expiredMembers
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'ADMIN' } }),
      prisma.user.count({ where: { role: { in: ['ACCOUNTANT', 'STAFF', 'VIEWER'] } } }),
      prisma.location.count({ where: { isActive: true } }),
      prisma.scanRecord.count(),
      prisma.syncLog.count({ where: { status: 'SUCCESS' } }),
      prisma.syncLog.count({ where: { status: 'FAILED' } }),
      prisma.adminRequest.count({ where: { status: 'PENDING' } }),
      prisma.user.count({ where: { status: 'EXPIRED' } })
    ]);
    return res.json({
      totalPartners,
      totalTeamMembers,
      totalLocations,
      totalScans,
      totalSynced,
      totalFailed,
      totalPendingRequests,
      expiredMembers
    });
  } catch (err) {
    console.error('[Owner] stats error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── PATCH /api/owner/admins/:id ───────────────────────────────────────────────
const updateAdminSchema = z.object({
  maxUsers: z.number().int().min(1).max(1000).optional().nullable(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

router.patch('/admins/:id', validate(updateAdminSchema), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const { maxUsers, status } = req.body as { maxUsers?: number; status?: 'ACTIVE' | 'DISABLED' };

    const admin = await prisma.user.findUnique({ where: { id } });
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });
    if (admin.role === 'OWNER') return res.status(403).json({ error: 'Cannot modify OWNER accounts.' });

    const updateData: Record<string, unknown> = {};
    if (maxUsers !== undefined) updateData['maxUsers'] = maxUsers;
    if (status !== undefined) updateData['status'] = status;

    let updated;
    if (status === 'DISABLED') {
      // Soft cascade: disable all team members too
      [updated] = await prisma.$transaction([
        prisma.user.update({
          where: { id },
          data: updateData,
          select: { id: true, email: true, name: true, maxUsers: true, status: true },
        }),
        prisma.user.updateMany({
          where: { adminId: id },
          data: { status: 'DISABLED' },
        }),
      ]);
    } else {
      updated = await prisma.user.update({
        where: { id },
        data: updateData,
        select: { id: true, email: true, name: true, maxUsers: true, status: true },
      });
    }

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        action: 'ADMIN_UPDATED',
        targetUserId: id,
        details: { changes: { maxUsers, status } },
      },
    });

    return res.json({ admin: updated });
  } catch (err) {
    console.error('[Owner] patchAdmin error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/owner/admins/:id/team ────────────────────────────────────────────
router.get('/admins/:id/team', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const admin = await prisma.user.findUnique({ where: { id } });
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });

    const { page, limit, skip, take } = parsePagination(req.query);
    const where = { adminId: id };
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          canScan: true,
          canMap: true,
          canSync: true,
          canManageLocs: true,
          trialExpiresAt: true,
          customExpiryMessage: true,
          mustChangePassword: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take,
      }),
    ]);

    return res.json({ users, pagination: buildPaginationMeta(total, page, limit) });
  } catch (err) {
    console.error('[Owner] getAdminTeam error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/owner/audit-log ─────────────────────────────────────────────────
router.get('/audit-log', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '25'), 10) || 25));
    const actionFilter = req.query['action'] ? String(req.query['action']) : undefined;
    const actorIdFilter = req.query['actorId'] ? String(req.query['actorId']) : undefined;
    const dateFrom = req.query['dateFrom'] ? String(req.query['dateFrom']) : undefined;
    const dateTo = req.query['dateTo'] ? String(req.query['dateTo']) : undefined;

    const where: Record<string, unknown> = {};
    if (actionFilter) where['action'] = { contains: actionFilter };
    if (actorIdFilter) where['actorId'] = actorIdFilter;
    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt['gte'] = new Date(dateFrom);
      if (dateTo) createdAt['lte'] = new Date(dateTo);
      where['createdAt'] = createdAt;
    }

    const [total, logs] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          action: true,
          details: true,
          createdAt: true,
          actor: { select: { id: true, name: true, email: true } },
          targetUser: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return res.json({ logs, total, page, limit });
  } catch (err) {
    console.error('[Owner] getAuditLog error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
