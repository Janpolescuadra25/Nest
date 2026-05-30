// Shared TypeScript types for the Nest Chrome Extension

export interface Location {
  id: string;
  userId: string;
  name: string;
  toastUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Mapping {
  id: string;
  locationId: string;
  sourceField: string;
  targetAccount: string;
  postingType?: string;
  keepSeparate?: boolean;
  targetClass?: string;
  targetName?: string;
  targetDescription?: string;
  targetMemo?: string;
  priority: number;
  createdAt: string;
}

export interface Rule {
  id: string;
  locationId: string;
  name: string;
  ruleType: 'COMBINE' | 'DEDUCT' | 'THRESHOLD' | 'FORMULA';
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

export interface ScanRecord {
  id: string;
  locationId: string;
  scanDate: string;
  rawData: Record<string, number>;
  status: 'PENDING' | 'MAPPED' | 'SYNCED' | 'FAILED';
  createdAt: string;
  syncLogs?: SyncLog[];
}

export interface SyncLog {
  id: string;
  scanRecordId: string;
  qbJournalEntryId?: string;
  status: 'SUCCESS' | 'FAILED';
  errorMessage?: string;
  syncedAt: string;
}

export interface QBStatus {
  connected: boolean;
  realmId?: string;
  expiresAt?: string;
  tokenExpired?: boolean;
}

export interface JournalLineItem {
  amount: number;
  postingType: 'Debit' | 'Credit';
  accountRef: { value: string; name?: string };
  description?: string;
}

export type TabId = 'dashboard' | 'scan' | 'mappings' | 'rules' | 'preview' | 'data' | 'sync' | 'settings' | 'partners' | 'requests' | 'my-team' | 'activity';

export type ScanData = Record<string, number>;

export interface LocationConfig {
  memoTemplate?: string;
  docNumberTemplate?: string;
}

export interface ScanHealth {
  totalScans: number;
  successfulScans: number;
  failedScans: number;
  pendingScans: number;
  mappedScans: number;
  successRate: number;
  lastScanAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  canScan: boolean;
  canMap: boolean;
  canSync: boolean;
  canManageLocs: boolean;
  mustChangePassword: boolean;
  createdAt?: string;
  trialExpiresAt?: string | null;
  customExpiryMessage?: string | null;
}

export interface AdminRequest {
  id: string;
  email: string;
  name: string | null;
  description: string | null;
  company: string | null;
  status: string;
  createdAt: string;
  approvedBy?: { id: string; name: string | null } | null;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  targetId: string | null;
  action: string;
  meta: Record<string, unknown>;
  createdAt: string;
  actor: { name: string | null; email: string };
}

export interface OwnerAuditLogEntry {
  id: string;
  action: string;
  meta: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; name: string | null; email: string };
  target: { id: string; name: string | null; email: string } | null;
}

// Chrome extension message types
export interface ExtMessage {
  type:
    | 'SCAN_DATA'
    | 'REQUEST_SCAN'
    | 'OPEN_QB_AUTH'
    | 'QB_AUTH_COMPLETE'
    | 'STORE_JWT'
    | 'CLEAR_JWT';
  payload?: unknown;
}
