import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import jwt from 'jsonwebtoken';
import { UserRole, UserStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuthPayload } from '../types';
import { getEffectiveAccess, hasPermission, UserForAccess, EffectiveAccess } from './effective-role';
import { Feature, Action } from './permissions';

const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
  effectiveAccess?: EffectiveAccess;
}

/**
 * Verifies the Bearer JWT, fetches the full user row from the DB,
 * checks the account is not DISABLED, and attaches req.user.
 */
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Missing or malformed Authorization header', 401));
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        adminId: true,
        mustChangePassword: true,
        trialExpiresAt: true,
        maxUsers: true,
        permissions: true,
        timeBombAt: true,
        gracePeriodHours: true,
        blocked: true,
        maxScans: true,
        scanHistoryDays: true,
        blockedById: true,
        approvedById: true,
        approvedAt: true,
        invitedById: true,
        transferredFromId: true,
      },
    });

    if (!user) {
      return next(new AppError('User not found', 401));
    }

    if (user.status === 'DISABLED') {
      return next(new AppError('Account is disabled', 403));
    }

    if (user.mustChangePassword && req.method !== 'GET' && req.path !== '/api/auth/change-password') {
      res.status(403).json({ error: 'You must change your password before continuing.', code: 'MUST_CHANGE_PASSWORD' });
      return;
    }

    req.user = {
      id: user.id,
      userId: user.id,   // backward-compat alias — existing routes use this
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      adminId: user.adminId,
      mustChangePassword: user.mustChangePassword,
      trialExpiresAt: user.trialExpiresAt,
      maxUsers: user.maxUsers,
      permissions: user.permissions as Record<string, boolean> | null,
      timeBombAt: user.timeBombAt,
      gracePeriodHours: user.gracePeriodHours,
      blocked: user.blocked,
      blockedById: user.blockedById,
      maxScans: user.maxScans,
      scanHistoryDays: user.scanHistoryDays,
      approvedById: user.approvedById,
      approvedAt: user.approvedAt,
      invitedById: user.invitedById,
      transferredFromId: user.transferredFromId,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      return next(new AppError('Invalid or expired token', 401));
    } else {
      console.error('[Auth] Middleware error:', err);
      return next(new AppError('Authentication service unavailable', 500));
    }
  }
}

/**
 * Middleware factory — requires the authenticated user to have one of the given roles.
 * Uses getEffectiveAccess to account for time bombs, blocked status, and pending approval.
 * Place after `authenticate`.
 *
 * Note: DISABLED users are blocked by `authenticate` before reaching here.
 */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Not authenticated', 401));
    }

    const userForAccess: UserForAccess = {
      role: req.user.role as UserRole,
      status: req.user.status as UserStatus,
      blocked: req.user.blocked,
      timeBombAt: req.user.timeBombAt ?? null,
      gracePeriodHours: req.user.gracePeriodHours,
      permissions: req.user.permissions,
    };

    const effectiveAccess = getEffectiveAccess(userForAccess);

    if (effectiveAccess.isBlocked) {
      return next(new AppError('Account suspended', 403));
    }

    if (effectiveAccess.status === 'PENDING_APPROVAL') {
      return next(new AppError('Account pending approval', 403));
    }

    if (!roles.includes(effectiveAccess.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }

    req.effectiveAccess = effectiveAccess;

    if (effectiveAccess.isInGracePeriod && effectiveAccess.gracePeriodEndsAt) {
      res.setHeader('X-Access-Warning', 'GRACE_PERIOD');
      res.setHeader('X-Grace-Period-Ends', effectiveAccess.gracePeriodEndsAt.toISOString());
    }

    next();
  };
}

/**
 * Middleware factory — ensures a sub-user can only act on their own team.
 * OWNER bypasses the check entirely; ADMIN may only target themselves.
 * @param paramField - name of the Express route param holding the target user id
 */
export function requireOwnTeam(paramField: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const user = req.user!;
    if (user.role === 'OWNER') { next(); return; }

    const targetId = req.params[paramField];
    if (user.role === 'ADMIN' && targetId === user.userId) { next(); return; }

    return next(new AppError('Access denied', 403));
  };
}

/**
 * Returns a Prisma `where` fragment that scopes Location queries to the
 * set of locations visible to the current user.
 *
 *   OWNER       → no filter (sees everything)
 *   ADMIN       → adminId = their own userId
 *   sub-users   → adminId = their admin's userId
 *   legacy      → userId = their own userId (no adminId yet assigned)
 */
export function locationFilter(user: AuthPayload): Record<string, unknown> {
  if (user.role === 'OWNER') return {};
  if (user.role === 'ADMIN') return { adminId: user.userId };
  if (user.adminId) return { adminId: user.adminId };
  // Legacy fallback for users who pre-date the hierarchy
  return { userId: user.userId };
}

/**
 * Middleware factory — requires a specific Feature:Action permission.
 * Use this for new routes that need fine-grained permission checks.
 * OWNER always passes.
 * Place after `authenticate`.
 */
export const requireFeaturePermission = (feature: Feature, action: Action) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Not authenticated', 401));
    }

    const userForAccess: UserForAccess = {
      role: req.user.role as UserRole,
      status: req.user.status as UserStatus,
      blocked: req.user.blocked,
      timeBombAt: req.user.timeBombAt ?? null,
      gracePeriodHours: req.user.gracePeriodHours,
      permissions: req.user.permissions,
    };

    if (!hasPermission(userForAccess, feature, action)) {
      return next(new AppError('Insufficient permissions', 403));
    }

    next();
  };
};
