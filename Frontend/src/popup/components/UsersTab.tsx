import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { hasPerm } from '../lib/permissions';
import { useToast } from './Toast';
import { trialCountdown } from '../lib/utils';

interface OwnerUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  adminId: string | null;
  adminName: string | null;
  adminEmail: string | null;
  blocked: boolean;
  trialExpiresAt: string | null;
  customExpiryMessage: string | null;
  permissions?: Record<string, boolean> | null;
  createdAt: string;
}

interface Props {
  jwt: string;
}

function statusBadge(status: string, blocked: boolean) {
  if (blocked) return <span className="text-xs px-1 py-0.5 rounded bg-red-900 text-red-400">Blocked</span>;
  if (status === 'ACTIVE') return <span className="text-xs px-1 py-0.5 rounded bg-green-900 text-green-400">Active</span>;
  if (status === 'EXPIRED') return <span className="text-xs px-1 py-0.5 rounded bg-yellow-900 text-yellow-400">Expired</span>;
  if (status === 'GRACE_PERIOD') return <span className="text-xs px-1 py-0.5 rounded bg-yellow-900 text-yellow-400">Grace</span>;
  if (status === 'PENDING_APPROVAL') return <span className="text-xs px-1 py-0.5 rounded bg-orange-900 text-orange-400">Pending</span>;
  if (status === 'DISABLED') return <span className="text-xs px-1 py-0.5 rounded bg-red-900 text-red-400">Disabled</span>;
  return <span className="text-xs px-1 py-0.5 rounded bg-gray-700 text-gray-400">{status}</span>;
}

function roleBadge(role: string) {
  if (role === 'ACCOUNTANT') return <span className="text-xs px-1 py-0.5 rounded bg-cyan-900 text-cyan-400">Accountant</span>;
  if (role === 'STAFF') return <span className="text-xs px-1 py-0.5 rounded bg-green-900 text-green-400">Staff</span>;
  return <span className="text-xs px-1 py-0.5 rounded bg-slate-700 text-gray-400">{role}</span>;
}

function trialBadge(trialExpiresAt: string | null) {
  if (!trialExpiresAt) return null;
  const countdown = trialCountdown(trialExpiresAt);
  if (!countdown) return null;
  const expiry = new Date(trialExpiresAt);
  const now = new Date();
  const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return <span className="text-xs px-1 py-0.5 rounded bg-red-900 text-red-400">Trial expired</span>;
  if (daysLeft <= 7) return <span className="text-xs px-1 py-0.5 rounded bg-yellow-900 text-yellow-400">{countdown}</span>;
  return <span className="text-xs px-1 py-0.5 rounded bg-green-900 text-green-400">{countdown}</span>;
}

function permPill(label: string, enabled: boolean) {
  return (
    <span key={label} className={`text-xs px-1.5 py-0.5 rounded ${enabled ? 'bg-cyan-900 text-cyan-400' : 'bg-slate-700 text-gray-500'}`}>
      {label}
    </span>
  );
}

