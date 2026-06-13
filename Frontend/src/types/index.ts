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
  templateId?: string | null;
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

export interface MappingSuggestion {
  sourceField: string;
  accountHint: string;
  accountName: string;
  accountId?: string;
  postingType: 'Debit' | 'Credit';
  reason: string;
}

export interface Template {
  id: string;
  locationId: string;
  name: string;
  transactionType: string;
  lineType: string;
  version: number;
  defaults: Record<string, unknown> | null;
  columnMappings: Record<string, unknown> | null;
  memoTemplate?: string;
  docNumberTemplate?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ColumnMapping {
  productColumn: string;
  amountColumn: string;
  descriptionColumn?: string;
  classColumn?: string;
  taxCodeColumn?: string;
}

export interface ExtractedLineItem {
  productName: string;
  amount: number;
  description: string;
  classId: string | null;
  taxCodeId: string | null;
  accountId: string;
  accountName: string;
  postingType: 'Credit' | 'Debit';
  matched: boolean;
}

export interface Product {
  id: string;
  name: string;
  createdAt: string;
}

export interface ProductFormData {
  name: string;
}

export interface ProductMapping {
  id: string;
  templateId: string;
  productId: string;
  productName: string;
  accountId: string;
  postingType: 'Credit' | 'Debit';
  classId: string | null;
  createdAt: string;
}

export interface ProductMappingFormData {
  templateId: string;
  productId: string;
  accountId: string;
  postingType: 'Credit' | 'Debit';
  classId?: string;
}

export interface ExcelSheetPreview {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
}

export interface ExcelParseResult {
  sheetNames: string[];
  sheets: ExcelSheetPreview[];
  selectedSheetName: string;
}

export interface ScanEntry {
  id: string;
  source: 'pos' | 'excel' | 'image' | 'pdf';
  fileName?: string;
  rowNumber?: number;
  thumbnail?: string;
  header: Record<string, string>;
  lineItems: Record<string, string>[];
}

export interface ExtractedInvoice {
  header: Record<string, string>;
  lineItems: Record<string, string>[];
}

export type ScanMode = 'pos' | 'excel' | 'image';

export interface ExcelDataParseResult {
  transactions: {
    type: string;
    header: Record<string, string>;
    lineItems: Record<string, string>[];
  }[];
  totalRows: number;
  skippedRows: number;
}

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  JOURNAL_ENTRY: 'Journal Entry',
  BILL: 'Bill',
  VENDOR_CREDIT: 'Vendor Credit',
  CHEQUE: 'Cheque',
};

export const TRANSACTION_TYPES = Object.keys(TRANSACTION_TYPE_LABELS) as (keyof typeof TRANSACTION_TYPE_LABELS)[];

export const BILL_FIELD_LABELS: Record<string, string> = {
  vendorRef: 'Vendor',
  dueDate: 'Due Date',
  termsRef: 'Terms',
  apAccountRef: 'AP Account',
  memo: 'Memo',
  docNumber: 'Bill No.',
};

export const VENDOR_CREDIT_FIELD_LABELS: Record<string, string> = {
  vendorRef: 'Vendor',
  apAccountRef: 'AP Account',
  memo: 'Memo',
  docNumber: 'Credit No.',
};

export interface Rule {
  id: string;
  locationId: string;
  templateId?: string | null;
  template?: { id: string; name: string; transactionType: string } | null;
  name: string;
  ruleType: 'COMBINE' | 'DEDUCT' | 'THRESHOLD' | 'FORMULA';
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

export interface RuleFormData {
  name: string;
  ruleType: 'COMBINE' | 'DEDUCT' | 'THRESHOLD' | 'FORMULA';
  config: Record<string, unknown>;
  isActive?: boolean;
  templateId?: string | null;
}

export interface ScanRecord {
  id: string;
  locationId: string;
  scanDate: string;
  rawData: Record<string, number>;
  rawScanEntry?: ScanEntry | null;
  source?: string;
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
  attemptCount: number;
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

export interface QBBillLineItem {
  amount: number;
  accountRef: { value: string; name?: string };
  classRef?: { value: string; name?: string };
  taxCodeRef?: { value: string; name?: string };
  description?: string;
}

export interface QBTerm {
  Id: string;
  Name: string;
  Type?: 'Standard' | 'DateDriven';
  DueDays?: number;
  DayOfMonth?: number;
  Month?: number;
  DueNextMonthDays?: number;
  Active?: boolean;
}

export interface OutstandingBill {
  id: string;
  txnDate: string;
  dueDate?: string;
  totalAmt: number;
  balance: number;
  vendorRef: { value: string; name?: string };
  docNumber?: string;
}

export interface VendorCreditItem {
  id: string;
  txnDate: string;
  totalAmt: number;
  balance: number;
  vendorRef: { value: string; name?: string };
  docNumber?: string;
}

export interface BillPaymentLineItem {
  amount: number;
  linkedTxn: {
    txnId: string;
    txnType: 'Bill' | 'VendorCredit';
  };
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
export interface RetryBatchResult {
  scanRecordId: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  qbJournalEntryId?: string;
  docNumber?: string;
  errorMessage?: string;
  errorType?: string;
  skipReason?: 'max_retries' | 'no_payload';
  attemptCount: number;
}

export interface RetryBatchSummary {
  total: number;
  retried: number;
  succeeded: number;
  skipped: number;
  failed: number;
}
export type TabId = 'dashboard' | 'scan' | 'mappings' | 'rules' | 'preview' | 'payments' | 'data' | 'sync' | 'settings' | 'products' | 'partners' | 'requests' | 'my-team' | 'activity' | 'admins' | 'users' | 'locations';

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
  blocked?: boolean;
  createdAt?: string;
  trialExpiresAt?: string | null;
  customExpiryMessage?: string | null;
  timeBombAt?: string | null;
  gracePeriodHours?: number;
  effectiveAccess?: EffectiveAccess;
  admin?: {
    subscriptionSource?: string | null;
    currentPlan?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
    paymentIssue?: boolean;
  };
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
