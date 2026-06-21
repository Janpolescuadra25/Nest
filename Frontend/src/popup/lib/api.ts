import type { Location, Mapping, ScanMode, Template, Rule, RuleFormData, ScanData, ScanRecord, ScanEntry, Product, ProductFormData, ProductMapping, ProductMappingFormData, QBStatus, ScanHealth, AuditLogEntry, OwnerAuditLogEntry, ExportTemplate, ImportResult, InviteLink, TeamMember, BatchSyncItem, BatchSyncResult, BatchSyncSummary, RetryBatchResult, RetryBatchSummary, ExcelParseResult, ExcelDataParseResult, OutstandingBill, VendorCreditItem, BillPaymentLineItem, QBTerm, MappingSuggestion } from '../../types';
import type { QBAccount, QBClass, QBEmployee, QBVendor, QBCustomer, QBTaxCode } from '../types/qb';
import { BACKEND_URL as BASE_URL } from '../../lib/config';

export class ApiError extends Error {
  public readonly status: number;
  public readonly payload: any;

  constructor(message: string, status: number, payload?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function headers(jwt?: string | null): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) h['Authorization'] = `Bearer ${jwt}`;
  return h;
}

async function parseResponse<T>(res: Response, path: string): Promise<T> {
  const payload = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) {
    const message = payload?.error ?? `API ${path} failed`;
    throw new ApiError(message, res.status, payload);
  }

  return payload as T;
}

async function get<T>(path: string, jwt?: string | null): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: await headers(jwt) });
  return parseResponse<T>(res, path);
}

async function post<T>(path: string, body: unknown, jwt?: string | null): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: await headers(jwt),
    body: JSON.stringify(body),
  });
  return parseResponse<T>(res, path);
}

async function postForm<T>(path: string, form: FormData, jwt?: string | null): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
    body: form,
  });
  return parseResponse<T>(res, path);
}

async function put<T>(path: string, body: unknown, jwt?: string | null): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: await headers(jwt),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
    throw new Error(err.error ?? `API ${path} failed`);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown, jwt?: string | null): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: await headers(jwt),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
    throw new Error(err.error ?? `API ${path} failed`);
  }
  return res.json() as Promise<T>;
}

async function del(path: string, jwt?: string | null): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: await headers(jwt),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
    throw new Error(err.error ?? `API ${path} failed`);
  }
}

export interface Plan {
  id: string;
  name: string;
  pricePhp: number;
  priceUsd: number;
  interval: string;
  users: number;
  locations: number;
  features: string[];
}

