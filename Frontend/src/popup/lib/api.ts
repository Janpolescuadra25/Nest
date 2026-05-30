import type { Location, Mapping, Rule, ScanData, QBStatus, AuditLogEntry } from '../../types';
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

interface UserInfo {
  id: string;
  email: string;
  role: string;
  name: string | null;
  status: string;
  mustChangePassword: boolean;
  canScan: boolean;
  canMap: boolean;
  canSync: boolean;
  canManageLocs: boolean;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const api = {
  getSession: (jwt: string) =>
    get<{ user: UserInfo }>('/api/auth/session', jwt),

  login: (email: string, password: string) =>
    post<{ token: string; user: UserInfo }>('/api/auth/login', { email, password }),

  changePassword: (jwt: string, currentPassword: string, newPassword: string) =>
    post<{ message: string }>('/api/auth/change-password', { currentPassword, newPassword }, jwt),

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
    }>('/api/owner/stats', jwt),

  getScanHealth: (jwt: string) =>
    get<{
      totalScans: number;
      successfulScans: number;
      failedScans: number;
      pendingScans: number;
      mappedScans: number;
      successRate: number;
      lastScanAt: string | null;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
    }>('/api/scans/health', jwt),

  getAuditLog: (jwt: string, params?: { page?: number; limit?: number; action?: string; actorId?: string; dateFrom?: string; dateTo?: string }) => {
    const sp = new URLSearchParams();
    if (params?.page) sp.set('page', String(params.page));
    if (params?.limit) sp.set('limit', String(params.limit));
    if (params?.action) sp.set('action', params.action);
    if (params?.actorId) sp.set('actorId', params.actorId);
    if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
    if (params?.dateTo) sp.set('dateTo', params.dateTo);
    const qs = sp.toString();
    return get<{ logs: AuditLogEntry[]; total: number; page: number; limit: number }>(`/api/owner/audit-log${qs ? '?' + qs : ''}`, jwt);
  },

  getOwnerAdmins: (jwt: string) =>
    get<{ admins: Array<{ id: string; email: string; name: string | null; maxUsers: number | null; status: string; createdAt: string; updatedAt: string; currentTeamSize: number; description: string | null; company: string | null }> }>('/api/owner/admins', jwt),

  patchOwnerAdmin: (jwt: string, id: string, data: { maxUsers?: number; status?: string }) =>
    patch<{ admin: { id: string; email: string; name: string | null; maxUsers: number | null; status: string } }>(`/api/owner/admins/${id}`, data, jwt),

  getOwnerAdminTeam: (jwt: string, adminId: string) =>
    get<{ users: Array<UserInfo & { createdAt?: string; trialExpiresAt?: string | null; customExpiryMessage?: string | null }> }>(`/api/owner/admins/${adminId}/team`, jwt),

  // ── Admin Team ─────────────────────────────────────────────────────────────
  getAdminStats: (jwt: string) =>
    get<{
      teamSize: number;
      maxUsers: number;
      totalScans: number;
      totalSynced: number;
      totalFailed: number;
      expiringSoon: number;
    }>('/api/admin/stats', jwt),

  getAdminAuditLog: (jwt: string, page?: number, limit?: number) =>
    get<{ logs: Array<{ id: string; actorId: string; targetId: string | null; action: string; meta: any; createdAt: string; actor: { name: string | null; email: string } }>; total: number; page: number; limit: number }>(`/api/admin/audit-log?page=${page || 1}&limit=${limit || 10}`, jwt),

  getAdminTeam: (jwt: string) =>
    get<{ users: Array<UserInfo & { createdAt?: string; trialExpiresAt?: string | null; customExpiryMessage?: string | null }> }>('/api/admin/team', jwt),

  inviteTeamMember: (jwt: string, email: string, role: string, name?: string) =>
    post<{ user: { id: string; email: string; name: string | null; role: string; adminId: string }; tempPassword: string }>('/api/admin/team/invite', { email, role, name }, jwt),

  patchTeamMember: (jwt: string, id: string, data: object) =>
    patch<{ user: UserInfo }>(`/api/admin/team/${id}`, data, jwt),

  disableTeamMember: (jwt: string, id: string) =>
    post<{ message: string }>(`/api/admin/team/${id}/disable`, {}, jwt),

  // ── Locations ──────────────────────────────────────────────────────────────
  getLocations: (jwt: string) => get<{ data: Location[]; pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean } }>('/api/locations', jwt),

  createLocation: (jwt: string, name: string, toastUrl: string) =>
    post<Location>('/api/locations', { name, toastUrl }, jwt),

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

  // ── Scans ──────────────────────────────────────────────────────────────────
  saveScan: (jwt: string, locationId: string, scanDate: string, rawData: ScanData) =>
    post<{ id: string }>('/api/scans', { locationId, scanDate, rawData }, jwt),

  getScans: (jwt: string, locationId: string) =>
    get(`/api/locations/${locationId}/scans`, jwt),

  // ── QuickBooks ─────────────────────────────────────────────────────────────
  getQBAuthUrl: (jwt: string) =>
    get<{ authUrl: string; state: string }>('/api/quickbooks/auth-url', jwt),

  getQBStatus: (jwt: string) => get<QBStatus>('/api/quickbooks/status', jwt),

  createJournalEntry: (
    jwt: string,
    txnDate: string,
    lines: unknown[],
    scanRecordId?: string,
    privateNote?: string,
    docNumber?: string
  ) =>
    post('/api/quickbooks/journal-entry', { txnDate, lines, scanRecordId, privateNote, docNumber }, jwt),

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

