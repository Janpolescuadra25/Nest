import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

interface AccessRequest {
  id: string; email: string; name: string | null;
  type: 'SIGNUP' | 'RESET'; status: string; createdAt: string;
}
interface UserRecord {
  id: string; email: string; name: string | null;
  role: string; createdAt: string;
}
type Tab = 'requests' | 'users';

interface AdminDashboardProps {
  jwt: string;
  onSignOut: () => void;
  currentUserId: string;
}

export default function AdminDashboard({ jwt, onSignOut, currentUserId }: AdminDashboardProps) {
  const [tab, setTab] = useState<Tab>('requests');
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');

  const fetchRequests = useCallback(async () => {
    try { const data = await api.getRequests(jwt); setRequests(data.requests as AccessRequest[]); }
    catch (err: any) { setError(err.message); }
  }, [jwt]);

  const fetchUsers = useCallback(async () => {
    try { const data = await api.getUsers(jwt); setUsers(data.users); }
    catch (err: any) { setError(err.message); }
  }, [jwt]);

  useEffect(() => {
    (async () => { setLoading(true); await Promise.all([fetchRequests(), fetchUsers()]); setLoading(false); })();
  }, [fetchRequests, fetchUsers]);

  const handleApprove = async (id: string) => {
    setActionLoading(p => ({ ...p, [id]: true }));
    try { await api.approveRequest(id, jwt); await fetchRequests(); await fetchUsers(); }
    catch (err: any) { setError(err.message); }
    finally { setActionLoading(p => ({ ...p, [id]: false })); }
  };

  const handleReject = async (id: string) => {
    setActionLoading(p => ({ ...p, [id]: true }));
    try { await api.rejectRequest(id, jwt); await fetchRequests(); }
    catch (err: any) { setError(err.message); }
    finally { setActionLoading(p => ({ ...p, [id]: false })); }
  };

  const handleDeleteUser = async (u: UserRecord) => {
    if (!confirm(`Delete ${u.email}? This permanently removes the user and ALL their data.`)) return;
    setActionLoading(p => ({ ...p, [u.id]: true }));
    try { await api.deleteUser(u.id, jwt); await fetchUsers(); }
    catch (err: any) { setError(err.message); }
    finally { setActionLoading(p => ({ ...p, [u.id]: false })); }
  };

  if (loading) return <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Loading...</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
        <h1 className="text-sm font-semibold text-white">Admin Dashboard</h1>
        <div className="flex items-center">
          <button onClick={onSignOut} className="text-xs text-red-400 hover:text-red-300">Sign Out</button>
        </div>
      </div>
      <div className="flex border-b border-slate-700">
        <button onClick={() => { setTab('requests'); setError(''); }} className={`flex-1 py-2 text-sm font-medium text-center ${tab === 'requests' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-gray-400 hover:text-gray-300'}`}>
          Requests {requests.length > 0 && `(${requests.length})`}
        </button>
        <button onClick={() => { setTab('users'); setError(''); }} className={`flex-1 py-2 text-sm font-medium text-center ${tab === 'users' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-gray-400 hover:text-gray-300'}`}>
          Users ({users.length})
        </button>
      </div>
      {error && <div className="mx-4 mt-2 p-2 bg-red-900/50 text-red-300 text-xs rounded">{error}</div>}
      {tab === 'requests' && (
        <div className="flex-1 overflow-y-auto p-4">
          {requests.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No pending requests.</p>
          ) : (
            <div className="space-y-3">
              {requests.map(req => (
                <div key={req.id} className="p-3 bg-slate-800 rounded-lg">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{req.email}</p>
                      {req.name && <p className="text-xs text-gray-400">{req.name}</p>}
                      <span className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full ${req.type === 'SIGNUP' ? 'bg-blue-900/50 text-blue-300' : 'bg-amber-900/50 text-amber-300'}`}>
                        {req.type === 'SIGNUP' ? 'New Account' : 'Password Reset'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleApprove(req.id)} disabled={actionLoading[req.id]} className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">Approve</button>
                      <button onClick={() => handleReject(req.id)} disabled={actionLoading[req.id]} className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">Reject</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'users' && (
        <div className="flex-1 overflow-y-auto p-4">
          {users.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No users found.</p>
          ) : (
            <div className="space-y-2">
              {users.map(u => (
                <div key={u.id} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-white">{u.email}</p>
                    <p className="text-xs text-gray-400">{u.name || 'No name'} · {u.role}</p>
                  </div>
                  {u.id === currentUserId ? (
                    <span className="text-xs text-gray-500 italic">(you)</span>
                  ) : (
                    <button onClick={() => handleDeleteUser(u)} disabled={actionLoading[u.id]} className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">
                      {actionLoading[u.id] ? '...' : 'Delete'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
