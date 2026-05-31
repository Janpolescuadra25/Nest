// Effective-access utilities for the Nest RBAC system
import { UserRole, UserStatus } from '@prisma/client';
import { Feature, Action, PermissionKey, ROLE_PERMISSIONS } from './permissions';

export interface UserForAccess {
  role: UserRole;
  status: UserStatus;
  blocked: boolean;
  timeBombAt: Date | string | null;
  gracePeriodHours: number;
  permissions: unknown;  // Json? from Prisma — treated as Record<string, boolean> overrides
}

export interface EffectiveAccess {
  role: UserRole;
  status: UserStatus;
  isBlocked: boolean;
  isInGracePeriod: boolean;
  gracePeriodEndsAt: Date | null;
  permissionSet: Set<PermissionKey>;
}

/**
 * Resolves the runtime access profile for a user.
 *
 * Priority order:
 *  1. BLOCKED flag → deny everything (isBlocked = true)
 *  2. PENDING_APPROVAL / TIME_BOMBED statuses → return as-is (restricted by status checks upstream)
 *  3. timeBombAt in the past → treat as TIME_BOMBED + compute grace period window
 *  4. Normal path → apply role defaults + per-user permission overrides
 */
export function getEffectiveAccess(user: UserForAccess): EffectiveAccess {
  const now = new Date();

  // 1. Hard block
  if (user.blocked || user.status === 'BLOCKED') {
    return {
      role: user.role,
      status: 'BLOCKED' as UserStatus,
      isBlocked: true,
      isInGracePeriod: false,
      gracePeriodEndsAt: null,
      permissionSet: new Set(),
    };
  }

  // 2. PENDING_APPROVAL
  if (user.status === 'PENDING_APPROVAL') {
    return {
      role: user.role,
      status: 'PENDING_APPROVAL' as UserStatus,
      isBlocked: false,
      isInGracePeriod: false,
      gracePeriodEndsAt: null,
      permissionSet: new Set(),
    };
  }

  // 3. Time-bombed check (timeBombAt in the past)
  if (user.timeBombAt) {
    const bombDate = typeof user.timeBombAt === 'string'
      ? new Date(user.timeBombAt)
      : user.timeBombAt;

    if (bombDate <= now) {
      const gracePeriodEndsAt = new Date(bombDate.getTime() + user.gracePeriodHours * 3_600_000);
      const isInGracePeriod = now < gracePeriodEndsAt;

      return {
        role: user.role,
        status: isInGracePeriod ? ('GRACE_PERIOD' as UserStatus) : ('TIME_BOMBED' as UserStatus),
        isBlocked: !isInGracePeriod,
        isInGracePeriod,
        gracePeriodEndsAt: isInGracePeriod ? gracePeriodEndsAt : null,
        permissionSet: isInGracePeriod ? buildPermissionSet(user) : new Set(),
      };
    }
  }

  // 4. Normal path — resolve from role + overrides
  return {
    role: user.role,
    status: user.status,
    isBlocked: false,
    isInGracePeriod: false,
    gracePeriodEndsAt: null,
    permissionSet: buildPermissionSet(user),
  };
}

/**
 * Checks if a user has a specific Feature:Action permission.
 * OWNER always returns true.
 */
export function hasPermission(user: UserForAccess, feature: Feature, action: Action): boolean {
  if (user.role === 'OWNER') return true;

  const effective = getEffectiveAccess(user);
  if (effective.isBlocked) return false;

  const key: PermissionKey = `${feature}:${action}`;
  return effective.permissionSet.has(key);
}

/**
 * Builds the effective permission set for a user by applying per-user overrides
 * on top of their role defaults.
 *
 * The `permissions` Json column stores an object like:
 *   { "scan:write": true, "sync:write": false }
 * `true` grants a key not in the role defaults; `false` revokes a key that is.
 */
function buildPermissionSet(user: UserForAccess): Set<PermissionKey> {
  const base = new Set(ROLE_PERMISSIONS[user.role] ?? []);

  if (!user.permissions || typeof user.permissions !== 'object' || Array.isArray(user.permissions)) {
    return base;
  }

  const overrides = user.permissions as Record<string, boolean>;
  for (const [key, granted] of Object.entries(overrides)) {
    if (granted) {
      base.add(key as PermissionKey);
    } else {
      base.delete(key as PermissionKey);
    }
  }

  return base;
}
