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
  getSession: (jwt: string) =>
    get<{ user: { id: string; email: string; role: string; name: string | null } }>('/api/auth/session', jwt),

  login: (email: string, password: string) =>
    post<{ token: string; user: { id: string; email: string; role: string; name: string | null } }>('/api/auth/login', { email, password }),

  requestAccess: (email: string, name: string) =>
    post<{ message: string }>('/api/auth/request-access', { email, name }),

  forgotPassword: (email: string) =>
    post<{ message: string }>('/api/auth/forgot-password', { email }),

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
    get<{ user: { id: string; email: string; role: string; name: string | null } }>('/api/auth/session', jwt),

  getRequests: (jwt: string) =>
    get<{ requests: Array<{ id: string; email: string; name: string | null; type: string; status: string; createdAt: string }> }>('/api/admin/requests', jwt),

  approveRequest: (id: string, jwt: string) =>
    post<{ message: string }>(`/api/admin/requests/${id}/approve`, {}, jwt),

  rejectRequest: (id: string, jwt: string) =>
    post<{ message: string }>(`/api/admin/requests/${id}/reject`, {}, jwt),

  getUsers: (jwt: string) =>
    get<{ users: Array<{ id: string; email: string; name: string | null; role: string; createdAt: string }> }>('/api/admin/users', jwt),

  deleteUser: async (id: string, jwt: string): Promise<{ message: string }> => {
    const res = await fetch(`${BASE_URL}/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: await headers(jwt),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
      throw new Error(err.error ?? 'Delete user failed');
    }
    return res.json();
  },
};
