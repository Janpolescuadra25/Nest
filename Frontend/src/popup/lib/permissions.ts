export type PermissionKey = `${string}:${string}`;

export const ROLE_PERMISSIONS: Record<string, Set<PermissionKey>> = {
  OWNER: new Set<PermissionKey>([
    'dashboard:read', 'dashboard:write', 'dashboard:execute',
    'scan:read', 'scan:write', 'scan:execute',
    'map:read', 'map:write', 'map:execute',
    'rules:read', 'rules:write', 'rules:execute',
    'preview:read', 'preview:write', 'preview:execute',
    'sync:read', 'sync:write', 'sync:execute',
    'locations:read', 'locations:write', 'locations:execute',
    'settings:read', 'settings:write', 'settings:execute',
    'templates:read', 'templates:write', 'templates:execute',
    'sopUpload:read', 'sopUpload:write', 'sopUpload:execute',
    'sopView:read', 'sopView:write', 'sopView:execute',
    'manageUsers:read', 'manageUsers:write', 'manageUsers:execute',
    'approveUsers:read', 'approveUsers:write', 'approveUsers:execute',
    'setPermissions:read', 'setPermissions:write', 'setPermissions:execute',
    'blockUsers:read', 'blockUsers:write', 'blockUsers:execute',
    'setTimeBomb:read', 'setTimeBomb:write', 'setTimeBomb:execute',
    'setUserLimits:read', 'setUserLimits:write', 'setUserLimits:execute',
    'transferOwnership:read', 'transferOwnership:write', 'transferOwnership:execute',
    'viewAuditLog:read', 'viewAuditLog:write', 'viewAuditLog:execute',
  ]),

  ADMIN: new Set<PermissionKey>([
    'dashboard:read', 'dashboard:write', 'dashboard:execute',
    'scan:read', 'scan:write', 'scan:execute',
    'map:read', 'map:write', 'map:execute',
    'rules:read', 'rules:write', 'rules:execute',
    'preview:read', 'preview:write', 'preview:execute',
    'sync:read', 'sync:write', 'sync:execute',
    'locations:read', 'locations:write', 'locations:execute',
    'settings:read', 'settings:write', 'settings:execute',
    'templates:read', 'templates:write', 'templates:execute',
    'sopUpload:read', 'sopUpload:write', 'sopUpload:execute',
    'sopView:read', 'sopView:write', 'sopView:execute',
    'manageUsers:read', 'manageUsers:write', 'manageUsers:execute',
    'setPermissions:read', 'setPermissions:write', 'setPermissions:execute',
  ]),

  ACCOUNTANT: new Set<PermissionKey>([
    'dashboard:read', 'dashboard:write',
    'scan:read', 'scan:write',
    'map:read', 'map:write',
    'rules:read', 'rules:write',
    'preview:read', 'preview:write',
    'sync:read', 'sync:execute',
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

export function hasPerm(
  user: { permissions?: Record<string, boolean> | null; role: string },
  feature: string,
  action: string,
): boolean {
  const key = `${feature}:${action}` as PermissionKey;
  if (user.permissions && key in user.permissions) {
    return Boolean(user.permissions[key]);
  }
  const rolePerms = ROLE_PERMISSIONS[user.role];
  return rolePerms?.has(key) ?? false;
}
