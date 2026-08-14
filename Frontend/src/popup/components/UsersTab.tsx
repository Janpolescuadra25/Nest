import React, { useState, useEffect, useCallback } from 'react';
import { api, type OwnerUserUsage } from '../lib/api';
import { hasPerm } from '../lib/permissions';
import { useToast } from './Toast';
import { ConfirmDialog, ErrorCard, StatusBadge, DashboardSkeleton, EmptyState } from './shared';
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
  admin?: {
    subscriptionSource?: string | null;
    currentPlan?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
    paymentIssue?: boolean;
  };
}

interface Props {
  jwt: string;
}

function roleBadge(role: string) {
  if (role === 'ACCOUNTANT') return <span className="text-xs px-1 py-0.5 rounded bg-emerald-50 text-emerald-400">Accountant</span>;
  if (role === 'MANAGER') return <span className="text-xs px-1 py-0.5 rounded bg-indigo-50 text-indigo-600">Manager</span>;
  if (role === 'STAFF') return <span className="text-xs px-1 py-0.5 rounded bg-emerald-50 text-emerald-600">Staff</span>;
  return <span className="text-xs px-1 py-0.5 rounded bg-gray-200 text-gray-600">{role}</span>;
}

function trialBadge(trialExpiresAt: string | null) {
  if (!trialExpiresAt) return null;
  const countdown = trialCountdown(trialExpiresAt);
  if (!countdown) return null;
  const expiry = new Date(trialExpiresAt);
  const now = new Date();
  const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return <span className="text-xs px-1 py-0.5 rounded bg-red-50 text-red-600">Trial expired</span>;
  if (daysLeft <= 7) return <span className="text-xs px-1 py-0.5 rounded bg-amber-50 text-amber-600">{countdown}</span>;
  return <span className="text-xs px-1 py-0.5 rounded bg-emerald-50 text-emerald-600">{countdown}</span>;
}

