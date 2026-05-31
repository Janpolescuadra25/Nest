import { UserRole, UserStatus } from '@prisma/client';
import { ROLE_PERMISSIONS, Feature, Action, PermissionKey } from './permissions';

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
