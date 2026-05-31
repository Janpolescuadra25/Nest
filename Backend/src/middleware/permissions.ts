// Feature × Action permission definitions for the Nest RBAC system

export type Feature =
  | 'dashboard'
  | 'scan'
  | 'map'
  | 'sync'
  | 'locations'
  | 'team'
  | 'billing'
  | 'reports'
  | 'audit'
  | 'settings'
  | 'invites'
  | 'templates'
  | 'rules'
  | 'exports'
  | 'integrations'
  | 'notifications'
  | 'api_keys'
  | 'support'
  | 'admin_panel';

export type Action = 'read' | 'write' | 'delete' | 'manage';

export type PermissionKey = `${Feature}:${Action}`;

// Default role permissions (overridable per-user via the permissions Json column)
export const ROLE_PERMISSIONS: Record<string, Set<PermissionKey>> = {
  OWNER: new Set<PermissionKey>([
    'dashboard:read', 'dashboard:write', 'dashboard:manage',
    'scan:read', 'scan:write', 'scan:manage',
    'map:read', 'map:write', 'map:manage',
    'sync:read', 'sync:write', 'sync:manage',
    'locations:read', 'locations:write', 'locations:delete', 'locations:manage',
    'team:read', 'team:write', 'team:delete', 'team:manage',
    'billing:read', 'billing:write', 'billing:manage',
    'reports:read', 'reports:write', 'reports:manage',
    'audit:read', 'audit:manage',
    'settings:read', 'settings:write', 'settings:manage',
    'invites:read', 'invites:write', 'invites:manage',
    'templates:read', 'templates:write', 'templates:delete', 'templates:manage',
    'rules:read', 'rules:write', 'rules:delete', 'rules:manage',
    'exports:read', 'exports:write', 'exports:manage',
    'integrations:read', 'integrations:write', 'integrations:manage',
    'notifications:read', 'notifications:write', 'notifications:manage',
    'api_keys:read', 'api_keys:write', 'api_keys:delete', 'api_keys:manage',
    'support:read', 'support:write',
    'admin_panel:read', 'admin_panel:manage',
  ]),

  ADMIN: new Set<PermissionKey>([
    'dashboard:read', 'dashboard:write',
    'scan:read', 'scan:write',
    'map:read', 'map:write',
    'sync:read', 'sync:write',
    'locations:read', 'locations:write', 'locations:delete',
    'team:read', 'team:write', 'team:delete',
    'reports:read',
    'audit:read',
    'settings:read', 'settings:write',
    'invites:read', 'invites:write',
    'templates:read', 'templates:write', 'templates:delete',
    'rules:read', 'rules:write', 'rules:delete',
    'exports:read', 'exports:write',
    'notifications:read', 'notifications:write',
    'support:read',
  ]),

  ACCOUNTANT: new Set<PermissionKey>([
    'dashboard:read',
    'scan:read',
    'map:read', 'map:write',
    'sync:read', 'sync:write',
    'locations:read',
    'reports:read',
    'templates:read',
    'rules:read',
    'exports:read', 'exports:write',
    'notifications:read',
    'support:read',
  ]),

  STAFF: new Set<PermissionKey>([
    'dashboard:read',
    'scan:read', 'scan:write',
    'locations:read',
    'reports:read',
    'notifications:read',
    'support:read',
  ]),

  VIEWER: new Set<PermissionKey>([
    'dashboard:read',
    'scan:read',
    'locations:read',
    'reports:read',
    'notifications:read',
    'support:read',
  ]),
};
