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

export const ALL_FEATURES: Feature[] = [
  'dashboard', 'scan', 'map', 'rules', 'preview', 'sync',
  'locations', 'settings', 'templates', 'sopUpload', 'sopView',
  'manageUsers', 'approveUsers', 'setPermissions', 'blockUsers',
  'setTimeBomb', 'setUserLimits', 'transferOwnership', 'viewAuditLog',
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
