// Central type definitions for the Nest backend

export interface AuthPayload {
  userId: string;
  email: string;
  role?: string;
  name?: string | null;
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
