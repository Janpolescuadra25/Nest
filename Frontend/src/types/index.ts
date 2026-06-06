// Shared TypeScript types for the Nest Chrome Extension

export interface Location {
  id: string;
  userId: string;
  name: string;
  posUrl: string;
  isActive: boolean;
  memoTemplate?: string;
  docNumberTemplate?: string;
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
  docNumber?: string;
  status: 'SUCCESS' | 'FAILED';
  errorMessage?: string;
  errorType?: string;
  syncedAt: string;
}

export interface QBStatus {
  connected: boolean;
  reason?: 'not_connected' | 'token_expired';
  realmId?: string;
  expiresAt?: string;
  tokenExpired?: boolean;
  environment?: string;
}

export interface JournalLineItem {
  amount: number;
  postingType: 'Debit' | 'Credit';
  accountRef: { value: string; name?: string };
  description?: string;
}

export interface QBJournalLineItem {
  amount: number;
  postingType: 'Debit' | 'Credit';
  accountRef: { value: string; name?: string };
  classRef?: { value: string; name?: string };
  departmentRef?: { value: string; name?: string };
  entityRef?: { value: string; name?: string; type?: string };
  description?: string;
  memo?: string;
}

export interface BatchSyncItem {
  scanRecordId: string;
  txnDate: string;
  lines: QBJournalLineItem[];
  privateNote?: string;
  docNumber?: string;
}

export interface BatchSyncResult {
  scanRecordId: string;
  status: 'SYNCED' | 'SKIPPED' | 'FAILED';
  qbJournalEntryId?: string;
  docNumber?: string;
  reason?: string;
  errorType?: string;
  errorMessage?: string;
}

export interface BatchSyncSummary {
  total: number;
  synced: number;
  skipped: number;
  failed: number;
}

export type TabId = 'dashboard' | 'scan' | 'mappings' | 'rules' | 'preview' | 'data' | 'sync' | 'settings' | 'partners' | 'requests' | 'my-team' | 'activity' | 'admins' | 'users' | 'locations';

export type ScanData = Record<string, number>;

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

export interface EffectiveAccess {
  role: string;
  status: string;
  isBlocked: boolean;
  isInGracePeriod: boolean;
  gracePeriodEndsAt: string | null;
}

export interface InviteLink {
  id: string;
  token?: string;
  roleHint: string;
  expiresAt: string;
  usedAt?: string | null;
  maxUses: number;
  useCount: number;
  createdAt: string;
  isActive: boolean;
  creatorName?: string | null;
  creatorEmail?: string;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  permissions?: Record<string, boolean> | null;
  mustChangePassword: boolean;
  createdAt?: string;
  trialExpiresAt?: string | null;
  customExpiryMessage?: string | null;
  timeBombAt?: string | null;
  gracePeriodHours?: number;
  effectiveAccess?: EffectiveAccess;
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

export interface ExportTemplate {
  version: number;
  exportedAt: string;
  sourceLocationName: string;
  sourceRealmId: string;
  memoTemplate: string;
  docNumberTemplate: string;
  mappings: Array<{
    sourceField: string;
    targetAccount: string;
    postingType: string;
    keepSeparate: boolean;
    targetClass?: string;
    targetName?: string;
    targetDescription?: string;
    targetMemo?: string;
    priority: number;
  }>;
  rules: Array<{
    name: string;
    ruleType: string;
    config: Record<string, unknown>;
    isActive: boolean;
  }>;
}

export interface ImportResult {
  success: boolean;
  createdMappings: number;
  createdRules: number;
  templatesUpdated: boolean;
}