export interface UserInfo {
  id: string;
  email: string;
  role: string;
  name: string | null;
  status: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
  permissions?: Record<string, boolean> | null;
  trialExpiresAt: string | null;
  customExpiryMessage: string | null;
  subscriptionSource?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPlan?: string | null;
  planInterval?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  paymentIssue?: boolean;
  maxUsers?: number | null;
  maxLocations?: number | null;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const api = {
  getSession: (jwt: string) =>
    get<{ user: UserInfo }>('/api/auth/session', jwt),

  login: (email: string, password: string) =>
    post<{ token: string; user: UserInfo }>('/api/auth/login', { email, password }),

  createCheckoutSession: (jwt: string, plan: string) =>
    post<{ url: string }>('/api/checkout/create-session', { plan }, jwt),

  createPortalSession: (jwt: string) =>
    post<{ url: string }>('/api/checkout/create-portal-session', {}, jwt),

  getPlans: (jwt?: string | null) =>
    get<{ plans: Plan[] }>('/api/checkout/plans', jwt),

  changePassword: (jwt: string, currentPassword: string, newPassword: string) =>
    post<{ message: string }>('/api/auth/change-password', { currentPassword, newPassword }, jwt),

  resendEmailVerification: (jwt: string) =>
    post<{ message: string }>('/api/email-verification/request', {}, jwt),

  // ── Admin Requests ─────────────────────────────────────────────────────────
  submitAdminRequest: (email: string, name: string, description: string, company?: string) =>
    post<{ id: string; email: string; status: string }>('/api/admin-requests', { email, name, description, company }),

  getAdminRequests: (jwt: string, page = 1, status?: string) =>
    get<{ requests: Array<{ id: string; email: string; name: string | null; description: string | null; company: string | null; status: string; createdAt: string; approvedBy?: { id: string; name: string | null } | null }>; total: number; page: number; limit: number }>(
      `/api/admin-requests?page=${page}${status ? `&status=${status}` : ''}`, jwt
    ),

  approveAdminRequest: (jwt: string, id: string) =>
    post<{ user: { id: string; email: string; name: string | null; role: string }; tempPassword: string }>(`/api/admin-requests/${id}/approve`, {}, jwt),

  rejectAdminRequest: (jwt: string, id: string) =>
    post<{ message: string }>(`/api/admin-requests/${id}/reject`, {}, jwt),

  // ── Owner ──────────────────────────────────────────────────────────────────
  getOwnerStats: (jwt: string) =>
    get<{
      totalPartners: number;
      totalTeamMembers: number;
      totalLocations: number;
      totalScans: number;
      totalSynced: number;
      totalFailed: number;
      totalPendingRequests: number;
      expiredMembers: number;
      totalPending: number;
    }>('/api/owner/stats', jwt),

  getScanHealth: (jwt: string, days: number = 3) =>
    get<ScanHealth>(`/api/scans/health?days=${days}`, jwt),

  getAuditLog: (jwt: string, params?: { page?: number; limit?: number; action?: string; actorId?: string; dateFrom?: string; dateTo?: string }) => {
    const sp = new URLSearchParams();
    if (params?.page) sp.set('page', String(params.page));
    if (params?.limit) sp.set('limit', String(params.limit));
    if (params?.action) sp.set('action', params.action);
    if (params?.actorId) sp.set('actorId', params.actorId);
    if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
    if (params?.dateTo) sp.set('dateTo', params.dateTo);
    const qs = sp.toString();
    return get<{ logs: OwnerAuditLogEntry[]; total: number; page: number; limit: number }>(`/api/owner/audit-log${qs ? '?' + qs : ''}`, jwt);
  },

  getOwnerAdmins: (jwt: string) =>
    get<{ admins: Array<{ id: string; email: string; name: string | null; maxUsers: number | null; status: string; createdAt: string; updatedAt: string; currentTeamSize: number; description: string | null; company: string | null }> }>('/api/owner/admins', jwt),

  patchOwnerAdmin: (jwt: string, id: string, data: { maxUsers?: number; status?: string }) =>
    patch<{ admin: { id: string; email: string; name: string | null; maxUsers: number | null; status: string } }>(`/api/owner/admins/${id}`, data, jwt),

  getOwnerAdminTeam: (jwt: string, adminId: string) =>
    get<{ users: Array<UserInfo & { createdAt?: string; trialExpiresAt?: string | null; customExpiryMessage?: string | null }> }>(`/api/owner/admins/${adminId}/team`, jwt),

  getOwnerUsers: (jwt: string, params?: { role?: string; status?: string; search?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.role) sp.set('role', params.role);
    if (params?.status) sp.set('status', params.status);
    if (params?.search) sp.set('search', params.search);
    if (params?.page) sp.set('page', String(params.page));
    const qs = sp.toString();
    return get<{ users: Array<{ id: string; email: string; name: string | null; role: string; status: string; adminId: string | null; adminName: string | null; adminEmail: string | null; blocked: boolean; trialExpiresAt: string | null; customExpiryMessage: string | null; permissions?: Record<string, boolean> | null; createdAt: string }> }>(`/api/owner/users${qs ? '?' + qs : ''}`, jwt);
  },

  blockOwnerUser: (jwt: string, id: string, blocked: boolean) =>
    patch<{ user: { id: string; email: string; role: string; status: string; blocked: boolean } }>(`/api/owner/users/${id}/block`, { blocked }, jwt),

  ownerResetTrial: (jwt: string, id: string, data: { trialExpiresAt?: string; status?: string }) =>
    patch<{ message?: string; user: { id: string; email: string; role: string; status: string; trialExpiresAt: string | null } }>(`/api/owner/users/${id}/timebomb`, data, jwt),

  ownerClearTimebomb: (jwt: string, id: string) =>
    patch<{ user: { id: string; email: string; role: string; status: string } }>(`/api/owner/users/${id}/timebomb/clear`, {}, jwt),

  ownerResetPermissions: (jwt: string, userId: string) =>
    patch<{ user: { id: string } }>(`/api/owner/users/${userId}/permissions-reset`, {}, jwt),

  // ── Admin Team ─────────────────────────────────────────────────────────────
  getAdminStats: (jwt: string) =>
    get<{
      teamSize: number;
      maxUsers: number;
      totalScans: number;
      totalSynced: number;
      totalFailed: number;
      expiringSoon: number;
      totalPending: number;
    }>('/api/admin/stats', jwt),

  getAdminAuditLog: (jwt: string, page?: number, limit?: number) =>
    get<{ logs: AuditLogEntry[]; total: number; page: number; limit: number }>(`/api/admin/audit-log?page=${page || 1}&limit=${limit || 10}`, jwt),

  getAdminTeam: (jwt: string) =>
    get<{ users: Array<UserInfo & { createdAt?: string; trialExpiresAt?: string | null; customExpiryMessage?: string | null }> }>('/api/admin/team', jwt),

  inviteTeamMember: (jwt: string, email: string, role: string, name?: string, trialDays?: number, customExpiryMessage?: string) =>
    post<{ user: { id: string; email: string; name: string | null; role: string; adminId: string }; tempPassword: string }>('/api/admin/team/invite', { email, role, name, ...(trialDays ? { trialDays } : {}), ...(customExpiryMessage ? { customExpiryMessage } : {}) }, jwt),

  patchTeamMember: (jwt: string, id: string, data: object) =>
    patch<{ user: UserInfo }>(`/api/admin/team/${id}`, data, jwt),

  disableTeamMember: (jwt: string, id: string) =>
    post<{ message: string }>(`/api/admin/team/${id}/disable`, {}, jwt),

  // ── Invite Links ──────────────────────────────────────────────────────────
  createInviteLink: (jwt: string, data: { roleHint?: string; expiresInHours?: number; maxUses?: number }) =>
    post<{ invite: InviteLink }>('/api/admin/invite', data, jwt),

  listInviteLinks: (jwt: string, page = 1) =>
    get<{ invites: InviteLink[]; pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean } }>(`/api/admin/invites?page=${page}`, jwt),

