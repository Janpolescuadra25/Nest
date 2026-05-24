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

export type TabId = 'scan' | 'mappings' | 'rules' | 'sync' | 'settings';

export type ScanData = Record<string, number>;

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
