// Central type definitions for the Nest backend

export interface AuthPayload {
  /** Primary identifier — same value as userId (kept for backward compat) */
  id: string;
  /** Backward-compat alias for id — all existing routes use this */
  userId: string;
  email: string;
  name?: string | null;
  role: string;       // UserRole: OWNER | ADMIN | ACCOUNTANT | STAFF | VIEWER
  status: string;     // UserStatus: ACTIVE | EXPIRED | DISABLED | PENDING_APPROVAL | GRACE_PERIOD | TIME_BOMBED | BLOCKED
  adminId: string | null;
  mustChangePassword: boolean;
  trialExpiresAt: Date | null;
  maxUsers: number | null;
  // RBAC extension fields
  permissions: Record<string, boolean> | null;
  timeBombAt: Date | string | null;
  gracePeriodHours: number;
  blocked: boolean;
  blockedById: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
  invitedById: string | null;
  transferredFromId: string | null;
}

export interface QBTokens {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: number;
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

export interface CreateJournalEntryInput {
  txnDate: string;             // YYYY-MM-DD
  docNumber?: string;
  privateNote?: string;
  lines: QBJournalLineItem[];
  realmId: string;
  accessToken: string;
}

export interface JournalEntryResponse {
  id: string;
  txnDate: string;
  totalAmount: number;
  syncToken: string;
}

export interface ScanRawData {
  date: string;
  location?: string;
  [key: string]: unknown;   // Toast fields are open-ended
}

export interface RuleConfig {
  sourceFields?: string[];
  operator?: string;
  targetField?: string;
  threshold?: number;
  formula?: string;
  [key: string]: unknown;
}
