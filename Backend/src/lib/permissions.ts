export const permissionDefaultsMap: Record<string, { canScan: boolean; canMap: boolean; canSync: boolean; canManageLocs: boolean }> = {
  VIEWER:     { canScan: false, canMap: false, canSync: false, canManageLocs: false },
  STAFF:      { canScan: true,  canMap: false, canSync: true,  canManageLocs: false },
  ACCOUNTANT: { canScan: true,  canMap: true,  canSync: true,  canManageLocs: true  },
  ADMIN:      { canScan: true,  canMap: true,  canSync: true,  canManageLocs: true  },
};
