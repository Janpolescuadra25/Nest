import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { sendWelcomeEmail, sendTrialRenewed } from '../lib/email';
import { validate } from '../middleware/validate';
import { teamInviteSchema, patchTeamMemberSchema } from '../lib/validators';
import { parsePagination, buildPaginationMeta } from '../lib/pagination';

const router = Router();

// All admin routes require authentication + at least OWNER or ADMIN role
router.use(authenticate, requireRole('OWNER', 'ADMIN'));

// ── GET /api/admin/team  (ADMIN only) ─────────────────────────────────────────
router.get('/team', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip, take } = parsePagination(req.query);
    const where = { adminId: req.user!.userId };
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
    console.error('[Admin] getTeam error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/admin/stats  (ADMIN only) ───────────────────────────────────────
router.get('/stats', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.user!.userId;
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const [teamSize, maxUsersValue, totalScans, totalSynced, totalFailed, expiringSoon] = await Promise.all([
      prisma.user.count({ where: { adminId } }),
      prisma.user.findUnique({ where: { id: adminId }, select: { maxUsers: true } }),
      prisma.scanRecord.count({ where: { location: { adminId } } }),
      prisma.syncLog.count({ where: { status: 'SUCCESS', scanRecord: { location: { adminId } } } }),
      prisma.syncLog.count({ where: { status: 'FAILED', scanRecord: { location: { adminId } } } }),
      prisma.user.count({
        where: {
          adminId,
          status: 'ACTIVE',
          trialExpiresAt: {
            gte: now,
            lte: threeDaysFromNow,
          },
        },
      }),
    ]);

    return res.json({
      teamSize,
      maxUsers: maxUsersValue?.maxUsers ?? 0,
      totalScans,
      totalSynced,
      totalFailed,
      expiringSoon,
    });
  } catch (err) {
    console.error('[Admin] stats error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/admin/audit-log  (ADMIN only) ───────────────────────────────────
router.get('/audit-log', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.user!.userId;
    const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '10'), 10) || 10));

    const teamMembers = await prisma.user.findMany({
      where: { adminId },
      select: { id: true },
    });
    const actorIds = [adminId, ...teamMembers.map(member => member.id)];

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: { actorId: { in: actorIds } },
        include: {
          actor: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where: { actorId: { in: actorIds } } }),
    ]);

    return res.json({ logs, total, page, limit });
  } catch (err) {
    console.error('[Admin] audit-log error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── POST /api/admin/team/invite  (ADMIN only) ─────────────────────────────────
router.post('/team/invite', requireRole('ADMIN'), validate(teamInviteSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { email, role, name } = req.body as { email?: string; role?: string; name?: string };

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }
    const validRoles = ['STAFF', 'ACCOUNTANT', 'VIEWER'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Role must be one of: STAFF, ACCOUNTANT, VIEWER.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(409).json({ error: 'A user with this email already exists.' });

    const admin = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { maxUsers: true },
    });

    if (admin && admin.maxUsers !== null) {
      const teamSize = await prisma.user.count({ where: { adminId: req.user!.userId } });
      if (teamSize >= admin.maxUsers) {
        return res.status(403).json({ error: 'Team is full. Contact Nest support to increase your limit.' });
      }
    }

    const permissionDefaultsMap: Record<string, { canScan: boolean; canMap: boolean; canSync: boolean; canManageLocs: boolean }> = {
      VIEWER:     { canScan: false, canMap: false, canSync: false, canManageLocs: false },
      STAFF:      { canScan: true,  canMap: false, canSync: false, canManageLocs: false },
      ACCOUNTANT: { canScan: true,  canMap: true,  canSync: true,  canManageLocs: false },
    };
    const perms = permissionDefaultsMap[role] ?? { canScan: false, canMap: false, canSync: false, canManageLocs: false };

    const tempPassword = randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name?.trim() ?? null,
        password: hashedPassword,
        role: role as 'STAFF' | 'ACCOUNTANT' | 'VIEWER',
        adminId: req.user!.userId,
        status: 'ACTIVE',
        mustChangePassword: true,
        ...perms,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        action: 'USER_INVITED',
        targetId: newUser.id,
        meta: { role, email: normalizedEmail },
      },
    });

    sendWelcomeEmail({ to: newUser.email, name: newUser.name, tempPassword }).catch(() => {});

    return res.status(201).json({
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role, adminId: newUser.adminId },
      tempPassword,
    });
  } catch (err) {
    console.error('[Admin] inviteTeamMember error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── PATCH /api/admin/team/:id  (ADMIN only) ───────────────────────────────────
router.patch('/team/:id', requireRole('ADMIN'), validate(patchTeamMemberSchema), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const {
      role, canScan, canMap, canSync, canManageLocs,
      trialExpiresAt, customExpiryMessage, status,
    } = req.body as {
      role?: string;
      canScan?: boolean;
      canMap?: boolean;
      canSync?: boolean;
      canManageLocs?: boolean;
      trialExpiresAt?: string | null;
      customExpiryMessage?: string | null;
      status?: string;
    };

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.adminId !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only manage your own team members.' });
    }
    if (target.role === 'OWNER' || target.role === 'ADMIN') {
      return res.status(403).json({ error: 'Cannot modify OWNER or ADMIN accounts.' });
    }

    // ── Trial-reset branch (only when trialExpiresAt is set to a date) ─────────
    let isTrialReset = false;
    let newExpiryDate: Date | null = null;

    if (trialExpiresAt) {
      newExpiryDate = new Date(trialExpiresAt);
      if (isNaN(newExpiryDate.getTime()) || newExpiryDate <= new Date()) {
        return res.status(400).json({ error: 'trialExpiresAt must be a future date' });
      }
      if (target.status === 'DISABLED') {
        return res.status(400).json({ error: 'Cannot reset trial for a disabled user' });
      }
      isTrialReset = true;
    }

    const updateData: Record<string, unknown> = {};
    if (role !== undefined) updateData['role'] = role;

    // EXPIRED → ACTIVE: default all permissions to true unless body explicitly sets them
    if (isTrialReset && target.status === 'EXPIRED') {
      updateData['status'] = 'ACTIVE';
      updateData['canScan'] = canScan !== undefined ? canScan : true;
      updateData['canMap'] = canMap !== undefined ? canMap : true;
      updateData['canSync'] = canSync !== undefined ? canSync : true;
      updateData['canManageLocs'] = canManageLocs !== undefined ? canManageLocs : true;
    } else {
      if (canScan !== undefined) updateData['canScan'] = canScan;
      if (canMap !== undefined) updateData['canMap'] = canMap;
      if (canSync !== undefined) updateData['canSync'] = canSync;
      if (canManageLocs !== undefined) updateData['canManageLocs'] = canManageLocs;
      if (status !== undefined) updateData['status'] = status;
    }

    if (trialExpiresAt !== undefined) updateData['trialExpiresAt'] = newExpiryDate;
    if (customExpiryMessage !== undefined) updateData['customExpiryMessage'] = customExpiryMessage;

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true, email: true, name: true, role: true, status: true,
        canScan: true, canMap: true, canSync: true, canManageLocs: true,
        trialExpiresAt: true, customExpiryMessage: true, mustChangePassword: true,
      },
    });

    // ── Standard audit entries ────────────────────────────────────────────────
    const auditEntries: Array<{ actorId: string; action: string; targetId: string; meta?: object }> = [];
    if (role !== undefined) {
      auditEntries.push({ actorId: req.user!.userId, action: 'ROLE_CHANGED', targetId: id, meta: { newRole: role } });
    }
    if (!isTrialReset) {
      const permKeys = (['canScan', 'canMap', 'canSync', 'canManageLocs'] as const).filter(k => req.body[k] !== undefined);
      if (permKeys.length > 0) {
        const changes: Record<string, unknown> = {};
        permKeys.forEach(k => { changes[k] = req.body[k]; });
        auditEntries.push({ actorId: req.user!.userId, action: 'PERMISSION_UPDATED', targetId: id, meta: { changes } });
      }
      if (trialExpiresAt !== undefined || customExpiryMessage !== undefined) {
        auditEntries.push({ actorId: req.user!.userId, action: 'TIMEBOMB_SET', targetId: id, meta: { trialExpiresAt, customExpiryMessage } });
      }
      if (status !== undefined) {
        auditEntries.push({ actorId: req.user!.userId, action: 'USER_STATUS_CHANGED', targetId: id, meta: { newStatus: status } });
      }
    }
    if (auditEntries.length > 0) {
      await prisma.auditLog.createMany({ data: auditEntries });
    }

    // ── Trial-reset post-processing ───────────────────────────────────────────
    if (isTrialReset && newExpiryDate) {
      // Always delete old warning logs so the cron re-fires for the new expiry
      await prisma.auditLog.deleteMany({
        where: { targetId: id, action: 'TRIAL_EXPIRY_WARNING' },
      });

      await prisma.auditLog.create({
        data: {
          actorId: req.user!.userId,
          targetId: id,
          action: 'TRIAL_RESET',
          meta: {
            previousStatus: target.status,
            previousTrialExpiresAt: target.trialExpiresAt,
            newTrialExpiresAt: newExpiryDate,
            permissionsSet: {
              canScan: updated.canScan,
              canMap: updated.canMap,
              canSync: updated.canSync,
              canManageLocs: updated.canManageLocs,
            },
          },
        },
      });

      sendTrialRenewed({
        to: updated.email,
        name: updated.name,
        newExpiryDate,
        customExpiryMessage: updated.customExpiryMessage,
      }).catch(() => {});
    }

    return res.json({ user: updated });
  } catch (err) {
    console.error('[Admin] patchTeamMember error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── POST /api/admin/team/:id/disable  (ADMIN only) ───────────────────────────
router.post('/team/:id/disable', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.adminId !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only manage your own team members.' });
    }
    if (target.role === 'OWNER' || target.role === 'ADMIN') {
      return res.status(403).json({ error: 'Cannot disable OWNER or ADMIN accounts.' });
    }

    await prisma.user.update({ where: { id }, data: { status: 'DISABLED' } });

    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, action: 'USER_DISABLED', targetId: id },
    });

    return res.json({ message: 'User disabled successfully.' });
  } catch (err) {
    console.error('[Admin] disableTeamMember error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
