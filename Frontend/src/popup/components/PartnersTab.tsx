import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';
import { BACKEND_URL } from '../../lib/config';
import type { InviteLink } from '../../types';

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
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
  const [inviteLinksLoading, setInviteLinksLoading] = useState(false);
  const [createRole, setCreateRole] = useState<string>('STAFF');
  const [createExpiry, setCreateExpiry] = useState<number>(168);
  const [createMaxUses, setCreateMaxUses] = useState<number>(1);
  const [creating, setCreating] = useState(false);
  const [lastCreatedUrl, setLastCreatedUrl] = useState<string | null>(null);

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

  const fetchInviteLinks = useCallback(async () => {
    setInviteLinksLoading(true);
    try {
      const data = await api.listOwnerInviteLinks(jwt);
      setInviteLinks(data.invites);
    } catch {
      // silent — non-critical
    } finally {
      setInviteLinksLoading(false);
    }
  }, [jwt]);

  useEffect(() => { fetch(); fetchInviteLinks(); }, [fetch, fetchInviteLinks]);

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

  const handleCreateInviteLink = async () => {
    const expiry = Math.min(720, Math.max(1, createExpiry));
    const uses = Math.min(100, Math.max(1, createMaxUses));
    setCreating(true);
    setLastCreatedUrl(null);
    try {
      const data = await api.createInviteLink(jwt, { roleHint: createRole, expiresInHours: expiry, maxUses: uses });
      const url = `${BACKEND_URL}/api/invite/${data.invite.token ?? ''}`;
      setLastCreatedUrl(url);
      showToast('Invite link created', 'success');
      await fetchInviteLinks();
    } catch (err: any) {
      showToast(err.message || 'Failed to create invite link', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeInviteLink = async (id: string) => {
    try {
      await api.revokeOwnerInviteLink(jwt, id);
      setInviteLinks(prev => prev.filter(l => l.id !== id));
      showToast('Invite link revoked', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to revoke link', 'error');
    }
  };

  const ROLE_BADGE: Record<string, string> = {
    ADMIN: 'bg-emerald-900 text-emerald-300',
    ACCOUNTANT: 'bg-blue-900 text-blue-300',
    STAFF: 'bg-green-900 text-green-300',
    VIEWER: 'bg-gray-700 text-gray-300',
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
                  className="w-16 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => handleUpdateMaxUsers(admin)}
                  disabled={actionLoading[`mu_${admin.id}`]}
                  className="px-2 py-1 bg-emerald-700 text-emerald-200 rounded text-xs hover:bg-emerald-600 disabled:opacity-50"
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

      {/* Invite Links */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-2">
        <h3 className="text-sm font-medium text-emerald-300">Invite Links</h3>

        {/* Creation form */}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {(['STAFF', 'VIEWER', 'ACCOUNTANT', 'ADMIN'] as const).map(role => (
              <button
                key={role}
                onClick={() => setCreateRole(role)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  createRole === role
                    ? `${ROLE_BADGE[role]} border-transparent`
                    : 'bg-transparent text-gray-500 border-slate-600 hover:border-slate-400'
                }`}
              >
                {role}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-0.5">Expires in (hours)</label>
              <input
                type="number"
                value={createExpiry}
                min={1}
                max={720}
                onChange={e => setCreateExpiry(Math.min(720, Math.max(1, Number(e.target.value))))}
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-0.5">Max uses</label>
              <input
                type="number"
                value={createMaxUses}
                min={1}
                max={100}
                onChange={e => setCreateMaxUses(Math.min(100, Math.max(1, Number(e.target.value))))}
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>
          <button
            onClick={handleCreateInviteLink}
            disabled={creating}
            className="w-full text-xs bg-emerald-800 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-1 rounded transition-colors"
          >
            {creating ? 'Creating…' : 'Create Invite Link'}
          </button>
          {lastCreatedUrl && (
            <div className="bg-slate-900 border border-emerald-800 rounded p-2 space-y-1">
              <div className="text-xs text-emerald-300 font-medium">Your new invite link</div>
              <div className="text-xs text-gray-400 break-all">{lastCreatedUrl}</div>
              <button
                onClick={() => navigator.clipboard.writeText(lastCreatedUrl).catch(() => {}).then(() => showToast('Copied', 'success'))}
                className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800 hover:border-emerald-600 px-2 py-0.5 rounded transition-colors"
              >
                Copy
              </button>
            </div>
          )}
        </div>

        {inviteLinksLoading ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : inviteLinks.length === 0 ? (
          <p className="text-xs text-gray-500">No active invite links.</p>
        ) : (
          <div className="space-y-2">
            {inviteLinks.map((link) => {
              const expired = link.expiresAt ? new Date(link.expiresAt) < new Date() : false;
              const inviteUrl = `${BACKEND_URL}/api/invite/${link.token ?? ''}`;
              return (
                <div key={link.id} className="bg-slate-900 border border-slate-700 rounded p-2 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${ROLE_BADGE[link.roleHint] ?? 'bg-gray-700 text-gray-300'}`}>
                      {link.roleHint}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${expired || link.usedAt ? 'bg-red-900 text-red-400' : link.isActive ? 'bg-green-900 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                      {expired ? 'Expired' : link.usedAt ? 'Used' : 'Active'}
                    </span>
                    <span className="text-xs text-gray-500">{link.useCount}/{link.maxUses} uses</span>
                    {link.expiresAt && (
                      <span className="text-xs text-gray-600">Expires {new Date(link.expiresAt).toLocaleDateString()}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {link.token && (
                      <button
                        onClick={() => navigator.clipboard.writeText(inviteUrl).catch(() => {}).then(() => showToast('Invite URL copied', 'success'))}
                        className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800 hover:border-emerald-600 px-2 py-0.5 rounded transition-colors"
                      >
                        Copy URL
                      </button>
                    )}
                    <button
                      onClick={() => handleRevokeInviteLink(link.id)}
                      className="text-xs text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 px-2 py-0.5 rounded transition-colors"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
