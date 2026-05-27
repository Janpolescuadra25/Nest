import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';

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

interface TeamMemberSummary {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
}

interface Props {
  jwt: string;
}

export default function PartnersTab({ jwt }: Props) {
  const { showToast } = useToast();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editMaxUsers, setEditMaxUsers] = useState<Record<string, string>>({});
  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMemberSummary[]>>({});
  const [teamLoading, setTeamLoading] = useState<Record<string, boolean>>({});
  const [teamError, setTeamError] = useState<Record<string, string>>({});

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

  const handleToggleExpand = useCallback(async (adminId: string) => {
    const isOpening = expandedId !== adminId;
    setExpandedId(isOpening ? adminId : null);
    if (isOpening && teamMembers[adminId] === undefined) {
      setTeamLoading(p => ({ ...p, [adminId]: true }));
      setTeamError(p => ({ ...p, [adminId]: '' }));
      try {
        const data = await api.getOwnerAdminTeam(jwt, adminId);
        setTeamMembers(p => ({ ...p, [adminId]: data.users }));
      } catch {
        setTeamError(p => ({ ...p, [adminId]: 'Could not load team members.' }));
      } finally {
        setTeamLoading(p => ({ ...p, [adminId]: false }));
      }
    }
  }, [expandedId, teamMembers, jwt]);

  const handleToggleStatus = async (admin: Admin) => {
    const newStatus = admin.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setActionLoading(p => ({ ...p, [admin.id]: true }));
    try {
      await api.patchOwnerAdmin(jwt, admin.id, { status: newStatus });
      await fetch();
      showToast(newStatus === 'DISABLED' ? 'Admin disabled' : 'Admin updated', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to update partner.');
      showToast('Update failed', 'error');
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
      showToast('Admin updated', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to update limit.');
      showToast('Update failed', 'error');
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
                onClick={() => handleToggleExpand(admin.id)}
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
                  {actionLoading[`mu_${admin.id}`] ? 'Saving...' : 'Update'}
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

              {/* Team members */}
              <div className="pt-2 border-t border-slate-700">
                <p className="text-xs text-gray-500 mb-1.5">Team Members</p>
                {teamLoading[admin.id] ? (
                  <p className="text-xs text-gray-500">Loading…</p>
                ) : teamError[admin.id] ? (
                  <p className="text-xs text-red-400">{teamError[admin.id]}</p>
                ) : (teamMembers[admin.id] ?? []).length === 0 ? (
                  <p className="text-xs text-gray-500">No team members yet.</p>
                ) : (
                  <div className="space-y-1">
                    {(teamMembers[admin.id] ?? []).map(m => (
                      <div key={m.id} className="flex items-center justify-between gap-2 bg-slate-900 rounded px-2 py-1">
                        <div className="min-w-0">
                          <span className="text-xs text-white truncate">{m.name ?? m.email}</span>
                          {m.name && <span className="text-xs text-gray-500 ml-1 truncate">({m.email})</span>}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-xs text-gray-500">{m.role}</span>
                          <span className={`text-xs px-1 py-0.5 rounded ${m.status === 'ACTIVE' ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>
                            {m.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
