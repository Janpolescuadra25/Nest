import { Request, Response, NextFunction } from 'express';
import { UserRole, UserStatus } from '@prisma/client';
import { ROLE_PERMISSIONS, Feature, Action, PermissionKey } from './permissions';
import { AuthPayload } from '../types';

export interface EffectiveAccess {
  role: UserRole;
  status: UserStatus;
  isBlocked: boolean;
  isInGracePeriod: boolean;
  gracePeriodEndsAt: Date | null;
}

export interface UserForAccess {
  role: UserRole;
  status: UserStatus;
  blocked: boolean;
  timeBombAt: Date | string | null;
  gracePeriodHours: number;
  permissions: unknown;
}

/**
 * NOTE: EXPIRED users pass through with their original role intact.
 * This matches existing behavior — EXPIRED users are not blocked at
 * the middleware level; they have read access to some features.
 * DISABLED users are blocked by `authenticate` before reaching this function.
 */
export function getEffectiveAccess(user: UserForAccess): EffectiveAccess {
  // 1. Blocked — absolute override (only checks user.blocked boolean)
  if (user.blocked) {
    return {
      role: user.role,
      status: 'BLOCKED',
      isBlocked: true,
      isInGracePeriod: false,
      gracePeriodEndsAt: null,
    };
  }

  // 2. Pending approval — no access
  if (user.status === 'PENDING_APPROVAL') {
    return {
      role: user.role,
      status: 'PENDING_APPROVAL',
      isBlocked: false,
      isInGracePeriod: false,
      gracePeriodEndsAt: null,
    };
  }

  // 3. Time bomb check
  if (user.timeBombAt) {
    const now = new Date();
    const bombDate = new Date(user.timeBombAt as string | Date);
    if (now < bombDate) {
      // Bomb hasn't fired yet — normal access
      return {
        role: user.role,
        status: user.status,
        isBlocked: false,
        isInGracePeriod: false,
        gracePeriodEndsAt: null,
      };
    }
    const graceEnd = new Date(bombDate.getTime() + (user.gracePeriodHours * 60 * 60 * 1000));
    if (now < graceEnd) {
      // In grace period — full access with warning
      return {
        role: user.role,
        status: 'GRACE_PERIOD',
        isBlocked: false,
        isInGracePeriod: true,
        gracePeriodEndsAt: graceEnd,
      };
    }
    // Past grace period — downgraded to VIEWER, NOT blocked
    return {
      role: 'VIEWER',
      status: 'TIME_BOMBED',
      isBlocked: false,    // ← CRITICAL: NOT blocked, just downgraded
      isInGracePeriod: false,
      gracePeriodEndsAt: null,
    };
  }

  // 4. Normal — use assigned role and status
  return {
    role: user.role,
    status: user.status,
    isBlocked: false,
    isInGracePeriod: false,
    gracePeriodEndsAt: null,
  };
}

/**
 * Check if a user has a specific permission.
 * Checks Owner-set JSON overrides first, then falls back to role defaults.
 */
export function hasPermission(
  user: UserForAccess,
  feature: Feature,
  action: Action,
): boolean {
  const access = getEffectiveAccess(user);

  // Blocked and pending users have no permissions
  if (access.isBlocked || access.status === 'PENDING_APPROVAL') {
    return false;
  }

  // Check if user has an Owner-set override for this specific feature
  const overrides = user.permissions as Record<string, boolean> | null;
  if (overrides) {
    const key: PermissionKey = `${feature}:${action}`;
    if (key in overrides) {
      return overrides[key];
    }
  }

  // Fall back to role defaults (uses access.role, which is VIEWER for TIME_BOMBED)
  const rolePerms = ROLE_PERMISSIONS[access.role];
  return rolePerms?.has(`${feature}:${action}` as PermissionKey) ?? false;
}

/**
 * Express middleware that blocks write operations (POST, PATCH, PUT, DELETE)
 * from users whose effective access is restricted.
 * Read operations (GET, HEAD, OPTIONS) are always allowed.
 *
 * MUST be placed AFTER authenticate() so req.user exists.
 *
 * Blocks writes when:
 * - effective.isBlocked === true (BLOCKED users)
 * - effective.status === 'EXPIRED' (subscription cancelled)
 * - effective.status === 'TIME_BOMBED' (past grace period, downgraded to VIEWER)
 * - effective.status === 'PENDING_APPROVAL' (not yet approved)
 *
 * Does NOT block:
 * - GRACE_PERIOD users (still have full access per getEffectiveAccess)
 * - Normal ACTIVE users with any role (including VIEWER — they may have
 *   legitimate write access on some routes via stored booleans)
 */
interface RequestWithUser extends Request {
  user?: AuthPayload;
}

export function enforceEffectiveRole(req: RequestWithUser, res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  // Build UserForAccess from req.user (same pattern as requireRole in auth.middleware.ts)
  const userForAccess: UserForAccess = {
    role: user.role as UserRole,
    status: user.status as UserStatus,
    blocked: user.blocked,
    timeBombAt: user.timeBombAt ?? null,
    gracePeriodHours: user.gracePeriodHours,
    permissions: user.permissions,
  };

  const effective = getEffectiveAccess(userForAccess);

  const writeMethods = ['POST', 'PATCH', 'PUT', 'DELETE'];
  if (writeMethods.includes(req.method)) {
    if (effective.isBlocked) {
      res.status(403).json({ error: 'Your account has been blocked. Contact your administrator.' });
      return;
    }
    if (effective.status === 'PENDING_APPROVAL') {
      res.status(403).json({ error: 'Your account is pending approval.' });
      return;
    }
    if (effective.status === 'EXPIRED') {
      res.status(403).json({
        error: 'Your write access has been restricted. Contact your administrator to restore full access.',
      });
      return;
    }
    if (effective.status === 'TIME_BOMBED') {
      res.status(403).json({
        error: 'Your write access has been restricted. Contact your administrator to restore full access.',
      });
      return;
    }
  }

  next();
}