function permPill(label: string, enabled: boolean) {
  return (
    <span key={label} className={`text-xs px-1.5 py-0.5 rounded ${enabled ? 'bg-emerald-50 text-emerald-400' : 'bg-gray-200 text-gray-600'}`}>
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
  const [resetPermissionsDialog, setResetPermissionsDialog] = useState<{ open: boolean; user: OwnerUser | null }>({ open: false, user: null });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; user: OwnerUser | null }>({ open: false, user: null });
  const [usageByUserId, setUsageByUserId] = useState<Record<string, { loading: boolean; data: OwnerUserUsage | null; error?: string }>>({});
  const [storageLimitEditor, setStorageLimitEditor] = useState<Record<string, { open: boolean; value: string; unit: 'MB' | 'GB'; unlimited: boolean }>>({});

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  };

  const getEditorState = (userId: string) => storageLimitEditor[userId] ?? { open: false, value: '', unit: 'GB', unlimited: false };

  const handleStartEditLimit = (user: OwnerUser) => {
    const currentLimit = usageByUserId[user.id]?.data?.storageLimitBytes ?? null;
    const unit = currentLimit && currentLimit % (1024 * 1024 * 1024) === 0 ? 'GB' : 'MB';
    const value = currentLimit == null ? '' : String(Math.round(currentLimit / (unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024)));
    setStorageLimitEditor((prev) => ({
      ...prev,
      [user.id]: {
        open: true,
        value,
        unit,
        unlimited: currentLimit == null,
      },
    }));
  };

  const handleCancelEditLimit = (userId: string) => {
    setStorageLimitEditor((prev) => ({ ...prev, [userId]: { ...(prev[userId] ?? { open: false, value: '', unit: 'GB', unlimited: false }), open: false } }));
  };

  const handleSaveLimit = async (user: OwnerUser) => {
    const editor = getEditorState(user.id);
    const maxStorageBytes = editor.unlimited
      ? null
      : editor.value
        ? Number(editor.value) * (editor.unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024)
        : null;

    if (!editor.unlimited && (editor.value === '' || Number(editor.value) < 0 || Number.isNaN(Number(editor.value)))) {
      showToast('Enter a valid storage limit', 'error');
      return;
    }

    setActionLoading((p) => ({ ...p, [`limit_${user.id}`]: true }));
    try {
      await api.ownerSetStorageLimit(jwt, user.id, maxStorageBytes);
      showToast('Storage limit updated', 'success');
      setStorageLimitEditor((prev) => ({ ...prev, [user.id]: { ...prev[user.id], open: false } }));
      await loadUsageForUser(user.id);
    } catch (err: any) {
      showToast(err.message || 'Failed to update storage limit', 'error');
    } finally {
      setActionLoading((p) => ({ ...p, [`limit_${user.id}`]: false }));
    }
  };

  const loadUsageForUser = useCallback(async (userId: string) => {
    setUsageByUserId((prev) => ({
      ...prev,
      [userId]: { loading: true, data: prev[userId]?.data ?? null },
    }));

    try {
      const usage = await api.getOwnerUserUsage(jwt, userId);
      setUsageByUserId((prev) => ({
        ...prev,
        [userId]: { loading: false, data: usage },
      }));
    } catch (err: any) {
      setUsageByUserId((prev) => ({
        ...prev,
        [userId]: {
          loading: false,
          data: prev[userId]?.data ?? null,
          error: err.message || 'Failed to load usage',
        },
      }));
    }
  }, [jwt]);

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

  const teamPlan = users.find((u) => u.admin?.subscriptionSource === 'stripe' && u.admin.currentPlan)?.admin?.currentPlan ?? 'free';

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
    setResetPermissionsDialog({ open: true, user });
  };

  const confirmResetCanX = async () => {
    if (!resetPermissionsDialog.user) return;
    const user = resetPermissionsDialog.user;
    setResetPermissionsDialog({ open: false, user: null });
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

  const confirmDeleteUser = async () => {
    if (!deleteDialog.user) return;
    const user = deleteDialog.user;
    setDeleteDialog({ open: false, user: null });
    setActionLoading(p => ({ ...p, [`delete_${user.id}`]: true }));
    try {
      await api.ownerDeleteUser(jwt, user.id);
      showToast('Account deleted permanently', 'success');
      await fetchUsers();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete account', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`delete_${user.id}`]: false }));
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
        <h2 className="text-base font-semibold text-gray-900">Users</h2>
        <button onClick={fetchUsers} className="text-xs text-gray-600 hover:text-gray-600">↻ Refresh</button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="flex-1 px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500"
        >
          <option value="">All roles</option>
          <option value="ACCOUNTANT">Accountant</option>
          <option value="MANAGER">Manager</option>
          <option value="STAFF">Staff</option>
          <option value="VIEWER">Viewer</option>
        </select>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="flex-1 px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="EXPIRED">Expired</option>
          <option value="GRACE_PERIOD">Grace Period</option>
          <option value="PENDING_APPROVAL">Pending</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </div>

      {error && (
        <ErrorCard message={error} onDismiss={() => setError('')} />
      )}
      {teamPlan === 'free' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          Free plan users are limited to a single admin and basic features. Upgrade to a paid plan for team access and higher scan capacity.
        </div>
      )}
      {loading ? (
        <DashboardSkeleton type="list" rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="👤"
          title="No users found"
          description="Adjust your filters or add a user to see results."
        />
      ) : (
        groupEntries.map(([groupKey, group]) => (
          <div key={groupKey} className="space-y-1.5">
            {/* Group header */}
            <button
              onClick={() => setCollapsedAdmins(p => ({ ...p, [groupKey]: !p[groupKey] }))}
              className="w-full flex items-center justify-between px-2 py-1 bg-gray-200 rounded text-left"
            >
              <span className="text-xs text-gray-600 font-medium truncate">{group.label}</span>
              <span className="text-gray-600 text-xs ml-1">{collapsedAdmins[groupKey] ? '▶' : '▾'} {group.users.length}</span>
            </button>

            {!collapsedAdmins[groupKey] && group.users.map(user => (
              <div key={user.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2 ml-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{user.name ?? user.email}</div>
                    {user.name && <div className="text-xs text-gray-600 truncate">{user.email}</div>}
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {roleBadge(user.role)}
                      <StatusBadge status={user.blocked ? 'BLOCKED' : user.status} />
                      {trialBadge(user.trialExpiresAt)}
                    </div>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {permPill('Scan', hasPerm(user, 'scan', 'write'))}
                      {permPill('Map', hasPerm(user, 'map', 'write'))}
                      {permPill('Sync', hasPerm(user, 'sync', 'execute'))}
                      {permPill('Locs', hasPerm(user, 'locations', 'write'))}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const nextId = expandedId === user.id ? null : user.id;
                      setExpandedId(nextId);
                      if (nextId && !usageByUserId[nextId]?.data && !usageByUserId[nextId]?.loading) {
                        void loadUsageForUser(nextId);
                      }
                    }}
                    className="text-gray-600 hover:text-gray-600 text-xs flex-shrink-0"
                  >
                    {expandedId === user.id ? '▲' : '▼'}
                  </button>
                </div>

                {expandedId === user.id && (
                  <div className="pt-2 border-t border-gray-200 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-700">
                      {usageByUserId[user.id]?.loading ? (
                        <div className="col-span-2 text-gray-500">Loading usage...</div>
                      ) : usageByUserId[user.id]?.error ? (
                        <div className="col-span-2 text-red-600">Usage unavailable: {usageByUserId[user.id]?.error}</div>
                      ) : usageByUserId[user.id]?.data ? (
                        <>
                          <div className="rounded-lg bg-gray-50 p-2">
                            <div className="text-[11px] text-gray-500">Storage</div>
                            <div className="text-sm font-semibold text-gray-900">{formatBytes(usageByUserId[user.id]!.data!.totalStorageBytes)}</div>
                          </div>
                          <div className="rounded-lg bg-gray-50 p-2">
                            <div className="text-[11px] text-gray-500">Locations</div>
                            <div className="text-sm font-semibold text-gray-900">{usageByUserId[user.id]!.data!.locationCount}</div>
                          </div>
                          <div className="rounded-lg bg-gray-50 p-2">
                            <div className="text-[11px] text-gray-500">Scans</div>
                            <div className="text-sm font-semibold text-gray-900">{usageByUserId[user.id]!.data!.scanCount}</div>
                          </div>
                          <div className="rounded-lg bg-gray-50 p-2">
                            <div className="text-[11px] text-gray-500">Attachments</div>
                            <div className="text-sm font-semibold text-gray-900">{usageByUserId[user.id]!.data!.attachmentCount}</div>
                          </div>
                          <div className="col-span-2 rounded-lg bg-gray-50 p-3 border border-gray-200">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="text-[11px] text-gray-500">Storage limit</div>
                                <div className="text-sm font-semibold text-gray-900">
                                  {usageByUserId[user.id]!.data!.storageLimitBytes == null ? 'Unlimited' : formatBytes(usageByUserId[user.id]!.data!.storageLimitBytes)}
                                </div>
                              </div>
                              <button
                                onClick={() => handleStartEditLimit(user)}
                                className="text-xs text-blue-600 hover:text-blue-800"
                              >
                                {getEditorState(user.id).open ? 'Close' : 'Set'} limit
                              </button>
                            </div>
                            {getEditorState(user.id).open && (
                              <div className="mt-2 space-y-2">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    id={`unlimited-${user.id}`}
                                    checked={getEditorState(user.id).unlimited}
                                    onChange={(e) => setStorageLimitEditor((prev) => ({
                                      ...prev,
                                      [user.id]: {
                                        ...getEditorState(user.id),
                                        unlimited: e.target.checked,
                                      },
                                    }))}
                                  />
                                  <label htmlFor={`unlimited-${user.id}`} className="text-xs text-gray-600">Unlimited</label>
                                </div>
                                {!getEditorState(user.id).unlimited && (
                                  <div className="grid grid-cols-2 gap-2">
                                    <input
                                      type="number"
                                      min={0}
                                      value={getEditorState(user.id).value}
                                      onChange={(e) => setStorageLimitEditor((prev) => ({
                                        ...prev,
                                        [user.id]: { ...getEditorState(user.id), value: e.target.value },
                                      }))}
                                      className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-xs text-gray-900"
                                      placeholder="Amount"
                                    />
                                    <select
                                      value={getEditorState(user.id).unit}
                                      onChange={(e) => setStorageLimitEditor((prev) => ({
                                        ...prev,
                                        [user.id]: { ...getEditorState(user.id), unit: e.target.value as 'MB' | 'GB' },
                                      }))}
                                      className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-xs text-gray-900"
                                    >
                                      <option value="GB">GB</option>
                                      <option value="MB">MB</option>
                                    </select>
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleSaveLimit(user)}
                                    disabled={actionLoading[`limit_${user.id}`]}
                                    className="px-2 py-1 rounded bg-emerald-600 text-white text-xs font-medium disabled:opacity-50"
                                  >
                                    {actionLoading[`limit_${user.id}`] ? 'Saving…' : 'Save'}
                                  </button>
                                  <button
                                    onClick={() => handleCancelEditLimit(user.id)}
                                    className="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs font-medium"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="col-span-2 text-gray-500">Select this user to load usage details.</div>
                      )}
                    </div>

                    {/* Block / Unblock */}
                    <button
                      onClick={() => handleBlock(user)}
                      disabled={actionLoading[`block_${user.id}`]}
                      className={`w-full py-1.5 rounded text-xs font-medium disabled:opacity-50 ${
                        user.blocked
                          ? 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                          : 'bg-red-50 text-red-600 hover:bg-red-700'
                      }`}
                    >
                      {actionLoading[`block_${user.id}`] ? '…' : user.blocked ? 'Unblock User' : 'Block User'}
                    </button>
                    {user.role === 'ADMIN' && (
                      <button
                        onClick={() => handleResetCanX(user)}
                        disabled={actionLoading[`reset_${user.id}`]}
                        className="w-full py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-600 rounded text-xs font-medium hover:bg-emerald-800 disabled:opacity-50"
                      >
                        {actionLoading[`reset_${user.id}`] ? 'Resetting…' : 'Reset CanX'}
                      </button>
                    )}
                    {user.role !== 'OWNER' && (
                      <button
                        onClick={() => setDeleteDialog({ open: true, user })}
                        disabled={actionLoading[`delete_${user.id}`]}
                        className="w-full py-1.5 rounded text-xs font-medium border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
                      >
                        {actionLoading[`delete_${user.id}`] ? 'Deleting…' : 'Delete Account'}
                      </button>
                    )}

                    {/* Trial reset */}
                    <div className="pt-2 border-t border-gray-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-600 font-medium">Trial Period</p>
                        <button
                          onClick={() => setTrialEnabled(p => ({ ...p, [user.id]: !p[user.id] }))}
                          className={`px-2 py-0.5 rounded text-xs font-medium ${trialEnabled[user.id] ? 'bg-amber-600 text-amber-600' : 'bg-gray-200 text-gray-600'}`}
                        >
                          {trialEnabled[user.id] ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>
                      {trialEnabled[user.id] && (
                        <div>
                          <label className="block text-xs text-gray-600 mb-0.5">Expiry date</label>
                          <input
                            type="date"
                            aria-label="Trial expiry date"
                            value={trialDate[user.id] ?? (user.trialExpiresAt ? user.trialExpiresAt.split('T')[0] : '')}
                            onChange={e => setTrialDate(p => ({ ...p, [user.id]: e.target.value }))}
                            className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      )}
                      <button
                        onClick={() => handleTrialSave(user)}
                        disabled={actionLoading[`trial_${user.id}`]}
                        className="w-full py-1.5 bg-gray-200 text-gray-600 rounded text-xs font-medium hover:bg-gray-300 disabled:opacity-50"
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
      <ConfirmDialog
        open={resetPermissionsDialog.open}
        title="Reset Permissions"
        message={`Reset ${resetPermissionsDialog.user?.name ?? resetPermissionsDialog.user?.email}'s operational permissions to role defaults?`}
        confirmText="Reset"
        cancelText="Cancel"
        onConfirm={confirmResetCanX}
        onCancel={() => setResetPermissionsDialog({ open: false, user: null })}
        variant="default"
      />
      <ConfirmDialog
        open={deleteDialog.open}
        title="Delete Account Permanently"
        message={`Are you sure you want to permanently delete ${deleteDialog.user?.name || deleteDialog.user?.email}? All their data, scans, and attachments will be destroyed. This cannot be undone.`}
        confirmText="Delete Permanently"
        cancelText="Cancel"
        onConfirm={confirmDeleteUser}
        onCancel={() => setDeleteDialog({ open: false, user: null })}
        variant="danger"
      />
    </div>
  );
}
