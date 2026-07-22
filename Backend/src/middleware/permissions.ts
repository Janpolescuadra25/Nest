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
  | 'viewAuditLog'
  | 'products';

export type Action = 'read' | 'write' | 'execute';
export type PermissionKey = `${Feature}:${Action}`;

export const ALL_FEATURES: Feature[] = [
  'dashboard', 'scan', 'map', 'rules', 'preview', 'sync',
  'locations', 'settings', 'templates', 'sopUpload', 'sopView',
  'manageUsers', 'approveUsers', 'setPermissions', 'blockUsers',
  'setTimeBomb', 'setUserLimits', 'transferOwnership', 'viewAuditLog',
  'products',
];

export const ALL_ACTIONS: Action[] = ['read', 'write', 'execute'];

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
     'manageUsers', 'setPermissions', 'products'],
    ['read', 'write', 'execute'],
  ),

  MANAGER: permissionsFrom(
    ['dashboard', 'scan', 'map', 'rules', 'preview', 'sync',
     'locations', 'settings', 'templates', 'sopUpload', 'sopView',
     'manageUsers', 'products'],
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
    'products:read', 'products:write', 'products:execute',
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

export function getPermissionDefaults(role: UserRole): Record<string, boolean> {
  const perms = ROLE_PERMISSIONS[role];
  const result: Record<string, boolean> = {};
  for (const f of ALL_FEATURES) {
    for (const a of ALL_ACTIONS) {
      const key = `${f}:${a}` as PermissionKey;
      result[key] = perms.has(key);
    }
  }
  return result;
}