  revokeInviteLink: (jwt: string, id: string) =>
    del(`/api/admin/invites/${id}`, jwt),

  listOwnerInviteLinks: (jwt: string, page?: number) =>
    get<{ invites: InviteLink[]; pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean } }>(`/api/owner/invites${page ? `?page=${page}` : ''}`, jwt),

  revokeOwnerInviteLink: (jwt: string, id: string) =>
    del(`/api/owner/invites/${id}`, jwt),

  // ── Time Bombs ────────────────────────────────────────────────────────────
  setTimeBomb: (jwt: string, userId: string, timeBombAt: string, gracePeriodHours?: number) =>
    patch<{ user: TeamMember }>(`/api/admin/users/${userId}/timebomb`, { timeBombAt, gracePeriodHours }, jwt),

  clearTimeBomb: (jwt: string, userId: string) =>
    patch<{ user: TeamMember }>(`/api/admin/users/${userId}/timebomb/clear`, {}, jwt),

  // ── Role Change ───────────────────────────────────────────────────────────
  changeUserRole: (jwt: string, userId: string, role: string) =>
    patch<{ user: TeamMember }>(`/api/admin/users/${userId}/role`, { role }, jwt),

  // ── Locations ──────────────────────────────────────────────────────────────
  getLocations: (jwt: string) => get<{ data: Location[]; pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean } }>('/api/locations', jwt),

  createLocation: (jwt: string, name: string, posUrl: string) =>
    post<Location>('/api/locations', { name, posUrl }, jwt),

  updateLocation: (jwt: string, id: string, data: Partial<Location>) =>
    put<Location>(`/api/locations/${id}`, data, jwt),

  deleteLocation: (jwt: string, id: string) => del(`/api/locations/${id}`, jwt),

  // ── Mappings ───────────────────────────────────────────────────────────────
  getMappings: (jwt: string, locationId: string) =>
    get<Mapping[]>(`/api/locations/${locationId}/mappings`, jwt),

  createMapping: (jwt: string, locationId: string, data: Omit<Mapping, 'id' | 'locationId' | 'createdAt'>) =>
    post<Mapping>(`/api/locations/${locationId}/mappings`, data, jwt),

  updateMapping: (jwt: string, id: string, data: Partial<Mapping>) =>
    put<Mapping>(`/api/mappings/${id}`, data, jwt),

  deleteMapping: (jwt: string, id: string) => del(`/api/mappings/${id}`, jwt),

  suggestMappings: (jwt: string, locationId: string, scanFields: string[], transactionType?: string) =>
    post<{ suggestions: MappingSuggestion[] }>('/api/mappings/suggest', { locationId, scanFields, transactionType }, jwt),

  // ── Templates ──────────────────────────────────────────────────────────────
  getTemplates: (jwt: string, locationId: string) =>
    get<Template[]>(`/api/locations/${locationId}/templates`, jwt),

  getTemplate: (jwt: string, id: string) =>
    get<Template>(`/api/templates/${id}`, jwt),

  createTemplate: (jwt: string, locationId: string, data: { name: string; transactionType?: string; scanMode?: ScanMode; posSystem?: string | null; memoTemplate?: string; docNumberTemplate?: string }) =>
    post<Template>(`/api/locations/${locationId}/templates`, data, jwt),

  updateTemplate: (jwt: string, id: string, data: Partial<Template>) =>
    put<Template>(`/api/templates/${id}`, data, jwt),

  deleteTemplate: (jwt: string, id: string) => del(`/api/templates/${id}`, jwt),

  parseExcel: (jwt: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return postForm<ExcelParseResult>('/api/templates/parse-excel', form, jwt);
  },

  parseExcelData: (jwt: string, templateId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return postForm<ExcelDataParseResult>(`/api/templates/parse-excel-data?templateId=${encodeURIComponent(templateId)}`, form, jwt);
  },

  parseDocumentAI: async (jwt: string, file: File): Promise<{
    classification: {
      documentType: 'INVOICE' | 'CHEQUE' | 'POS_REPORT' | 'RECEIPT' | 'OTHER';
      confidence: number;
      reasoning: string;
    };
    invoiceData: { header: Record<string, string>; lineItems: Record<string, string>[] } | null;
    chequeData: { chequeNumber: string; payeeName: string; amount: string; date: string; memo: string; bankName: string; lineItems: { description: string; amount: string }[] } | null;
  }> => {
    const form = new FormData();
    form.append('file', file);
    return postForm<{ success: boolean; data: { classification: { documentType: 'INVOICE' | 'CHEQUE' | 'POS_REPORT' | 'RECEIPT' | 'OTHER'; confidence: number; reasoning: string; }; invoiceData: { header: Record<string, string>; lineItems: Record<string, string>[] } | null; chequeData: { chequeNumber: string; payeeName: string; amount: string; date: string; memo: string; bankName: string; lineItems: { description: string; amount: string }[] } | null; } }>(
      '/api/scans/parse-document',
      form,
      jwt
    ).then(res => res.data);
  },

  // ── Rules ──────────────────────────────────────────────────────────────────
  getRules: (jwt: string, locationId: string, templateId?: string | null) =>
    get<Rule[]>(`/api/locations/${locationId}/rules${templateId ? `?templateId=${encodeURIComponent(templateId)}` : ''}`, jwt),

  applyRules: (jwt: string, params: {
    scanData?: Record<string, number>;
    lineItems?: Record<string, string>[];
    rules: Array<{ id: string; name: string; ruleType: string; config: Record<string, unknown>; isActive: boolean }>;
  }) => post<{ type: 'flat'; data: Record<string, number> } | { type: 'lineItems'; data: Record<string, string>[] }>('/api/rules/apply', params, jwt),

  createRule: (jwt: string, locationId: string, data: RuleFormData) =>
    post<Rule>(`/api/locations/${locationId}/rules`, data, jwt),

  updateRule: (jwt: string, id: string, data: Partial<RuleFormData>) =>
    put<Rule>(`/api/rules/${id}`, data, jwt),

  deleteRule: (jwt: string, id: string) => del(`/api/rules/${id}`, jwt),

  // ── Template Import ────────────────────────────────────────────────────────
  importTemplate: (jwt: string, locationId: string, data: Omit<ExportTemplate, 'version' | 'exportedAt' | 'sourceLocationName' | 'sourceRealmId'> & { mode: 'replace' | 'merge' }) =>
    post<ImportResult>(`/api/locations/${locationId}/import-template`, data, jwt),

  // ── Scans ──────────────────────────────────────────────────────────────────
  saveScan: (jwt: string, locationId: string, scanDate: string, rawData: ScanData, transactionType?: string) =>
    post<{ id: string }>('/api/scans', { locationId, scanDate, rawData, ...(transactionType ? { transactionType } : {}) }, jwt),

  saveScanEntry: (jwt: string, locationId: string, scanDate: string, rawScanEntry: ScanEntry, source: string, transactionType?: string) =>
    post<{ id: string }>('/api/scans', { locationId, scanDate, rawScanEntry, source, ...(transactionType ? { transactionType } : {}) }, jwt),

  parseInvoiceAI: async (jwt: string, file: File): Promise<{ header: Record<string, string>; lineItems: Record<string, string>[] }> => {
    const form = new FormData();
    form.append('file', file);
    return postForm<{ success: boolean; data: { header: Record<string, string>; lineItems: Record<string, string>[] } }>(
      '/api/scans/parse-invoice',
      form,
      jwt
    ).then(res => res.data);
  },

  // ── Products ─────────────────────────────────────────────────────────────────
  getProducts: (jwt: string) =>
    get<Product[]>('/api/products', jwt),

  createProduct: (jwt: string, data: ProductFormData) =>
    post<Product>('/api/products', data, jwt),

  updateProduct: (jwt: string, id: string, data: ProductFormData) =>
    put<Product>(`/api/products/${id}`, data, jwt),

  deleteProduct: (jwt: string, id: string) =>
    del(`/api/products/${id}`, jwt),

  // ── Product Mappings ─────────────────────────────────────────────────────
  getProductMappings: (jwt: string, templateId: string) =>
    get<ProductMapping[]>(`/api/product-mappings/${templateId}`, jwt),

  createProductMapping: (jwt: string, data: ProductMappingFormData) =>
    post<ProductMapping>('/api/product-mappings', data, jwt),

  updateProductMapping: (jwt: string, id: string, data: Partial<ProductMappingFormData>) =>
    put<ProductMapping>(`/api/product-mappings/${id}`, data, jwt),

  deleteProductMapping: (jwt: string, id: string) =>
    del(`/api/product-mappings/${id}`, jwt),

  getScans: (jwt: string, locationId: string, page?: number, limit?: number) => {
    const sp = new URLSearchParams();
    sp.set('page', String(page || 1));
    sp.set('limit', String(limit || 20));
    const qs = sp.toString();
    return get<{ scans: ScanRecord[]; hasMore: boolean }>(
      `/api/locations/${locationId}/scans${qs ? '?' + qs : ''}`,
      jwt
    );
  },

  // ── QuickBooks ─────────────────────────────────────────────────────────────
  getQBAuthUrl: (jwt: string) =>
    get<{ authUrl: string; state: string }>('/api/quickbooks/auth-url', jwt),

  getQBStatus: (jwt: string) => get<QBStatus>('/api/quickbooks/status', jwt),

  deleteQBToken: (jwt: string) => del('/api/quickbooks/token', jwt),

  createJournalEntry: (
    jwt: string,
    txnDate: string,
    lines: unknown[],
    scanRecordId?: string,
    privateNote?: string,
    docNumber?: string,
    skipDedupCheck?: boolean,
  ) =>
    post('/api/quickbooks/journal-entry', { txnDate, lines, scanRecordId, privateNote, docNumber, ...(skipDedupCheck ? { skipDedupCheck } : {}) }, jwt),

  createBill: (
    jwt: string,
    txnDate: string,
    vendorRef: { value: string; name?: string },
    apAccountRef: { value: string; name?: string },
    termsRef: { value: string; name?: string } | undefined,
    dueDate: string | undefined,
    memo: string | undefined,
    docNumber: string | undefined,
    lines: unknown[],
    scanRecordId?: string,
    skipDedupCheck?: boolean,
  ) =>
    post('/api/quickbooks/bill', { txnDate, vendorRef, apAccountRef, termsRef, dueDate, memo, docNumber, lines, scanRecordId, ...(skipDedupCheck ? { skipDedupCheck } : {}) }, jwt),

  createVendorCredit: (
    jwt: string,
    vendorRef: { value: string; name?: string },
    txnDate: string,
    apAccountRef: { value: string; name?: string },
    lines: unknown[],
    scanRecordId?: string,
    memo?: string,
    docNumber?: string,
    skipDedupCheck?: boolean,
  ) =>
    post('/api/quickbooks/vendorcredit', { vendorRef, txnDate, apAccountRef, lines, scanRecordId, memo, docNumber, ...(skipDedupCheck ? { skipDedupCheck } : {}) }, jwt),

  createCheque: (
    jwt: string,
    txnDate: string,
    bankAccountRef: { value: string; name?: string },
    payeeRef: { value: string; name?: string },
    amount: number,
    lines: unknown[],
    scanRecordId?: string,
    memo?: string,
    docNumber?: string,
    skipDedupCheck?: boolean,
  ) =>
    post('/api/quickbooks/cheque', { txnDate, bankAccountRef, payeeRef, amount, lines, scanRecordId, memo, docNumber, ...(skipDedupCheck ? { skipDedupCheck } : {}) }, jwt),

  syncBatch: (jwt: string, items: BatchSyncItem[]) =>
    post<{ results: BatchSyncResult[]; summary: BatchSyncSummary }>(
      '/api/quickbooks/sync-batch',
      { items },
      jwt,
    ),

  retryScan: (jwt: string, scanRecordId: string) =>
    post<{ success: boolean; qbJournalEntryId?: string; docNumber?: string; errorMessage?: string; errorType?: string; attemptCount: number }>(
      `/api/quickbooks/retry/${scanRecordId}`,
      {},
      jwt,
    ),

  retryBatch: (jwt: string, body: { locationId?: string; scanRecordIds?: string[] }) =>
    post<{ results: RetryBatchResult[]; summary: RetryBatchSummary }>(
      '/api/quickbooks/retry-batch',
      body,
      jwt,
    ),

  getQBAccounts: (jwt: string) => get<{ accounts: QBAccount[] }>('/api/quickbooks/accounts', jwt),
  getOutstandingBills: (jwt: string, vendorId?: string) =>
    get<{ bills: OutstandingBill[] }>(`/api/quickbooks/bills${vendorId ? `?vendorId=${vendorId}` : ''}`, jwt),
  getVendorCredits: (jwt: string, vendorId?: string) =>
    get<{ vendorCredits: VendorCreditItem[] }>(`/api/quickbooks/vendor-credits${vendorId ? `?vendorId=${vendorId}` : ''}`, jwt),
  createBillPayment: (
    jwt: string,
    vendorRef: { value: string; name?: string },
    payType: 'Cash' | 'Check' | 'CreditCard' | 'Other',
    txnDate: string,
    totalAmt: number,
    lines: BillPaymentLineItem[],
    bankAccountRef?: { value: string; name?: string },
    checkNum?: string,
    skipDedupCheck?: boolean,
  ) =>
    post<{ message: string; billPaymentId: string; txnDate: string; totalAmount: number }>(
      '/api/quickbooks/bill-payment',
      { vendorRef, payType, txnDate, totalAmt, lines, bankAccountRef, checkNum, skipDedupCheck },
      jwt,
    ),
  getQBClasses: (jwt: string) => get<{ classes: QBClass[] }>('/api/quickbooks/classes', jwt),
  getQBEmployees: (jwt: string) => get<{ employees: QBEmployee[] }>('/api/quickbooks/employees', jwt),
  getQBVendors: (jwt: string) => get<{ vendors: QBVendor[] }>('/api/quickbooks/vendors', jwt),
  getQBCustomers: (jwt: string) => get<{ customers: QBCustomer[] }>('/api/quickbooks/customers', jwt),
  getQBTaxCodes: (jwt: string) => get<{ taxCodes: QBTaxCode[] }>('/api/quickbooks/tax-codes', jwt),
  syncQBAll: (jwt: string) => get<{
    accounts: QBAccount[];
    classes: QBClass[];
    employees: QBEmployee[];
    vendors: QBVendor[];
    customers: QBCustomer[];
    taxCodes: QBTaxCode[];
    terms: QBTerm[];
  }>('/api/quickbooks/sync-all', jwt),

  // ── Admin ──────────────────────────────────────────────────────────────────

  requestPasswordReset: (email: string) =>
    post<{ message: string }>('/api/password-reset/request', { email }),
};

