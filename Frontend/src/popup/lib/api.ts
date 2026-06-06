import type { Location, Mapping, Rule, ScanData, ScanRecord, QBStatus, ScanHealth, AuditLogEntry, OwnerAuditLogEntry, ExportTemplate, ImportResult, InviteLink, TeamMember, BatchSyncItem, BatchSyncResult, BatchSyncSummary } from '../../types';
import type { QBAccount, QBClass, QBEmployee, QBVendor, QBCustomer, QBTaxCode } from '../types/qb';
import { BACKEND_URL as BASE_URL } from '../../lib/config';

async function headers(jwt?: string | null): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) h['Authorization'] = `Bearer ${jwt}`;
  return h;
}

async function get<T>(path: string, jwt?: string | null): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: await headers(jwt) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
    throw new Error(err.error ?? `API ${path} failed`);
  }
  return res.json();
}

async function post<T>(path: string, body: unknown, jwt?: string | null): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: await headers(jwt),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
    throw new Error(err.error ?? `API ${path} failed`);
  }
  return res.json() as Promise<T>;
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

export interface UserInfo {
  id: string;
  email: string;
  role: string;
  name: string | null;
  status: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
  canScan: boolean;
  canMap: boolean;
  canSync: boolean;
  canManageLocs: boolean;
  trialExpiresAt: string | null;
  customExpiryMessage: string | null;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const api = {
  getSession: (jwt: string) =>
    get<{ user: UserInfo }>('/api/auth/session', jwt),

  login: (email: string, password: string) =>
    post<{ token: string; user: UserInfo }>('/api/auth/login', { email, password }),

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
    return get<{ users: Array<{ id: string; email: string; name: string | null; role: string; status: string; adminId: string | null; adminName: string | null; adminEmail: string | null; blocked: boolean; trialExpiresAt: string | null; customExpiryMessage: string | null; canScan: boolean; canMap: boolean; canSync: boolean; canManageLocs: boolean; createdAt: string }> }>(`/api/owner/users${qs ? '?' + qs : ''}`, jwt);
  },

  blockOwnerUser: (jwt: string, id: string, blocked: boolean) =>
    patch<{ user: { id: string; email: string; role: string; status: string; blocked: boolean } }>(`/api/owner/users/${id}/block`, { blocked }, jwt),

  ownerResetTrial: (jwt: string, id: string, data: { trialExpiresAt?: string; status?: string }) =>
    patch<{ message?: string; user: { id: string; email: string; role: string; status: string; trialExpiresAt: string | null } }>(`/api/owner/users/${id}/timebomb`, data, jwt),

  ownerClearTimebomb: (jwt: string, id: string) =>
    patch<{ user: { id: string; email: string; role: string; status: string } }>(`/api/owner/users/${id}/timebomb/clear`, {}, jwt),

  ownerResetCanX: (jwt: string, userId: string) =>
    patch<{ user: { id: string; canScan: boolean; canMap: boolean; canSync: boolean; canManageLocs: boolean } }>(`/api/owner/users/${userId}/canx-reset`, {}, jwt),

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

  // ── Rules ──────────────────────────────────────────────────────────────────
  getRules: (jwt: string, locationId: string) =>
    get<Rule[]>(`/api/locations/${locationId}/rules`, jwt),

  createRule: (jwt: string, locationId: string, data: Omit<Rule, 'id' | 'locationId' | 'createdAt'>) =>
    post<Rule>(`/api/locations/${locationId}/rules`, data, jwt),

  updateRule: (jwt: string, id: string, data: Partial<Rule>) =>
    put<Rule>(`/api/rules/${id}`, data, jwt),

  deleteRule: (jwt: string, id: string) => del(`/api/rules/${id}`, jwt),

  // ── Template Import ────────────────────────────────────────────────────────
  importTemplate: (jwt: string, locationId: string, data: Omit<ExportTemplate, 'version' | 'exportedAt' | 'sourceLocationName' | 'sourceRealmId'> & { mode: 'replace' | 'merge' }) =>
    post<ImportResult>(`/api/locations/${locationId}/import-template`, data, jwt),

  // ── Scans ──────────────────────────────────────────────────────────────────
  saveScan: (jwt: string, locationId: string, scanDate: string, rawData: ScanData) =>
    post<{ id: string }>('/api/scans', { locationId, scanDate, rawData }, jwt),

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
    docNumber?: string
  ) =>
    post('/api/quickbooks/journal-entry', { txnDate, lines, scanRecordId, privateNote, docNumber }, jwt),

  syncBatch: (jwt: string, items: BatchSyncItem[]) =>
    post<{ results: BatchSyncResult[]; summary: BatchSyncSummary }>(
      '/api/quickbooks/sync-batch',
      { items },
      jwt,
    ),

  getQBAccounts: (jwt: string) => get<{ accounts: QBAccount[] }>('/api/quickbooks/accounts', jwt),
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
  }>('/api/quickbooks/sync-all', jwt),

  // ── Admin ──────────────────────────────────────────────────────────────────

  requestPasswordReset: (email: string) =>
    post<{ message: string }>('/api/password-reset/request', { email }),
};

