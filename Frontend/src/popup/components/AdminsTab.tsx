import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';

interface Admin {
  id: string;
  email: string;
  name: string | null;
  maxUsers: number | null;
  status: string;
  currentTeamSize: number;
  description: string | null;
  company: string | null;
}

interface TeamMemberRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  permissions?: Record<string, boolean> | null;
}

interface Props {
  jwt: string;
}

function statusBadge(status: string) {
  if (status === 'ACTIVE') return <span className="text-xs px-1 py-0.5 rounded bg-green-900 text-green-400">Active</span>;
  if (status === 'DISABLED') return <span className="text-xs px-1 py-0.5 rounded bg-red-900 text-red-400">Disabled</span>;
  if (status === 'EXPIRED') return <span className="text-xs px-1 py-0.5 rounded bg-yellow-900 text-yellow-400">Expired</span>;
  return <span className="text-xs px-1 py-0.5 rounded bg-gray-700 text-gray-400">{status}</span>;
}

export default function AdminsTab({ jwt }: Props) {
  const { showToast } = useToast();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [teamMap, setTeamMap] = useState<Record<string, TeamMemberRow[]>>({});
  const [teamLoading, setTeamLoading] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [editMaxUsers, setEditMaxUsers] = useState<Record<string, string>>({});
  const [showEditMaxUsers, setShowEditMaxUsers] = useState<Record<string, boolean>>({});

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getOwnerAdmins(jwt);
      setAdmins(data.admins);
    } catch (err: any) {
      setError(err.message || 'Failed to load admins.');
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  useEffect(() => { fetchAdmins(); }, [fetchAdmins]);

  const handleExpand = async (admin: Admin) => {
    const isOpening = expandedId !== admin.id;
    setExpandedId(isOpening ? admin.id : null);
    if (isOpening && !teamMap[admin.id]) {
      setTeamLoading(p => ({ ...p, [admin.id]: true }));
      try {
        const data = await api.getOwnerAdminTeam(jwt, admin.id);
        setTeamMap(p => ({ ...p, [admin.id]: data.users as TeamMemberRow[] }));
      } catch {
        // non-critical — show empty
      } finally {
        setTeamLoading(p => ({ ...p, [admin.id]: false }));
      }
    }
  };

  const handleToggleStatus = async (admin: Admin) => {
    const newStatus = admin.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED';
    setActionLoading(p => ({ ...p, [`status_${admin.id}`]: true }));
    try {
      await api.patchOwnerAdmin(jwt, admin.id, { status: newStatus });
      showToast(`Admin ${newStatus === 'ACTIVE' ? 'enabled' : 'disabled'}`, 'success');
      await fetchAdmins();
      // Clear cached team since status cascade may have changed members
      setTeamMap(p => { const n = { ...p }; delete n[admin.id]; return n; });
    } catch (err: any) {
      showToast(err.message || 'Failed to update admin', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`status_${admin.id}`]: false }));
    }
  };

  const handleSaveMaxUsers = async (admin: Admin) => {
    const val = parseInt(editMaxUsers[admin.id] ?? '', 10);
    if (isNaN(val) || val < 1) { showToast('Enter a valid number', 'error'); return; }
    setActionLoading(p => ({ ...p, [`maxu_${admin.id}`]: true }));
    try {
      await api.patchOwnerAdmin(jwt, admin.id, { maxUsers: val });
      showToast('Limit updated', 'success');
      setShowEditMaxUsers(p => ({ ...p, [admin.id]: false }));
      await fetchAdmins();
    } catch (err: any) {
      showToast(err.message || 'Failed to update limit', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`maxu_${admin.id}`]: false }));
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-white">Admins</h2>
        <button onClick={fetchAdmins} className="text-xs text-gray-500 hover:text-gray-300">↻ Refresh</button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : admins.length === 0 ? (
        <p className="text-gray-500 text-sm">No admins found.</p>
      ) : (
        admins.map(admin => (
          <div key={admin.id} className="bg-slate-800 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">{admin.name ?? admin.email}</div>
                {admin.name && <div className="text-xs text-gray-400 truncate">{admin.email}</div>}
                {admin.company && <div className="text-xs text-gray-500 truncate">{admin.company}</div>}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {statusBadge(admin.status)}
                  <span className="text-xs text-gray-500">
                    {admin.currentTeamSize}/{admin.maxUsers ?? '∞'} members
                  </span>
                </div>
              </div>
              <button onClick={() => handleExpand(admin)} className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0">
                {expandedId === admin.id ? '▲' : '▼'}
              </button>
            </div>

            {expandedId === admin.id && (
              <div className="pt-2 border-t border-slate-700 space-y-3">
                {/* maxUsers edit */}
                <div>
                  <p className="text-xs text-gray-500 mb-1">Member limit</p>
                  {showEditMaxUsers[admin.id] ? (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={editMaxUsers[admin.id] ?? String(admin.maxUsers ?? '')}
                        onChange={e => setEditMaxUsers(p => ({ ...p, [admin.id]: e.target.value }))}
                        className="flex-1 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-cyan-500"
                        placeholder="e.g. 10"
                      />
                      <button
                        onClick={() => handleSaveMaxUsers(admin)}
                        disabled={actionLoading[`maxu_${admin.id}`]}
                        className="px-3 py-1 bg-cyan-700 text-cyan-200 rounded text-xs hover:bg-cyan-600 disabled:opacity-50"
                      >
                        {actionLoading[`maxu_${admin.id}`] ? '…' : 'Save'}
                      </button>
                      <button
                        onClick={() => setShowEditMaxUsers(p => ({ ...p, [admin.id]: false }))}
                        className="px-2 py-1 bg-slate-700 text-gray-400 rounded text-xs hover:bg-slate-600"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setEditMaxUsers(p => ({ ...p, [admin.id]: String(admin.maxUsers ?? '') }));
                        setShowEditMaxUsers(p => ({ ...p, [admin.id]: true }));
                      }}
                      className="text-xs px-2 py-1 bg-slate-700 text-gray-300 rounded hover:bg-slate-600"
                    >
                      Edit limit ({admin.maxUsers ?? 'Unlimited'})
                    </button>
                  )}
                </div>

                {/* Block / Unblock */}
                <button
                  onClick={() => handleToggleStatus(admin)}
                  disabled={actionLoading[`status_${admin.id}`]}
                  className={`w-full py-1.5 rounded text-xs font-medium disabled:opacity-50 ${
                    admin.status === 'DISABLED'
                      ? 'bg-green-900 text-green-300 hover:bg-green-800'
                      : 'bg-red-900 text-red-300 hover:bg-red-800'
                  }`}
                >
                  {actionLoading[`status_${admin.id}`] ? '…' : admin.status === 'DISABLED' ? 'Enable Admin' : 'Disable Admin'}
                </button>

                {/* Team members */}
                <div>
                  <p className="text-xs text-gray-500 mb-1">Team members</p>
                  {teamLoading[admin.id] ? (
                    <p className="text-xs text-gray-500">Loading…</p>
                  ) : (teamMap[admin.id] ?? []).length === 0 ? (
                    <p className="text-xs text-gray-500">No team members.</p>
                  ) : (
                    <div className="space-y-1">
                      {(teamMap[admin.id] ?? []).map(m => (
                        <div key={m.id} className="flex items-center justify-between bg-slate-700 rounded px-2 py-1.5">
                          <div className="min-w-0">
                            <div className="text-xs text-white truncate">{m.name ?? m.email}</div>
                            {m.name && <div className="text-xs text-gray-500 truncate">{m.email}</div>}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                            <span className="text-xs text-gray-500">{m.role}</span>
                            {statusBadge(m.status)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
