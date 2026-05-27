import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

interface Admin {
  id: string;
  email: string;
  name: string | null;
  maxUsers: number | null;
  status: string;
  createdAt: string;
  currentTeamSize: number;
  description: string | null;
  company: string | null;
}

interface Props {
  jwt: string;
}

export default function PartnersTab({ jwt }: Props) {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editMaxUsers, setEditMaxUsers] = useState<Record<string, string>>({});

  const fetch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getOwnerAdmins(jwt);
      setAdmins(data.admins);
    } catch (err: any) {
      setError(err.message || 'Failed to load partners.');
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleToggleStatus = async (admin: Admin) => {
    const newStatus = admin.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setActionLoading(p => ({ ...p, [admin.id]: true }));
    try {
      await api.patchOwnerAdmin(jwt, admin.id, { status: newStatus });
      await fetch();
    } catch (err: any) {
      setError(err.message || 'Failed to update partner.');
    } finally {
      setActionLoading(p => ({ ...p, [admin.id]: false }));
    }
  };

  const handleUpdateMaxUsers = async (admin: Admin) => {
    const val = parseInt(editMaxUsers[admin.id] ?? String(admin.maxUsers ?? 5), 10);
    if (isNaN(val) || val < 1) return;
    setActionLoading(p => ({ ...p, [`mu_${admin.id}`]: true }));
    try {
      await api.patchOwnerAdmin(jwt, admin.id, { maxUsers: val });
      setEditMaxUsers(p => { const n = { ...p }; delete n[admin.id]; return n; });
      await fetch();
    } catch (err: any) {
      setError(err.message || 'Failed to update limit.');
    } finally {
      setActionLoading(p => ({ ...p, [`mu_${admin.id}`]: false }));
    }
  };

  if (loading) return <div className="p-4 text-gray-500 text-sm">Loading partners…</div>;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-white">Partners</h2>
        <span className="text-xs text-gray-500">{admins.length} partner{admins.length !== 1 ? 's' : ''}</span>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {admins.length === 0 && <p className="text-gray-500 text-sm">No partners yet.</p>}
      {admins.map(admin => (
        <div key={admin.id} className="bg-slate-800 rounded-lg p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-white truncate">{admin.name ?? admin.email}</div>
              {admin.name && <div className="text-xs text-gray-400 truncate">{admin.email}</div>}
              {admin.company && <div className="text-xs text-gray-500">{admin.company}</div>}
              <div className="text-xs text-gray-500 mt-0.5">
                Team: {admin.currentTeamSize}/{admin.maxUsers ?? '∞'} · Joined {new Date(admin.createdAt).toLocaleDateString()}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`text-xs px-1.5 py-0.5 rounded ${admin.status === 'ACTIVE' ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>
                {admin.status}
              </span>
              <button
                onClick={() => setExpandedId(expandedId === admin.id ? null : admin.id)}
                className="text-gray-500 hover:text-gray-300 text-xs"
              >
                {expandedId === admin.id ? '▲' : '▼'}
              </button>
            </div>
          </div>
          {expandedId === admin.id && (
            <div className="pt-2 border-t border-slate-700 space-y-3">
              {admin.description && (
                <p className="text-xs text-gray-400 italic">"{admin.description}"</p>
              )}
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">Max users:</label>
                <input
                  type="number"
                  min={1}
                  value={editMaxUsers[admin.id] ?? (admin.maxUsers ?? 5)}
                  onChange={e => setEditMaxUsers(p => ({ ...p, [admin.id]: e.target.value }))}
                  className="w-16 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={() => handleUpdateMaxUsers(admin)}
                  disabled={actionLoading[`mu_${admin.id}`]}
                  className="px-2 py-1 bg-cyan-700 text-cyan-200 rounded text-xs hover:bg-cyan-600 disabled:opacity-50"
                >
                  {actionLoading[`mu_${admin.id}`] ? '...' : 'Update'}
                </button>
              </div>
              <button
                onClick={() => handleToggleStatus(admin)}
                disabled={actionLoading[admin.id]}
                className={`w-full py-1.5 rounded text-xs font-medium disabled:opacity-50 ${
                  admin.status === 'ACTIVE'
                    ? 'bg-red-900 text-red-300 hover:bg-red-800'
                    : 'bg-green-900 text-green-300 hover:bg-green-800'
                }`}
              >
                {actionLoading[admin.id] ? 'Updating...' : admin.status === 'ACTIVE' ? 'Disable Partner' : 'Re-enable Partner'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
