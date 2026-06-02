import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.middleware';
import { getEffectiveAccess, hasPermission, UserForAccess } from '../middleware/effective-role';
import { ALL_FEATURES, ALL_ACTIONS, Feature, Action } from '../middleware/permissions';
import { logAction } from '../middleware/audit';
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
      expiredMembers,
      totalPending
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'ADMIN' } }),
      prisma.user.count({ where: { role: { in: ['ACCOUNTANT', 'STAFF', 'VIEWER'] } } }),
      prisma.location.count({ where: { isActive: true } }),
      prisma.scanRecord.count(),
      prisma.syncLog.count({ where: { status: 'SUCCESS' } }),
      prisma.syncLog.count({ where: { status: 'FAILED' } }),
      prisma.adminRequest.count({ where: { status: 'PENDING' } }),
      prisma.user.count({ where: { status: 'EXPIRED' } }),
      prisma.scanRecord.count({ where: { status: { in: ['PENDING', 'MAPPED'] } } }),
    ]);
    return res.json({
      totalPartners,
      totalTeamMembers,
      totalLocations,
      totalScans,
      totalSynced,
      totalFailed,
      totalPendingRequests,
      expiredMembers,
      totalPending,
    });
  } catch (err) {
    console.error('[Owner] stats error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/owner/invites  (OWNER only) ──────────────────────────────────────
router.get('/invites', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip, take } = parsePagination(req.query);
    const createdBy = req.query.createdBy as string | undefined;

    // Build where clause — optional createdBy filter
    const where: Record<string, unknown> = {};
    if (createdBy) {
      where.createdBy = createdBy;
    }

    const [total, inviteLinks] = await Promise.all([
      prisma.inviteLink.count({ where }),
      prisma.inviteLink.findMany({
        where,
        include: { creator: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    // Compute isActive per invite — Owner can see full token
    const invites = inviteLinks.map((inv) => ({
      id: inv.id,
      token: inv.token,              // Owner can see the full token for debugging/resending
      roleHint: inv.roleHint,
      expiresAt: inv.expiresAt,
      usedAt: inv.usedAt,
      maxUses: inv.maxUses,
      useCount: inv.useCount,
      createdAt: inv.createdAt,
      isActive: new Date() <= inv.expiresAt && inv.useCount < inv.maxUses,
      creatorName: inv.creator?.name ?? null,
      creatorEmail: inv.creator?.email ?? '',
    }));

    return res.json({ invites, pagination: buildPaginationMeta(total, page, limit) });
  } catch (err) {
    console.error('[Owner] listInviteLinks error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── DELETE /api/owner/invites/:id  (OWNER only) ──────────────────────────────
router.delete('/invites/:id', async (req: AuthRequest, res: Response) => {
  try {
    const inviteId = req.params['id'] as string;
    const invite = await prisma.inviteLink.findUnique({ where: { id: inviteId } });
    if (!invite) return res.status(404).json({ error: 'Invite not found.' });

    // Hard delete — Owner can revoke anyone's invite, no ownership check
    await prisma.inviteLink.delete({ where: { id: inviteId } });

    await logAction({
      actorId: req.user!.userId,
      action: 'INVITE_REVOKED',
      details: { inviteId: invite.id, revokedBy: 'owner', useCountAtRevocation: invite.useCount },
    });

    return res.json({ message: 'Invite revoked' });
  } catch (err) {
    console.error('[Owner] revokeInviteLink error:', err);
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

function buildUserForAccess(user: { role: UserRole; status: UserStatus; blocked: boolean; timeBombAt: Date | string | null; gracePeriodHours: number; permissions: unknown; }): UserForAccess {
  return {
    role: user.role,
    status: user.status,
    blocked: user.blocked,
    timeBombAt: user.timeBombAt,
    gracePeriodHours: user.gracePeriodHours,
    permissions: user.permissions,
  };
}

router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip, take } = parsePagination(req.query);
    const role = req.query['role'] ? String(req.query['role']) : undefined;
    const status = req.query['status'] ? String(req.query['status']) : undefined;
    const search = req.query['search'] ? String(req.query['search']).trim() : undefined;

    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

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
          adminId: true,
          blocked: true,
          timeBombAt: true,
          gracePeriodHours: true,
          approvedAt: true,
          approvedById: true,
          createdAt: true,
          admin: { select: { name: true } },
          permissions: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    const result = users.map(user => {
      const effectiveAccess = getEffectiveAccess(buildUserForAccess(user));
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        adminId: user.adminId,
        adminName: user.admin?.name ?? null,
        blocked: user.blocked,
        timeBombAt: user.timeBombAt,
        gracePeriodHours: user.gracePeriodHours,
        approvedAt: user.approvedAt,
        approvedById: user.approvedById,
        createdAt: user.createdAt,
        effectiveAccess,
      };
    });

    return res.json({ users: result, pagination: buildPaginationMeta(total, page, limit) });
  } catch (err) {
    console.error('[Owner] getUsers error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.get('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        adminId: true,
        blocked: true,
        blockedById: true,
        timeBombAt: true,
        gracePeriodHours: true,
        approvedAt: true,
        approvedById: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
        admin: { select: { name: true } },
        blockedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
    });

    if (!user) return res.status(404).json({ error: 'User not found.' });

    const effectiveAccess = getEffectiveAccess(buildUserForAccess(user));
    const effectivePermissions = ALL_FEATURES.map(feature => ({
      feature,
      actions: ALL_ACTIONS.filter(action => hasPermission(buildUserForAccess(user), feature, action)),
    }));

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        adminId: user.adminId,
        adminName: user.admin?.name ?? null,
        blocked: user.blocked,
        blockedById: user.blockedById,
        blockedByName: user.blockedBy?.name ?? null,
        timeBombAt: user.timeBombAt,
        gracePeriodHours: user.gracePeriodHours,
        approvedAt: user.approvedAt,
        approvedById: user.approvedById,
        approvedByName: user.approvedBy?.name ?? null,
        permissions: user.permissions as Record<string, boolean> | null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        effectiveAccess,
        effectivePermissions,
      },
    });
  } catch (err) {
    console.error('[Owner] getUser error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.patch('/users/:id/block', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const { blocked } = req.body as { blocked: boolean };

    if (typeof blocked !== 'boolean') {
      return res.status(400).json({ error: 'blocked must be a boolean' });
    }
    if (id === req.user!.userId) {
      return res.status(400).json({ error: 'Cannot modify your own account' });
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role === 'OWNER') return res.status(400).json({ error: 'Cannot block an owner' });

    let updateData: Record<string, unknown>;
    const actionDetails: { action: 'USER_BLOCKED' | 'USER_UNBLOCKED'; details: Prisma.InputJsonValue } = blocked
      ? { action: 'USER_BLOCKED', details: { blockedById: req.user!.userId } }
      : { action: 'USER_UNBLOCKED', details: {} };

    if (blocked) {
      updateData = { blocked: true, status: 'BLOCKED', blockedById: req.user!.userId };
    } else {
      if (target.status !== 'BLOCKED') {
        return res.status(400).json({ error: 'User is not blocked' });
      }
      updateData = { blocked: false, status: 'ACTIVE', blockedById: null };
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        adminId: true,
        blocked: true,
        timeBombAt: true,
        gracePeriodHours: true,
        approvedAt: true,
        approvedById: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await logAction({
      actorId: req.user!.userId,
      action: actionDetails.action,
      targetUserId: id,
      details: actionDetails.details,
    });

    return res.json({ user: { ...updated, effectiveAccess: getEffectiveAccess(buildUserForAccess(updated)) } });
  } catch (err) {
    console.error('[Owner] blockUser error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.patch('/users/:id/timebomb', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const { timeBombAt, gracePeriodHours } = req.body as { timeBombAt?: string; gracePeriodHours?: number };

    if (typeof timeBombAt !== 'string') {
      return res.status(400).json({ error: 'timeBombAt is required' });
    }
    if (id === req.user!.userId) {
      return res.status(400).json({ error: 'Cannot modify your own account' });
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role === 'OWNER') return res.status(400).json({ error: 'Cannot modify an owner account' });

    const bombDate = new Date(timeBombAt);
    if (isNaN(bombDate.getTime()) || bombDate <= new Date()) {
      return res.status(400).json({ error: 'timeBombAt must be a future date' });
    }
    if (gracePeriodHours !== undefined && (typeof gracePeriodHours !== 'number' || gracePeriodHours <= 0)) {
      return res.status(400).json({ error: 'gracePeriodHours must be a positive number' });
    }

    const updateData: Record<string, unknown> = { timeBombAt: bombDate };
    if (gracePeriodHours !== undefined) updateData.gracePeriodHours = gracePeriodHours;

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        adminId: true,
        blocked: true,
        timeBombAt: true,
        gracePeriodHours: true,
        approvedAt: true,
        approvedById: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await logAction({
      actorId: req.user!.userId,
      action: 'TIME_BOMB_SET',
      targetUserId: id,
      details: { timeBombAt: bombDate, gracePeriodHours: updated.gracePeriodHours, targetRole: updated.role },
    });

    return res.json({ user: { ...updated, effectiveAccess: getEffectiveAccess(buildUserForAccess(updated)) } });
  } catch (err) {
    console.error('[Owner] setTimeBomb error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.patch('/users/:id/timebomb/clear', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    if (id === req.user!.userId) {
      return res.status(400).json({ error: 'Cannot modify your own account' });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, timeBombAt: true, status: true, role: true },
    });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (!target.timeBombAt) {
      return res.status(400).json({ error: 'No time bomb set' });
    }

    const updateData: Record<string, unknown> = { timeBombAt: null };
    if (target.status === 'GRACE_PERIOD' || target.status === 'TIME_BOMBED') {
      updateData.status = 'ACTIVE';
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        adminId: true,
        blocked: true,
        timeBombAt: true,
        gracePeriodHours: true,
        approvedAt: true,
        approvedById: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await logAction({
      actorId: req.user!.userId,
      action: 'TIME_BOMB_CLEARED',
      targetUserId: id,
      details: { previousStatus: target.status },
    });

    return res.json({ user: { ...updated, effectiveAccess: getEffectiveAccess(buildUserForAccess(updated)) } });
  } catch (err) {
    console.error('[Owner] clearTimeBomb error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.patch('/users/:id/role', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const { role } = req.body as { role?: string };

    if (!role || typeof role !== 'string') {
      return res.status(400).json({ error: 'Role is required' });
    }
    if (id === req.user!.userId) {
      return res.status(400).json({ error: 'Cannot modify your own account' });
    }

    const validRoles = Object.values(UserRole) as string[];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (role === 'OWNER') {
      return res.status(400).json({ error: 'Cannot assign OWNER role here' });
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role === 'OWNER') {
      return res.status(400).json({ error: 'Cannot modify an owner account' });
    }

    const updateData: Record<string, unknown> = { role };
    if (target.status === 'PENDING_APPROVAL') {
      updateData.approvedAt = new Date();
      updateData.approvedById = req.user!.userId;
      updateData.status = 'ACTIVE';
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        adminId: true,
        blocked: true,
        timeBombAt: true,
        gracePeriodHours: true,
        approvedAt: true,
        approvedById: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await logAction({
      actorId: req.user!.userId,
      action: 'ROLE_CHANGE',
      targetUserId: id,
      details: { previousRole: target.role, newRole: role },
    });

    return res.json({ user: { ...updated, effectiveAccess: getEffectiveAccess(buildUserForAccess(updated)) } });
  } catch (err) {
    console.error('[Owner] changeUserRole error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.patch('/users/:id/permissions', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const permissions = req.body?.permissions;

    if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
      return res.status(400).json({ error: 'permissions must be an object' });
    }
    if (id === req.user!.userId) {
      return res.status(400).json({ error: 'Cannot modify your own account' });
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role === 'OWNER') {
      return res.status(400).json({ error: 'Cannot modify an owner account' });
    }

    const validKeys = new Set<string>();
    for (const f of ALL_FEATURES) {
      for (const a of ALL_ACTIONS) {
        validKeys.add(`${f}:${a}`);
      }
    }

    const invalidKeys = Object.keys(permissions).filter(key => !validKeys.has(key));
    if (invalidKeys.length > 0) {
      return res.status(400).json({ error: 'Invalid permission keys', invalidKeys });
    }

    for (const [key, value] of Object.entries(permissions)) {
      if (typeof value !== 'boolean') {
        return res.status(400).json({ error: 'Permission values must be boolean' });
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { permissions },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        adminId: true,
        blocked: true,
        timeBombAt: true,
        gracePeriodHours: true,
        approvedAt: true,
        approvedById: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await logAction({
      actorId: req.user!.userId,
      action: 'PERMISSION_OVERRIDE',
      targetUserId: id,
      details: { overrideCount: Object.keys(permissions).length, permissions },
    });

    return res.json({ user: { ...updated, effectiveAccess: getEffectiveAccess(buildUserForAccess(updated)) } });
  } catch (err) {
    console.error('[Owner] setPermissionOverrides error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.post('/users/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true, email: true, role: true, blocked: true, timeBombAt: true, gracePeriodHours: true, permissions: true, adminId: true, approvedAt: true, approvedById: true, createdAt: true, updatedAt: true } });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({ error: 'User is not pending approval' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { approvedAt: new Date(), approvedById: req.user!.userId, status: 'ACTIVE' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        adminId: true,
        blocked: true,
        timeBombAt: true,
        gracePeriodHours: true,
        approvedAt: true,
        approvedById: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await logAction({
      actorId: req.user!.userId,
      action: 'APPROVAL_GRANTED',
      targetUserId: id,
      details: { targetEmail: target.email, targetRole: target.role },
    });

    return res.json({ user: { ...updated, effectiveAccess: getEffectiveAccess(buildUserForAccess(updated)) } });
  } catch (err) {
    console.error('[Owner] approveUser error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.post('/users/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true, email: true, role: true } });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({ error: 'User is not pending approval' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { status: 'DISABLED' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        adminId: true,
        blocked: true,
        timeBombAt: true,
        gracePeriodHours: true,
        approvedAt: true,
        approvedById: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await logAction({
      actorId: req.user!.userId,
      action: 'APPROVAL_REJECTED',
      targetUserId: id,
      details: { targetEmail: target.email, targetRole: target.role },
    });

    return res.json({ user: updated, message: 'User rejected and disabled' });
  } catch (err) {
    console.error('[Owner] rejectUser error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.post('/transfer', async (req: AuthRequest, res: Response) => {
  try {
    const { targetUserId, confirmPassword } = req.body as { targetUserId?: string; confirmPassword?: string };
    if (!targetUserId || typeof targetUserId !== 'string' || !confirmPassword || typeof confirmPassword !== 'string') {
      return res.status(400).json({ error: 'targetUserId and confirmPassword are required' });
    }
    if (targetUserId === req.user!.userId) {
      return res.status(400).json({ error: 'Cannot transfer ownership to yourself' });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, email: true, role: true } });
    if (!targetUser) return res.status(404).json({ error: 'Target user not found.' });
    if (targetUser.role !== 'ADMIN') {
      return res.status(400).json({ error: 'Target user must be an admin' });
    }

    const owner = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { id: true, email: true, password: true } });
    if (!owner || !owner.password) {
      return res.status(404).json({ error: 'Owner not found' });
    }

    const passwordMatch = await bcrypt.compare(confirmPassword, owner.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const [previousOwner, newOwner] = await prisma.$transaction([
      prisma.user.update({
        where: { id: owner.id },
        data: { role: 'ADMIN' },
        select: { id: true, email: true, role: true, status: true, adminId: true },
      }),
      prisma.user.update({
        where: { id: targetUser.id },
        data: { role: 'OWNER', adminId: null, transferredFromId: owner.id },
        select: { id: true, email: true, role: true, status: true, adminId: true },
      }),
    ]);

    await logAction({
      actorId: owner.id,
      action: 'OWNER_TRANSFER',
      targetUserId: targetUser.id,
      details: {
        previousOwnerId: owner.id,
        newOwnerId: targetUser.id,
        previousOwnerEmail: owner.email,
        newOwnerEmail: targetUser.email,
      },
    });

    return res.json({ previousOwner, newOwner });
  } catch (err) {
    console.error('[Owner] transferOwnership error:', err);
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
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10) || 50));
    const skip = (page - 1) * limit;

    const action = req.query['action'] ? String(req.query['action']) : undefined;
    const actorId = req.query['actorId'] ? String(req.query['actorId']) : undefined;
    const targetUserId = req.query['targetUserId'] ? String(req.query['targetUserId']) : undefined;
    const fromDate = req.query['from'] ?? req.query['dateFrom'];
    const toDate = req.query['to'] ?? req.query['dateTo'];

    const where: Record<string, unknown> = {};
    if (action) where.action = { equals: action };
    if (actorId) where.actorId = actorId;
    if (targetUserId) where.targetUserId = targetUserId;
    if (fromDate || toDate) {
      const createdAt: Record<string, unknown> = {};
      if (fromDate) createdAt['gte'] = new Date(String(fromDate));
      if (toDate) createdAt['lte'] = new Date(String(toDate));
      where.createdAt = createdAt;
    }

    const [total, logs] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, name: true, email: true } },
          targetUser: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return res.json({ logs, pagination: buildPaginationMeta(total, page, limit) });
  } catch (err) {
    console.error('[Owner] getAuditLog error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