export default function UsersTab({ jwt }: Props) {
  const { showToast } = useToast();
  const [users, setUsers] = useState<OwnerUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [trialDate, setTrialDate] = useState<Record<string, string>>({});
  const [trialEnabled, setTrialEnabled] = useState<Record<string, boolean>>({});
  const [collapsedAdmins, setCollapsedAdmins] = useState<Record<string, boolean>>({});

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getOwnerUsers(jwt);
      setUsers(data.users);
    } catch (err: any) {
      setError(err.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const filtered = users.filter(u => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (statusFilter && u.status !== statusFilter) return false;
    return true;
  });

  // Group by adminEmail (or "Unassigned")
  const groups: Record<string, { label: string; users: OwnerUser[] }> = {};
  for (const u of filtered) {
    const key = u.adminId ?? '__none__';
    if (!groups[key]) {
      groups[key] = {
        label: u.adminEmail ? `${u.adminEmail}${u.adminName ? ` (${u.adminName})` : ''}` : 'Unassigned',
        users: [],
      };
    }
    groups[key].users.push(u);
  }
  const groupEntries = Object.entries(groups);

  const handleBlock = async (user: OwnerUser) => {
    const newBlocked = !user.blocked;
    setActionLoading(p => ({ ...p, [`block_${user.id}`]: true }));
    try {
      await api.blockOwnerUser(jwt, user.id, newBlocked);
      showToast(newBlocked ? 'User blocked' : 'User unblocked', 'success');
      await fetchUsers();
    } catch (err: any) {
      showToast(err.message || 'Failed to update user', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`block_${user.id}`]: false }));
    }
  };

  const handleResetCanX = async (user: OwnerUser) => {
    if (!window.confirm(`Reset ${user.name ?? user.email}'s operational permissions to role defaults?`)) {
      return;
    }
    setActionLoading(p => ({ ...p, [`reset_${user.id}`]: true }));
    try {
      await api.ownerResetPermissions(jwt, user.id);
      showToast('Permissions reset to role defaults', 'success');
      await fetchUsers();
    } catch (err: any) {
      showToast(err.message || 'Failed to reset permissions', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`reset_${user.id}`]: false }));
    }
  };

  const handleTrialSave = async (user: OwnerUser) => {
    setActionLoading(p => ({ ...p, [`trial_${user.id}`]: true }));
    try {
      const dateVal = trialDate[user.id] ?? '';
      if (trialEnabled[user.id]) {
        if (!dateVal) { showToast('Enter a trial expiry date', 'error'); return; }
        await api.ownerResetTrial(jwt, user.id, { trialExpiresAt: new Date(dateVal).toISOString() });
        showToast('Trial expiry updated', 'success');
      } else {
        // Reactivate — status=ACTIVE clears trial
        await api.ownerResetTrial(jwt, user.id, { status: 'ACTIVE' });
        showToast('Trial cleared — user reactivated', 'success');
      }
      await fetchUsers();
    } catch (err: any) {
      showToast(err.message || 'Failed to set trial', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`trial_${user.id}`]: false }));
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-white">Users</h2>
        <button onClick={fetchUsers} className="text-xs text-gray-500 hover:text-gray-300">↻ Refresh</button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="flex-1 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-cyan-500"
        >
          <option value="">All roles</option>
          <option value="ACCOUNTANT">Accountant</option>
          <option value="STAFF">Staff</option>
          <option value="VIEWER">Viewer</option>
        </select>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="flex-1 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-cyan-500"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="EXPIRED">Expired</option>
          <option value="GRACE_PERIOD">Grace Period</option>
          <option value="PENDING_APPROVAL">Pending</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500 text-sm">No users found.</p>
      ) : (
        groupEntries.map(([groupKey, group]) => (
          <div key={groupKey} className="space-y-1.5">
            {/* Group header */}
            <button
              onClick={() => setCollapsedAdmins(p => ({ ...p, [groupKey]: !p[groupKey] }))}
              className="w-full flex items-center justify-between px-2 py-1 bg-slate-700 rounded text-left"
            >
              <span className="text-xs text-gray-400 font-medium truncate">{group.label}</span>
              <span className="text-gray-500 text-xs ml-1">{collapsedAdmins[groupKey] ? '▶' : '▾'} {group.users.length}</span>
            </button>

            {!collapsedAdmins[groupKey] && group.users.map(user => (
              <div key={user.id} className="bg-slate-800 rounded-lg p-3 space-y-2 ml-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{user.name ?? user.email}</div>
                    {user.name && <div className="text-xs text-gray-400 truncate">{user.email}</div>}
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {roleBadge(user.role)}
                      {statusBadge(user.status, user.blocked)}
                      {trialBadge(user.trialExpiresAt)}
                    </div>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {permPill('Scan', hasPerm(user, 'scan', 'write'))}
                      {permPill('Map', hasPerm(user, 'map', 'write'))}
                      {permPill('Sync', hasPerm(user, 'sync', 'execute'))}
                      {permPill('Locs', hasPerm(user, 'locations', 'write'))}
                    </div>
                  </div>
                  <button onClick={() => setExpandedId(expandedId === user.id ? null : user.id)} className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0">
                    {expandedId === user.id ? '▲' : '▼'}
                  </button>
                </div>

                {expandedId === user.id && (
                  <div className="pt-2 border-t border-slate-700 space-y-2">
                    {/* Block / Unblock */}
                    <button
                      onClick={() => handleBlock(user)}
                      disabled={actionLoading[`block_${user.id}`]}
                      className={`w-full py-1.5 rounded text-xs font-medium disabled:opacity-50 ${
                        user.blocked
                          ? 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                          : 'bg-red-900 text-red-300 hover:bg-red-800'
                      }`}
                    >
                      {actionLoading[`block_${user.id}`] ? '…' : user.blocked ? 'Unblock User' : 'Block User'}
                    </button>
                    {user.role === 'ADMIN' && (
                      <button
                        onClick={() => handleResetCanX(user)}
                        disabled={actionLoading[`reset_${user.id}`]}
                        className="w-full py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-300 rounded text-xs font-medium hover:bg-cyan-800 disabled:opacity-50"
                      >
                        {actionLoading[`reset_${user.id}`] ? 'Resetting…' : 'Reset CanX'}
                      </button>
                    )}

                    {/* Trial reset */}
                    <div className="pt-2 border-t border-slate-700 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-400 font-medium">Trial Period</p>
                        <button
                          onClick={() => setTrialEnabled(p => ({ ...p, [user.id]: !p[user.id] }))}
                          className={`px-2 py-0.5 rounded text-xs font-medium ${trialEnabled[user.id] ? 'bg-yellow-800 text-yellow-300' : 'bg-slate-700 text-gray-500'}`}
                        >
                          {trialEnabled[user.id] ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>
                      {trialEnabled[user.id] && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">Expiry date</label>
                          <input
                            type="date"
                            aria-label="Trial expiry date"
                            value={trialDate[user.id] ?? (user.trialExpiresAt ? user.trialExpiresAt.split('T')[0] : '')}
                            onChange={e => setTrialDate(p => ({ ...p, [user.id]: e.target.value }))}
                            className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      )}
                      <button
                        onClick={() => handleTrialSave(user)}
                        disabled={actionLoading[`trial_${user.id}`]}
                        className="w-full py-1.5 bg-slate-700 text-gray-300 rounded text-xs font-medium hover:bg-slate-600 disabled:opacity-50"
                      >
                        {actionLoading[`trial_${user.id}`] ? 'Saving...' : 'Save Trial Settings'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
