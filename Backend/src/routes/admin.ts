import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { UserRole, UserStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { sendWelcomeEmail, sendTrialRenewed } from '../lib/email';
import { validate } from '../middleware/validate';
import { teamInviteSchema, patchTeamMemberSchema, inviteLinkSchema } from '../lib/validators';
import { parsePagination, buildPaginationMeta } from '../lib/pagination';
import { logAction } from '../middleware/audit';
import { createInviteLink } from '../utils/invite.utils';
import { enforceEffectiveRole, UserForAccess, EffectiveAccess, getEffectiveAccess } from '../middleware/effective-role';

const router = Router();

const permissionDefaultsMap: Record<string, { canScan: boolean; canMap: boolean; canSync: boolean; canManageLocs: boolean }> = {
  VIEWER:     { canScan: false, canMap: false, canSync: false, canManageLocs: false },
  STAFF:      { canScan: true,  canMap: false, canSync: false, canManageLocs: false },
  ACCOUNTANT: { canScan: true,  canMap: true,  canSync: true, canManageLocs: false },
};

function buildUserForAccess(user: {
  role: string;
  status: string;
  blocked: boolean;
  timeBombAt: Date | string | null;
  gracePeriodHours: number;
  permissions: unknown;
}): UserForAccess {
  return {
    role: user.role as UserRole,
    status: user.status as UserStatus,
    blocked: user.blocked,
    timeBombAt: user.timeBombAt,
    gracePeriodHours: user.gracePeriodHours,
    permissions: user.permissions,
  };
}

// All admin routes require authentication + at least OWNER or ADMIN role
router.use(authenticate, requireRole('OWNER', 'ADMIN'));
router.use(enforceEffectiveRole);  // defense-in-depth: blocks TIME_BOMBED/BLOCKED/PENDING_APPROVAL writes

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
          timeBombAt: true,
          gracePeriodHours: true,
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

    const [teamSize, maxUsersValue, totalScans, totalSynced, totalFailed, expiringSoon, totalPending] = await Promise.all([
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
      prisma.scanRecord.count({
        where: {
          location: { adminId },
          status: { in: ['PENDING', 'MAPPED'] },
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
      totalPending,
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
        targetUserId: newUser.id,
        details: { role, email: normalizedEmail },
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

// ── POST /api/admin/invite  (OWNER + ADMIN) ──────────────────────────────────
router.post('/invite', validate(inviteLinkSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { roleHint, expiresInHours, maxUses } = req.body as {
      roleHint?: string;
      expiresInHours?: number;
      maxUses?: number;
    };

    // Role hint restrictions based on caller role
    const validAdminRoles: string[] = ['STAFF', 'VIEWER', 'ACCOUNTANT'];
    const validOwnerRoles: string[] = ['STAFF', 'VIEWER', 'ACCOUNTANT', 'ADMIN'];
    const allRoles = Object.values(UserRole) as string[];

    if (roleHint && !allRoles.includes(roleHint)) {
      return res.status(400).json({ error: 'Invalid role hint.' });
    }

    const isOwner = req.user!.role === 'OWNER';
    const allowedRoles = isOwner ? validOwnerRoles : validAdminRoles;
    const resolvedRoleHint = (roleHint && allowedRoles.includes(roleHint) ? roleHint : 'VIEWER') as UserRole;

    if (roleHint && !allowedRoles.includes(roleHint)) {
      return res.status(400).json({ error: 'Cannot invite users with admin role.' });
    }

    // ExpiresInHours bounds: > 0 and <= 720
    const hours = expiresInHours ?? 72;
    if (hours <= 0 || hours > 720) {
      return res.status(400).json({ error: 'expiresInHours must be between 1 and 720.' });
    }

    // MaxUses bounds: > 0 and <= 100
    const uses = maxUses ?? 1;
    if (uses <= 0 || uses > 100) {
      return res.status(400).json({ error: 'maxUses must be between 1 and 100.' });
    }

    // User limit check — only enforce if maxUsers is non-null
    if (req.user!.maxUsers !== null) {
      const teamSize = await prisma.user.count({
        where: { adminId: req.user!.userId, status: { not: 'DISABLED' } },
      });
      if (teamSize >= req.user!.maxUsers) {
        return res.status(403).json({ error: 'User limit reached. Request an increase from the account owner.' });
      }
    }

    // Create invite via shared utility
    const invite = await createInviteLink({
      createdBy: req.user!.userId,
      roleHint: resolvedRoleHint,
      maxUses: uses,
      expiresInHours: hours,
    });

    await logAction({
      actorId: req.user!.userId,
      action: 'INVITE_CREATED',
      details: { roleHint: resolvedRoleHint, maxUses: uses, expiresInHours: hours },
    });

    return res.status(201).json({
      invite: {
        id: invite.id,
        token: invite.token,         // full plaintext token — only the creator gets this
        roleHint: invite.roleHint,
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
        createdAt: invite.createdAt,
      },
    });
  } catch (err) {
    console.error('[Admin] createInviteLink error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/admin/invites  (OWNER + ADMIN) ──────────────────────────────────
router.get('/invites', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip, take } = parsePagination(req.query);
    const where = { createdBy: req.user!.userId };

    const [total, inviteLinks] = await Promise.all([
      prisma.inviteLink.count({ where }),
      prisma.inviteLink.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    // Compute isActive per invite and strip token
    const invites = inviteLinks.map((inv) => ({
      id: inv.id,
      roleHint: inv.roleHint,
      expiresAt: inv.expiresAt,
      usedAt: inv.usedAt,
      maxUses: inv.maxUses,
      useCount: inv.useCount,
      createdAt: inv.createdAt,
      isActive: new Date() <= inv.expiresAt && inv.useCount < inv.maxUses,
    }));

    return res.json({ invites, pagination: buildPaginationMeta(total, page, limit) });
  } catch (err) {
    console.error('[Admin] listInviteLinks error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── DELETE /api/admin/invites/:id  (OWNER + ADMIN) ──────────────────────────
router.delete('/invites/:id', async (req: AuthRequest, res: Response) => {
  try {
    const inviteId = req.params['id'] as string;
    const invite = await prisma.inviteLink.findUnique({ where: { id: inviteId } });
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found.' });
    }
    if (invite.createdBy !== req.user!.userId) {
      return res.status(403).json({ error: "Cannot revoke an invite you didn't create." });
    }

    // Hard delete the invite
    await prisma.inviteLink.delete({ where: { id: inviteId } });

    await logAction({
      actorId: req.user!.userId,
      action: 'INVITE_REVOKED',
      details: { inviteId: invite.id, useCountAtRevocation: invite.useCount },
    });

    return res.json({ message: 'Invite revoked' });
  } catch (err) {
    console.error('[Admin] revokeInviteLink error:', err);
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
    const auditEntries: Array<{ actorId: string; action: string; targetUserId: string; details?: object }> = [];
    if (role !== undefined) {
      auditEntries.push({ actorId: req.user!.userId, action: 'ROLE_CHANGED', targetUserId: id, details: { newRole: role } });
    }
    if (!isTrialReset) {
      const permKeys = (['canScan', 'canMap', 'canSync', 'canManageLocs'] as const).filter(k => req.body[k] !== undefined);
      if (permKeys.length > 0) {
        const changes: Record<string, unknown> = {};
        permKeys.forEach(k => { changes[k] = req.body[k]; });
        auditEntries.push({ actorId: req.user!.userId, action: 'PERMISSION_UPDATED', targetUserId: id, details: { changes } });
      }
      if (trialExpiresAt !== undefined || customExpiryMessage !== undefined) {
        auditEntries.push({ actorId: req.user!.userId, action: 'TIMEBOMB_SET', targetUserId: id, details: { trialExpiresAt, customExpiryMessage } });
      }
      if (status !== undefined) {
        auditEntries.push({ actorId: req.user!.userId, action: 'USER_STATUS_CHANGED', targetUserId: id, details: { newStatus: status } });
      }
    }
    if (auditEntries.length > 0) {
      await prisma.auditLog.createMany({ data: auditEntries });
    }

    // ── Trial-reset post-processing ───────────────────────────────────────────
    if (isTrialReset && newExpiryDate) {
      // Always delete old warning logs so the cron re-fires for the new expiry
      await prisma.auditLog.deleteMany({
        where: { targetUserId: id, action: 'TRIAL_EXPIRY_WARNING' },
      });

      await prisma.auditLog.create({
        data: {
          actorId: req.user!.userId,
          targetUserId: id,
          action: 'TRIAL_RESET',
          details: {
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
      data: { actorId: req.user!.userId, action: 'USER_DISABLED', targetUserId: id },
    });

    return res.json({ message: 'User disabled successfully.' });
  } catch (err) {
    console.error('[Admin] disableTeamMember error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── PATCH /api/admin/users/:id/timebomb  (OWNER + ADMIN) ───────────────────
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

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, adminId: true },
    });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role === 'OWNER' || target.role === 'ADMIN') {
      return res.status(403).json({ error: 'Cannot set a time bomb on this user' });
    }
    if (target.adminId !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only manage users in your team' });
    }

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
        id: true, email: true, name: true, role: true, status: true,
        adminId: true, blocked: true, timeBombAt: true, gracePeriodHours: true,
        approvedAt: true, approvedById: true, permissions: true,
        createdAt: true, updatedAt: true,
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
    console.error('[Admin] setTimeBomb error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── PATCH /api/admin/users/:id/timebomb/clear  (OWNER + ADMIN) ────────────────
router.patch('/users/:id/timebomb/clear', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    if (id === req.user!.userId) {
      return res.status(400).json({ error: 'Cannot modify your own account' });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, timeBombAt: true, status: true, role: true, adminId: true },
    });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role === 'OWNER' || target.role === 'ADMIN') {
      return res.status(403).json({ error: 'Cannot modify this user' });
    }
    if (target.adminId !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only manage users in your team' });
    }
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
        id: true, email: true, name: true, role: true, status: true,
        adminId: true, blocked: true, timeBombAt: true, gracePeriodHours: true,
        approvedAt: true, approvedById: true, permissions: true,
        createdAt: true, updatedAt: true,
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
    console.error('[Admin] clearTimeBomb error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── PATCH /api/admin/users/:id/role  (OWNER + ADMIN) ─────────────────────────
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

    const allowedRoles: string[] = ['STAFF', 'ACCOUNTANT', 'VIEWER'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Allowed roles for admin assignment: STAFF, ACCOUNTANT, VIEWER' });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, status: true, adminId: true },
    });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role === 'OWNER' || target.role === 'ADMIN') {
      return res.status(403).json({ error: "Cannot change this user's role" });
    }
    if (target.adminId !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only manage users in your team' });
    }

    // No-op check — still return consistent response shape
    if (target.role === role) {
      const fullUser = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true, email: true, name: true, role: true, status: true,
          adminId: true, blocked: true, timeBombAt: true, gracePeriodHours: true,
          approvedAt: true, approvedById: true, permissions: true,
          createdAt: true, updatedAt: true,
        },
      });
      return res.json({ user: { ...fullUser!, effectiveAccess: getEffectiveAccess(buildUserForAccess(fullUser!)) } });
    }

    const updateData: Record<string, unknown> = { role };
    // Auto-approve PENDING_APPROVAL users on role change (same as owner.ts)
    if (target.status === 'PENDING_APPROVAL') {
      updateData.approvedAt = new Date();
      updateData.approvedById = req.user!.userId;
      updateData.status = 'ACTIVE';
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true, email: true, name: true, role: true, status: true,
        adminId: true, blocked: true, timeBombAt: true, gracePeriodHours: true,
        approvedAt: true, approvedById: true, permissions: true,
        createdAt: true, updatedAt: true,
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
    console.error('[Admin] changeUserRole error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
