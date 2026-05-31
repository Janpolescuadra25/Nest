
# Phase 13 — Permission System Foundation + Audit Log + Migration

**Context:** Nest already has a partial RBAC system with `UserRole` enum (OWNER/ADMIN/ACCOUNTANT/STAFF/VIEWER), `UserStatus` enum (ACTIVE/EXPIRED/DISABLED), boolean permissions (`canScan`, `canMap`, `canSync`, `canManageLocs`), an `AuditLog` model, `requireRole()` middleware, and `requirePermission()` middleware. We're extending this foundation to add: new user statuses (PENDING_APPROVAL, GRACE_PERIOD, TIME_BOMBED, BLOCKED), a `permissions` JSON column for per-feature overrides, time bomb with grace period, invite links, and an `effective-role` utility. This phase covers ONLY the backend foundation (schema, migration, middleware, utility functions). **No UI changes.** The UI phases (14, 15, 17) come later.

**Rules:**
1. Read ALL relevant files fully before making changes.
2. After ALL fixes, run `cd Backend && npx tsc --noEmit` to verify zero errors.
3. Do NOT use `as any` to bypass type errors.
4. Do NOT modify any frontend files.
5. Do NOT modify any existing route handlers (we'll wire permissions into routes in later phases).
6. Commit message: `feat: extend RBAC with time bombs, invite links, effective roles, and permission overrides`

---

## FIX 1 — Extend existing `UserStatus` enum

**File:** `Backend/prisma/schema.prisma`

Read the file first. The `UserStatus` enum currently has `ACTIVE | EXPIRED | DISABLED`. Add four new values:

```prisma
enum UserStatus {
  ACTIVE
  EXPIRED
  DISABLED
  PENDING_APPROVAL
  GRACE_PERIOD
  TIME_BOMBED
  BLOCKED
}
```

Do NOT create a new enum. Do NOT remove `EXPIRED` or `DISABLED` — they are used throughout the codebase (auth middleware, timebomb cron, admin routes, owner routes). `BLOCKED` is added as a first-class status so that `blocked` boolean and status are aligned — when Owner blocks a user, both `blocked: true` AND `status: BLOCKED` are set together.

---

## FIX 2 — Add NEW columns only to existing User model

**File:** `Backend/prisma/schema.prisma`

Read the User model first. It already has: `id`, `email`, `name`, `password`, `role`, `status`, `adminId`, `canScan`, `canMap`, `canSync`, `canManageLocs`, `mustChangePassword`, `trialExpiresAt`, `customExpiryMessage`, `maxUsers`, `createdAt`, `updatedAt`, and relations `admin`, `teamMembers`, `locations`, `managedLocations`, `qbTokens`, `oauthStates`, `approvedRequests`, `auditLogs`, `auditTargets`, `passwordResetTokens`.

**Do NOT re-add any existing columns.** Add ONLY these new columns after the existing ones (before the relations block):

```prisma
permissions       Json?
timeBombAt        DateTime?
gracePeriodHours  Int        @default(48)
blocked           Boolean    @default(false)
blockedById       String?
approvedById      String?
approvedAt        DateTime?
invitedById       String?
transferredFromId String?
```

**Foreign key relations to add** (add these in the relations block of the User model, after the existing relations):

```prisma
blockedBy         User?          @relation("BlockedBy", fields: [blockedById], references: [id])
approvedBy        User?          @relation("ApprovedBy", fields: [approvedById], references: [id])
invitedBy         User?          @relation("InvitedBy", fields: [invitedById], references: [id])
transferredFrom   User?          @relation("TransferredFrom", fields: [transferredFromId], references: [id])
inviteLinks       InviteLink[]   @relation("InviteCreator")
```

⚠️ **Important notes about self-referencing relations:**
- The User model already has `adminId` → `@relation("AdminUsers")`. We are NOT adding `managedBy` — `adminId` already serves this purpose. Every team member's `adminId` points to their Admin. If an Admin leaves, the Owner can reassign by updating `adminId`.
- Each `@relation()` must have a unique name string. The existing names are: `"AdminUsers"`, `"UserLocations"`, `"AdminLocations"`, `"ApprovedAdminRequests"`, `"AuditActor"`, `"AuditTarget"`. Do NOT reuse these names.
- Add `@@index` for each new foreign key column: `blockedById`, `approvedById`, `invitedById`, `transferredFromId`.

---

## FIX 3 — Modify existing AuditLog model

**File:** `Backend/prisma/schema.prisma`

The AuditLog model already exists with columns `targetId` and `meta`. Rename these to match the new convention:

**Change `targetId` to `targetUserId`:**
```prisma
targetUserId  String?
```

**Change `meta` to `details`:**
```prisma
details       Json?
```

**Update the relation references accordingly:**
```prisma
targetUser User? @relation("AuditTarget", fields: [targetUserId], references: [id])
```

**Update the index:**
```prisma
@@index([targetUserId])
```

The full updated AuditLog model should be:
```prisma
model AuditLog {
  id           String   @id @default(cuid())
  actorId      String
  action       String
  targetUserId String?
  details      Json?
  createdAt    DateTime @default(now())

  actor       User     @relation("AuditActor", fields: [actorId], references: [id])
  targetUser  User?    @relation("AuditTarget", fields: [targetUserId], references: [id])

  @@index([actorId])
  @@index([targetUserId])
  @@index([action])
  @@index([createdAt])
  @@map("audit_logs")
}
```

⚠️ **Critical:** After renaming `targetId` → `targetUserId` and `meta` → `details`, you MUST update ALL references throughout the codebase. Search for `targetId` and `meta` in these files and update them:
- `Backend/src/routes/owner.ts` — audit log queries use `targetId` and `meta`
- `Backend/src/routes/admin.ts` — audit log creates use `targetId` and `meta`
- `Backend/src/routes/adminRequests.ts` — audit log creates use `targetId` and `meta`
- `Backend/src/cron/timebomb.ts` — audit log creates use `targetId` and `meta`
- `Backend/src/cron/trial-warnings.ts` — check and update if needed
- Any other file that references `auditLog` with `targetId` or `meta`

The Prisma migration will handle the column rename at the DB level, but the TypeScript code must be updated to match.

---

## FIX 4 — Add InviteLink model

**File:** `Backend/prisma/schema.prisma`

Add a new model AFTER the AuditLog model:

```prisma
model InviteLink {
  id         String    @id @default(cuid())
  token      String    @unique
  createdBy  String
  roleHint   UserRole?
  expiresAt  DateTime
  usedAt     DateTime?
  maxUses    Int       @default(1)
  useCount   Int       @default(0)
  createdAt  DateTime  @default(now())

  creator    User      @relation("InviteCreator", fields: [createdBy], references: [id])

  @@index([createdBy])
  @@index([expiresAt])
  @@map("invite_links")
}
```

Note: `roleHint` uses the existing `UserRole` enum (NOT `Role`). Do NOT add a redundant `@@index([token])` — the `@unique` on `token` already creates an index.

---

## FIX 5 — Generate migration

**Run:** `cd Backend && npx prisma migrate dev --name extend_rbac_foundation`

This should generate a migration that:
- Adds new values to `UserStatus` enum (PENDING_APPROVAL, GRACE_PERIOD, TIME_BOMBED, BLOCKED)
- Adds new columns to User table with safe defaults
- Renames `targetId` → `targetUserId` and `meta` → `details` in `audit_logs` table
- Creates the `invite_links` table
- Adds new indexes

Verify the migration SQL looks correct before proceeding.

---

## FIX 6 — Update all `targetId` → `targetUserId` and `meta` → `details` references

Search the entire `Backend/src` directory for:
- `targetId` in any audit log context → replace with `targetUserId`
- `meta:` in any `auditLog.create` or `auditLog.findMany` context → replace with `details:`
- `target:` in any audit log `include`/`select` context → replace with `targetUser:`

Files that WILL need updating (based on my review):
- `Backend/src/routes/owner.ts` — lines 145-152 (audit create), lines 224-238 (audit query with `target` include)
- `Backend/src/routes/admin.ts` — lines 176-183, 270-291, 349-351 (audit creates)
- `Backend/src/routes/adminRequests.ts` — lines 128-135, 162-169 (audit creates)
- `Backend/src/cron/timebomb.ts` — lines 31-46 (audit creates)
- `Backend/src/cron/trial-warnings.ts` — check and update if needed

After updating, run `cd Backend && npx tsc --noEmit` to verify zero errors.

---

## FIX 7 — Write migration seed logic for existing users

**New file:** `Backend/scripts/migrate-rbac.ts`

```typescript
/**
 * One-time RBAC migration script.
 * Run AFTER `prisma migrate dev` creates the new columns.
 *
 * Usage: npx tsx scripts/migrate-rbac.ts
 *
 * What it does:
 * 1. Finds all existing users
 * 2. The earliest-created user becomes OWNER + ACTIVE (if not already)
 * 3. All other users with adminId=null get role ADMIN + ACTIVE
 * 4. All users with adminId set keep their current role + ACTIVE status
 * 5. Sets approvedAt to their original createdAt (grandfathered in)
 * 6. Sets approvedById to the Owner's ID (grandfathered approval)
 * 7. Leaves all other new fields at their defaults (no time bomb, not blocked)
 *
 * Idempotent: if run again, skips users who already have approvedAt set.
 */
```

Implement this logic using `@prisma/client` directly (import pattern: `import { PrismaClient } from '@prisma/client'` — see existing `fix-owner-role.ts` for the pattern). Use `new PrismaClient()` not the singleton.

**Important:**
- Query users ordered by `createdAt ASC`
- The first user gets `role: 'OWNER'` (if not already)
- Users with `adminId: null` (except the Owner) get `role: 'ADMIN'`
- Users with `adminId` set keep their current role
- ALL existing users with `status: ACTIVE` keep `ACTIVE`
- Do NOT change EXPIRED or DISABLED users' status — leave their status as-is
- ALL existing users with `approvedAt: null` get `approvedAt: <their createdAt>` and `approvedById: <owner's id>` (grandfathered)
- Print a summary of what was changed
- The script should be idempotent — if run again, skip users who already have `approvedAt` set

---

## FIX 8 — Create permissions constants

**New file:** `Backend/src/middleware/permissions.ts`

Define the permission matrix as a TypeScript constant:

```typescript
import { UserRole } from '@prisma/client';

export type Feature =
  | 'dashboard'
  | 'scan'
  | 'map'
  | 'rules'
  | 'preview'
  | 'sync'
  | 'locations'
  | 'settings'
  | 'templates'
  | 'sopUpload'
  | 'sopView'
  | 'manageUsers'
  | 'approveUsers'
  | 'setPermissions'
  | 'blockUsers'
  | 'setTimeBomb'
  | 'setUserLimits'
  | 'transferOwnership'
  | 'viewAuditLog';

export type Action = 'read' | 'write' | 'execute';
export type PermissionKey = `${Feature}:${Action}`;

const ALL_FEATURES: Feature[] = [
  'dashboard', 'scan', 'map', 'rules', 'preview', 'sync',
  'locations', 'settings', 'templates', 'sopUpload', 'sopView',
  'manageUsers', 'approveUsers', 'setPermissions', 'blockUsers',
  'setTimeBomb', 'setUserLimits', 'transferOwnership', 'viewAuditLog',
];

const ALL_ACTIONS: Action[] = ['read', 'write', 'execute'];

function allPermissions(): Set<PermissionKey> {
  const perms = new Set<PermissionKey>();
  for (const f of ALL_FEATURES) {
    for (const a of ALL_ACTIONS) {
      perms.add(`${f}:${a}` as PermissionKey);
    }
  }
  return perms;
}

function permissionsFrom(features: Feature[], actions: Action[]): Set<PermissionKey> {
  const perms = new Set<PermissionKey>();
  for (const f of features) {
    for (const a of actions) {
      perms.add(`${f}:${a}` as PermissionKey);
    }
  }
  return perms;
}

export const ROLE_PERMISSIONS: Record<UserRole, Set<PermissionKey>> = {
  OWNER: allPermissions(),

  ADMIN: permissionsFrom(
    ['dashboard', 'scan', 'map', 'rules', 'preview', 'sync',
     'locations', 'settings', 'templates', 'sopUpload', 'sopView',
     'manageUsers', 'setPermissions'],
    ['read', 'write', 'execute'],
  ),

  ACCOUNTANT: new Set<PermissionKey>([
    'dashboard:read', 'dashboard:write',
    'scan:read', 'scan:write',
    'map:read', 'map:write',
    'rules:read', 'rules:write',
    'preview:read', 'preview:write',
    'sync:read',
    'sync:execute',
    'templates:read', 'templates:write',
    'sopUpload:write',
    'sopView:read',
  ]),

  STAFF: new Set<PermissionKey>([
    'dashboard:read',
    'scan:read', 'scan:write',
    'sopView:read',
  ]),

  VIEWER: new Set<PermissionKey>([
    'dashboard:read',
    'scan:read',
    'sopView:read',
  ]),
};
```

---

## FIX 9 — Create getEffectiveRole utility

**New file:** `Backend/src/middleware/effective-role.ts`

```typescript
import { UserRole, UserStatus } from '@prisma/client';
import { ROLE_PERMISSIONS, Feature, Action, PermissionKey } from './permissions';

export interface EffectiveAccess {
  role: UserRole;
  status: UserStatus;
  isBlocked: boolean;
  isInGracePeriod: boolean;
  gracePeriodEndsAt: Date | null;
}

/**
 * Minimal user shape needed for access computation.
 * This avoids requiring the full Prisma User type —
 * the auth middleware can pass just these fields from req.user.
 */
export interface UserForAccess {
  role: UserRole;
  status: UserStatus;
  blocked: boolean;
  timeBombAt: Date | string | null;
  gracePeriodHours: number;
  permissions: unknown;
}

/**
 * Computes the user's effective access level considering all factors:
 * - Blocked status (absolute override — no access)
 * - Pending approval (can't do anything)
 * - Time bomb + grace period
 * - Normal role-based access
 */
export function getEffectiveAccess(user: UserForAccess): EffectiveAccess {
  // 1. Blocked — absolute override
  if (user.blocked) {
    return {
      role: user.role,
      status: 'BLOCKED',
      isBlocked: true,
      isInGracePeriod: false,
      gracePeriodEndsAt: null,
    };
  }

  // 2. Pending approval
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
    const bombDate = new Date(user.timeBombAt);
    if (now < bombDate) {
      // Still active, time bomb hasn't fired yet
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
      // In grace period — full access but with warning
      return {
        role: user.role,
        status: 'GRACE_PERIOD',
        isBlocked: false,
        isInGracePeriod: true,
        gracePeriodEndsAt: graceEnd,
      };
    }
    // Past grace period — downgraded to viewer
    return {
      role: 'VIEWER',
      status: 'TIME_BOMBED',
      isBlocked: false,
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

  // Fall back to role defaults
  const rolePerms = ROLE_PERMISSIONS[access.role];
  return rolePerms?.has(`${feature}:${action}` as PermissionKey) ?? false;
}
```

Import `ROLE_PERMISSIONS`, `Feature`, `Action`, `PermissionKey` from `./permissions.ts`.

---

## FIX 10 — Create audit log utility

**New file:** `Backend/src/middleware/audit.ts`

```typescript
import { prisma } from '../lib/prisma';

type AuditAction =
  | 'USER_CREATED'
  | 'ROLE_CHANGE'
  | 'STATUS_CHANGE'
  | 'TIME_BOMB_SET'
  | 'TIME_BOMB_CLEARED'
  | 'USER_BLOCKED'
  | 'USER_UNBLOCKED'
  | 'USER_DELETED'
  | 'APPROVAL_GRANTED'
  | 'APPROVAL_REJECTED'
  | 'PERMISSION_OVERRIDE'
  | 'OWNER_TRANSFER'
  | 'USER_LIMIT_SET'
  | 'INVITE_CREATED'
  | 'INVITE_USED'
  | 'ADMIN_UPDATED'
  | 'ADMIN_APPROVED'
  | 'ADMIN_REJECTED'
  | 'USER_INVITED'
  | 'USER_DISABLED'
  | 'TRIAL_EXPIRED'
  | 'TRIAL_RESET'
  | 'TRIAL_EXPIRY_WARNING'
  | 'ROLE_CHANGED'
  | 'PERMISSION_UPDATED'
  | 'USER_STATUS_CHANGED'
  | 'TIMEBOMB_SET';

export async function logAction(params: {
  actorId: string;
  action: AuditAction;
  targetUserId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        targetUserId: params.targetUserId ?? null,
        details: params.details ?? null,
      },
    });
  } catch (err) {
    console.error('[Audit] Failed to log action:', params.action, err);
    // Audit logging should never block the main operation
  }
}
```

**Important:** Import `prisma` from `'../lib/prisma'` — this is the existing singleton pattern used throughout the codebase. The `AuditAction` type includes both new action names AND existing ones (ADMIN_UPDATED, USER_INVITED, etc.) for backward compatibility.

---

## FIX 11 — Extend existing `requireRole` and `requirePermission` middleware

**File:** `Backend/src/middleware/auth.middleware.ts`

Read the existing file first. It already has `requireRole()` and `requirePermission()`. We are EXTENDING them, not replacing them.

### 11a — Update `AuthPayload` type in `Backend/src/types/index.ts`

Add the new fields to the existing `AuthPayload` interface. The current interface has:
```typescript
export interface AuthPayload {
  id: string;
  userId: string;
  email: string;
  name?: string | null;
  role: string;
  status: string;
  adminId: string | null;
  canScan: boolean;
  canMap: boolean;
  canSync: boolean;
  canManageLocs: boolean;
  mustChangePassword: boolean;
  trialExpiresAt: Date | null;
  maxUsers: number | null;
}
```

Add these new fields (keep ALL existing fields — they are still used by route handlers):
```typescript
permissions       Record<string, boolean> | null;
timeBombAt        Date | string | null;
gracePeriodHours  number;
blocked           boolean;
blockedById       string | null;
approvedById      string | null;
approvedAt        Date | null;
invitedById       string | null;
transferredFromId string | null;
```

### 11b — Update `authenticate` middleware's `select` clause

In `Backend/src/middleware/auth.middleware.ts`, the `authenticate` function has a `select` clause when fetching the user. Add the new fields to the select:

```typescript
select: {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  adminId: true,
  canScan: true,
  canMap: true,
  canSync: true,
  canManageLocs: true,
  mustChangePassword: true,
  trialExpiresAt: true,
  maxUsers: true,
  // New RBAC fields:
  permissions: true,
  timeBombAt: true,
  gracePeriodHours: true,
  blocked: true,
  blockedById: true,
  approvedById: true,
  approvedAt: true,
  invitedById: true,
  transferredFromId: true,
},
```

And add the new fields to the `req.user = { ... }` assignment:

```typescript
req.user = {
  id: user.id,
  userId: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  status: user.status,
  adminId: user.adminId,
  canScan: user.canScan,
  canMap: user.canMap,
  canSync: user.canSync,
  canManageLocs: user.canManageLocs,
  mustChangePassword: user.mustChangePassword,
  trialExpiresAt: user.trialExpiresAt,
  maxUsers: user.maxUsers,
  // New RBAC fields:
  permissions: user.permissions as Record<string, boolean> | null,
  timeBombAt: user.timeBombAt,
  gracePeriodHours: user.gracePeriodHours,
  blocked: user.blocked,
  blockedById: user.blockedById,
  approvedById: user.approvedById,
  approvedAt: user.approvedAt,
  invitedById: user.invitedById,
  transferredFromId: user.transferredFromId,
};
```

### 11c — Extend `requireRole` to use `getEffectiveAccess`

The existing `requireRole` is at line 93-101. Replace it with a version that uses `getEffectiveAccess` from FIX 9. This ensures time-bombed, blocked, and pending users are handled correctly — with a SINGLE source of truth for the logic:

```typescript
import { getEffectiveAccess, hasPermission, UserForAccess } from './effective-role';
import { Feature, Action } from './permissions';

/**
 * Middleware factory — requires the authenticated user to have one of the given roles.
 * Uses getEffectiveAccess to account for time bombs, blocked status, and pending approval.
 * Place after `authenticate`.
 */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
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
      res.status(403).json({ error: 'Account suspended' });
      return;
    }

    if (effectiveAccess.status === 'PENDING_APPROVAL') {
      res.status(403).json({ error: 'Account pending approval' });
      return;
    }

    if (!roles.includes(effectiveAccess.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    // Attach effective access to request for downstream use
    (req as any).effectiveAccess = effectiveAccess;

    // Add grace period warning header if applicable
    if (effectiveAccess.isInGracePeriod && effectiveAccess.gracePeriodEndsAt) {
      res.setHeader('X-Access-Warning', 'GRACE_PERIOD');
      res.setHeader('X-Grace-Period-Ends', effectiveAccess.gracePeriodEndsAt.toISOString());
    }

    next();
  };
}
```

You'll need to add these imports at the top of the file:
```typescript
import { UserRole, UserStatus } from '@prisma/client';
import { getEffectiveAccess, UserForAccess } from './effective-role';
```

### 11d — Extend `requirePermission` to support new Feature:Action model

The existing `requirePermission` only supports the 4 boolean fields. Extend it to also support the new `Feature:Action` model while keeping backward compatibility:

```typescript
/**
 * Middleware factory — requires a specific permission.
 * Supports both the legacy boolean fields (canScan, canMap, canSync, canManageLocs)
 * and the new Feature:Action permission model.
 * OWNER always passes.
 * Place after `authenticate`.
 */
export const requirePermission = (field: 'canScan' | 'canMap' | 'canSync' | 'canManageLocs' | Feature) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // OWNER always passes
    if (req.user.role === 'OWNER') { next(); return; }

    // Legacy boolean permission check
    if (field === 'canScan' || field === 'canMap' || field === 'canSync' || field === 'canManageLocs') {
      if (!req.user[field]) {
        res.status(403).json({ error: 'Permission denied: ' + field });
        return;
      }
      next();
      return;
    }

    // New Feature:Action permission check — default to 'read' action
    const userForAccess: UserForAccess = {
      role: req.user.role as UserRole,
      status: req.user.status as UserStatus,
      blocked: req.user.blocked,
      timeBombAt: req.user.timeBombAt ?? null,
      gracePeriodHours: req.user.gracePeriodHours,
      permissions: req.user.permissions,
    };

    if (!hasPermission(userForAccess, field as Feature, 'read')) {
      res.status(403).json({ error: 'Permission denied: ' + field });
      return;
    }

    next();
  };
};

/**
 * Middleware factory — requires a specific Feature:Action permission.
 * Use this for new routes that need fine-grained permission checks.
 * OWNER always passes.
 * Place after `authenticate`.
 */
export const requireFeaturePermission = (feature: Feature, action: Action) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
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
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};
```

Add the import for `Feature` and `Action`:
```typescript
import { Feature, Action } from './permissions';
```

### 11e — Keep existing helpers unchanged

Do NOT modify `requireOwnTeam` or `locationFilter` — they work correctly as-is and will be extended in later phases.

---

## FIX 12 — Extend timebomb cron for new statuses

**File:** `Backend/src/cron/timebomb.ts`

Read the existing file first. It currently handles ACTIVE → EXPIRED transitions. Extend it to also handle time bomb transitions using the new `timeBombAt` field.

Add a second function `checkTimeBombs` that runs alongside the existing `checkTrialExpiry`:

```typescript
async function checkTimeBombs(prisma: PrismaClient): Promise<void> {
  try {
    const now = new Date();

    // Step 1 — Find users whose timeBombAt has been reached but status is still ACTIVE
    const gracePeriodEntries = await prisma.user.findMany({
      where: {
        timeBombAt: { not: null, lte: now },
        status: 'ACTIVE',
        blocked: false,
      },
      select: { id: true, email: true, name: true, timeBombAt: true, role: true, gracePeriodHours: true },
    });

    if (gracePeriodEntries.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: gracePeriodEntries.map(u => u.id) } },
        data: { status: 'GRACE_PERIOD' },
      });

      await Promise.allSettled(
        gracePeriodEntries.map(user =>
          prisma.auditLog.create({
            data: {
              actorId: user.id,
              targetUserId: user.id,
              action: 'STATUS_CHANGE',
              details: {
                previousStatus: 'ACTIVE',
                newStatus: 'GRACE_PERIOD',
                trigger: 'timeBombAt reached',
                timeBombAt: user.timeBombAt,
                gracePeriodHours: user.gracePeriodHours,
              },
            },
          })
        )
      );

      console.log(`[TimeBomb] ${gracePeriodEntries.length} user(s) entered grace period`);
    }

    // Step 2 — Find users in GRACE_PERIOD whose grace period has expired
    const graceExpired = await prisma.user.findMany({
      where: {
        status: 'GRACE_PERIOD',
        timeBombAt: { not: null },
        blocked: false,
      },
      select: { id: true, email: true, name: true, timeBombAt: true, role: true, gracePeriodHours: true },
    });

    const fullyExpired = graceExpired.filter(user => {
      if (!user.timeBombAt) return false;
      const graceEnd = new Date(
        new Date(user.timeBombAt).getTime() + (user.gracePeriodHours * 60 * 60 * 1000)
      );
      return now >= graceEnd;
    });

    if (fullyExpired.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: fullyExpired.map(u => u.id) } },
        data: { status: 'TIME_BOMBED' },
      });

      await Promise.allSettled(
        fullyExpired.map(user =>
          prisma.auditLog.create({
            data: {
              actorId: user.id,
              targetUserId: user.id,
              action: 'STATUS_CHANGE',
              details: {
                previousStatus: 'GRACE_PERIOD',
                newStatus: 'TIME_BOMBED',
                trigger: 'grace period expired',
                timeBombAt: user.timeBombAt,
                gracePeriodHours: user.gracePeriodHours,
                previousRole: user.role,
                effectiveRole: 'VIEWER',
              },
            },
          })
        )
      );

      console.log(`[TimeBomb] ${fullyExpired.length} user(s) fully expired (TIME_BOMBED)`);
    }
  } catch (err) {
    console.error('[TimeBomb] checkTimeBombs error:', err);
  }
}
```

Then update `startTimeBombCron` to run both checks:

```typescript
export function startTimeBombCron(prisma: PrismaClient): void {
  // Run both checks immediately on startup
  checkTrialExpiry(prisma);
  checkTimeBombs(prisma);

  // Then every 60 minutes
  setInterval(() => {
    checkTrialExpiry(prisma);
    checkTimeBombs(prisma);
  }, 3_600_000);
}
```

Also update the existing `checkTrialExpiry` function to use `targetUserId` and `details` instead of `targetId` and `meta` (this is part of FIX 6 but the cron file needs explicit mention since it creates audit logs).

---

## VERIFY

1. `cd Backend && npx prisma migrate dev --name extend_rbac_foundation` — migration succeeds
2. `cd Backend && npx tsx scripts/migrate-rbac.ts` — migration script runs (if there are existing users)
3. `cd Backend && npx tsc --noEmit` — zero errors
4. Read through all new/modified files to confirm consistency
5. Verify that all existing route handlers still work (we didn't modify them, but the middleware they depend on was extended)
6. Verify that the `authenticate` middleware still correctly blocks DISABLED users (the existing check at line 56 must still work)
7. Commit: `feat: extend RBAC with time bombs, invite links, effective roles, and permission overrides`
