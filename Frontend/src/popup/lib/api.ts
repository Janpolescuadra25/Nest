import type { Location, Mapping, Rule, ScanData, QBStatus } from '../../types';
import type { QBAccount, QBClass, QBEmployee, QBVendor, QBCustomer, QBTaxCode } from '../types/qb';

// Backend URL — update this to your Render URL after deployment:
// e.g. https://nest-backend-xxx.onrender.com
const BASE_URL = 'https://nest-backend-mddn.onrender.com';

async function headers(jwt?: string | null): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) h['Authorization'] = `Bearer ${jwt}`;
  return h;
}

async function get<T>(path: string, jwt?: string | null): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: await headers(jwt) });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
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
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function del(path: string, jwt?: string | null): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: await headers(jwt),
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const api = {
  login: (email: string) =>
    post<{ message: string; email: string }>('/api/auth/login', { email }),

  verify: (email: string, code: string) =>
    post<{ token: string; userId: string }>('/api/auth/verify', { email, code }),

  getSession: (jwt: string) =>
    get<{ userId: string; email: string; isVerified: boolean }>('/api/auth/session', jwt),

  // ── Locations ──────────────────────────────────────────────────────────────
  getLocations: (jwt: string) => get<Location[]>('/api/locations', jwt),

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
    post('/api/scans', { locationId, scanDate, rawData }, jwt),

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
    privateNote?: string
  ) =>
    post('/api/quickbooks/journal-entry', { txnDate, lines, scanRecordId, privateNote }, jwt),

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
  getCurrentUser: (jwt: string) =>
    get<{ userId: string; email: string; name?: string; role?: string }>('/api/auth/session', jwt),

  adminLogin: async (email: string, password: string) => {
    const res = await fetch(`${BASE_URL}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Login failed' })) as { error?: string };
      throw new Error(err.error ?? 'Login failed');
    }
    return res.json() as Promise<{ token: string; user: { id: string; email: string; name: string; role: string } }>;
  },

  adminGetUsers: (jwt: string) =>
    get<{ users: Array<{ id: string; email: string; name: string; role: string; createdAt: string }> }>('/api/admin/users', jwt),

  adminInvite: (jwt: string, email: string, name?: string) =>
    post<{ message: string; registerUrl: string; expiresIn: string; invitationId: string }>('/api/admin/invite', { email, name }, jwt),

  adminToggleUser: (jwt: string, userId: string, role: string) =>
    put<{ user: { id: string; email: string; name: string; role: string } }>(`/api/admin/users/${userId}`, { role }, jwt),

  adminGetStats: (jwt: string) =>
    get<{ totalUsers: number; activeInvitations: number; totalSyncs: number }>('/api/admin/stats', jwt),
};
