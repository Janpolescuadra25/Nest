import { UserRole, UserStatus } from '@prisma/client';

// Central type definitions for the Qyra backend

export interface AuthPayload {
  /** Primary identifier — same value as userId (kept for backward compat) */
  id: string;
  /** Backward-compat alias for id — all existing routes use this */
  userId: string;
  email: string;
  emailVerified: boolean;
  name?: string | null;
  role: UserRole;
  status: UserStatus;
  adminId: string | null;
  mustChangePassword: boolean;
  trialExpiresAt: Date | null;
  maxUsers: number | null;
  // RBAC extension fields
  permissions: Record<string, boolean> | null;
  timeBombAt: Date | string | null;
  gracePeriodHours: number;
  maxScans?: number | null;
  scanHistoryDays?: number | null;
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

export interface QBBillLineItem {
  amount: number;
  accountRef: { value: string; name?: string };
  classRef?: { value: string; name?: string };
  taxCodeRef?: { value: string; name?: string };
  description?: string;
}

export interface QBChequeLineItem {
  amount: number;
  accountRef: { value: string; name?: string };
  description?: string;
  classRef?: { value: string; name?: string };
  taxCodeRef?: { value: string; name?: string };
}

export interface MappingSuggestion {
  sourceField: string;
  accountHint: string;
  accountName: string;
  accountId?: string;
  postingType: 'Debit' | 'Credit';
  reason: string;
}

export interface CreateChequeInput {
  realmId: string;
  accessToken: string;
  txnDate: string;
  docNumber?: string;
  bankAccountRef: { value: string; name?: string };
  payeeRef: { value: string; name?: string };
  customerRef?: { value: string; name?: string };
  amount: number;
  memo?: string;
  lines: QBChequeLineItem[];
}

export interface ChequeResponse {
  id: string;
  txnDate: string;
  totalAmt: number;
  docNumber: string;
  syncToken: string;
}

export interface CreateJournalEntryInput {
  txnDate: string;             // YYYY-MM-DD
  docNumber?: string;
  privateNote?: string;
  lines: QBJournalLineItem[];
  realmId: string;
  accessToken: string;
}

export interface CreateBillInput {
  txnDate: string;             // YYYY-MM-DD
  docNumber?: string;
  vendorRef: { value: string; name?: string };
  apAccountRef: { value: string; name?: string };
  termsRef?: { value: string; name?: string };
  dueDate?: string;
  memo?: string;
  privateNote?: string;
  lines: QBBillLineItem[];
  realmId: string;
  accessToken: string;
}

export interface CreateVendorCreditInput {
  txnDate: string;             // YYYY-MM-DD
  docNumber?: string;
  vendorRef: { value: string; name?: string };
  apAccountRef: { value: string; name?: string };
  memo?: string;
  privateNote?: string;
  lines: QBBillLineItem[];
  realmId: string;
  accessToken: string;
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

export interface BillPaymentLine {
  amount: number;
  linkedTxn: {
    txnId: string;
    txnType: 'Bill' | 'VendorCredit';
  };
}

export interface CreateBillPaymentInput {
  vendorRef: { value: string; name?: string };
  payType: 'Cash' | 'Check' | 'CreditCard' | 'Other';
  bankAccountRef?: { value: string; name?: string };
  checkNum?: string;
  txnDate: string;
  totalAmt: number;
  lines: BillPaymentLine[];
  realmId: string;
  accessToken: string;
}

export interface BillPaymentResponse {
  id: string;
  txnDate: string;
  totalAmt: number;
  syncToken: string;
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

export interface POSDetectionResult {
  isPOS: boolean;
  posType: string | null;
  confidence: number;
  reasoning: string;
}

export interface POSReportData {
  rawData: Record<string, number>;
  scanDate: string;
  totalSales: number;
  paymentBreakdown?: Record<string, number>;
}

export interface ParsePOSTabResponse {
  detection: POSDetectionResult;
  data: POSReportData | null;
  attachment?: { fileName: string; storageKey: string; fileSize: number; mimeType: string } | null;
}

