import React, { useState, useEffect, useCallback } from 'react';
import { api, type OwnerAdminPool, type OwnerAdminMember } from '../lib/api';
import { useToast } from './Toast';
import { ErrorCard, StatusBadge, DashboardSkeleton, EmptyState } from './shared';

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

interface Props {
  jwt: string;
}

export default function AdminsTab({ jwt }: Props) {
  const { showToast } = useToast();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [poolData, setPoolData] = useState<Record<string, OwnerAdminPool>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [memberMap, setMemberMap] = useState<Record<string, OwnerAdminMember[]>>({});
  const [poolStats, setPoolStats] = useState<Record<string, { poolScans: number | null; poolLocations: number | null; maxMembers: number | null; memberCount: number; remainingScans: number; remainingLocations: number }>>({});
  const [teamLoading, setTeamLoading] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [editMaxUsers, setEditMaxUsers] = useState<Record<string, string>>({});
  const [showEditMaxUsers, setShowEditMaxUsers] = useState<Record<string, boolean>>({});
  const [showEditPool, setShowEditPool] = useState<Record<string, boolean>>({});
  const [editPoolValues, setEditPoolValues] = useState<Record<string, { poolScans: string; poolLocations: string; maxMembers: string }>>({});
  const [showEditAllocation, setShowEditAllocation] = useState<Record<string, boolean>>({});
  const [editAllocationValues, setEditAllocationValues] = useState<Record<string, { allocatedScans: string; allocatedLocations: string }>>({});

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [adminRes, poolRes] = await Promise.all([
        api.getOwnerAdmins(jwt),
        api.getOwnerAdminPools(jwt),
      ]);
      setAdmins(adminRes.admins);
      const poolMap: Record<string, OwnerAdminPool> = {};
      poolRes.admins.forEach((admin) => {
        poolMap[admin.id] = admin;
      });
      setPoolData(poolMap);
    } catch (err: any) {
      setError(err.message || 'Failed to load admins.');
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  useEffect(() => { fetchAdmins(); }, [fetchAdmins]);

  const loadAdminMembers = async (adminId: string) => {
    setTeamLoading(p => ({ ...p, [adminId]: true }));
    try {
      const data = await api.getOwnerAdminMembers(jwt, adminId);
      setMemberMap(p => ({ ...p, [adminId]: data.members }));
      setPoolStats(p => ({ ...p, [adminId]: data.admin }));
    } catch {
      // non-critical — show empty
    } finally {
      setTeamLoading(p => ({ ...p, [adminId]: false }));
    }
  };

  const handleExpand = async (admin: Admin) => {
    const isOpening = expandedId !== admin.id;
    setExpandedId(isOpening ? admin.id : null);
    if (isOpening && !memberMap[admin.id]) {
      await loadAdminMembers(admin.id);
    }
  };

  const handleToggleStatus = async (admin: Admin) => {
    const newStatus = admin.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED';
    setActionLoading(p => ({ ...p, [`status_${admin.id}`]: true }));
    try {
      await api.patchOwnerAdmin(jwt, admin.id, { status: newStatus });
      showToast(`Admin ${newStatus === 'ACTIVE' ? 'enabled' : 'disabled'}`, 'success');
      await fetchAdmins();
      setMemberMap(p => { const n = { ...p }; delete n[admin.id]; return n; });
      setPoolStats(p => { const n = { ...p }; delete n[admin.id]; return n; });
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

  const handleSavePool = async (admin: Admin) => {
    const values = editPoolValues[admin.id] ?? {
      poolScans: String(poolData[admin.id]?.poolScans ?? 200),
      poolLocations: String(poolData[admin.id]?.poolLocations ?? 50),
      maxMembers: String(poolData[admin.id]?.maxMembers ?? 5),
    };
    const poolScans = parseInt(values.poolScans, 10) || 200;
    const poolLocations = parseInt(values.poolLocations, 10) || 50;
    const maxMembers = parseInt(values.maxMembers, 10) || 5;
    setActionLoading(p => ({ ...p, [`pool_${admin.id}`]: true }));
    try {
      await api.updateOwnerAdminPool(jwt, admin.id, { poolScans, poolLocations, maxMembers });
      showToast('Pool settings updated', 'success');
      setShowEditPool(p => ({ ...p, [admin.id]: false }));
      await fetchAdmins();
      if (expandedId === admin.id) {
        await loadAdminMembers(admin.id);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to save pool settings', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`pool_${admin.id}`]: false }));
    }
  };

  const handleSaveAllocation = async (admin: Admin, member: OwnerAdminMember) => {
    const values = editAllocationValues[member.id] ?? {
      allocatedScans: String(member.allocatedScans ?? 0),
      allocatedLocations: String(member.allocatedLocations ?? 0),
    };
    const allocatedScans = parseInt(values.allocatedScans, 10);
    const allocatedLocations = parseInt(values.allocatedLocations, 10);
    if (isNaN(allocatedScans) || allocatedScans < 0 || isNaN(allocatedLocations) || allocatedLocations < 0) {
      showToast('Enter valid allocation numbers', 'error');
      return;
    }
    const currentScans = member.allocatedScans ?? 0;
    const currentLocations = member.allocatedLocations ?? 0;
    const remainingScans = poolStats[admin.id]?.remainingScans ?? 0;
    const remainingLocations = poolStats[admin.id]?.remainingLocations ?? 0;
    const maxAllowedScans = currentScans + remainingScans;
    const maxAllowedLocations = currentLocations + remainingLocations;
    if (allocatedScans > maxAllowedScans) {
      showToast(`Scans cannot exceed ${maxAllowedScans}`, 'error');
      return;
    }
    if (allocatedLocations > maxAllowedLocations) {
      showToast(`Locations cannot exceed ${maxAllowedLocations}`, 'error');
      return;
    }
    setActionLoading(p => ({ ...p, [`alloc_${member.id}`]: true }));
    try {
      await api.updateOwnerMemberAllocation(jwt, admin.id, member.id, { allocatedScans, allocatedLocations });
      showToast('Allocation updated', 'success');
      setShowEditAllocation(p => ({ ...p, [member.id]: false }));
      await loadAdminMembers(admin.id);
    } catch (err: any) {
      showToast(err.message || 'Failed to save allocation', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`alloc_${member.id}`]: false }));
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-white">Admins</h2>
        <button onClick={fetchAdmins} className="text-xs text-gray-500 hover:text-gray-300">↻ Refresh</button>
      </div>

      {error && (
        <ErrorCard message={error} onDismiss={() => setError('')} />
      )}
      {loading ? (
        <DashboardSkeleton type="list" rows={4} />
      ) : admins.length === 0 ? (
        <EmptyState
          icon="👤"
          title="No admins found"
          description="Add an admin to start managing teams."
        />
      ) : (
        admins.map(admin => (
          <div key={admin.id} className="bg-slate-800 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">{admin.name ?? admin.email}</div>
                {admin.name && <div className="text-xs text-gray-400 truncate">{admin.email}</div>}
                {admin.company && <div className="text-xs text-gray-500 truncate">{admin.company}</div>}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <StatusBadge status={admin.status} />
                  <span className="text-xs text-gray-500">
                    {admin.currentTeamSize}/{admin.maxUsers ?? '∞'} members
                  </span>
                </div>
                {poolData[admin.id]?.poolScans != null && (
                  <div className="text-xs text-gray-400 mt-1">
                    Pool: {poolData[admin.id].poolScans} scans · {poolData[admin.id].poolLocations} locations · max {poolData[admin.id].maxMembers ?? '∞'} members
                  </div>
                )}
              </div>
              <button onClick={() => handleExpand(admin)} className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0">
                {expandedId === admin.id ? '▲' : '▼'}
              </button>
            </div>

            {expandedId === admin.id && (
              <div className="pt-2 border-t border-slate-700 space-y-3">
                {poolData[admin.id]?.poolScans != null && (
                  <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-gray-300">Pool Settings</p>
                        <p className="text-xs text-gray-400">{poolData[admin.id].poolScans} scans · {poolData[admin.id].poolLocations} locations · max {poolData[admin.id].maxMembers ?? '∞'} members</p>
                      </div>
                      <button
                        onClick={() => {
                          setEditPoolValues(p => ({
                            ...p,
                            [admin.id]: {
                              poolScans: String(poolData[admin.id]?.poolScans ?? 200),
                              poolLocations: String(poolData[admin.id]?.poolLocations ?? 50),
                              maxMembers: String(poolData[admin.id]?.maxMembers ?? 5),
                            },
                          }));
                          setShowEditPool(p => ({ ...p, [admin.id]: !p[admin.id] }));
                        }}
                        className="text-xs px-2 py-1 bg-slate-700 text-gray-300 rounded hover:bg-slate-600"
                      >
                        {showEditPool[admin.id] ? 'Cancel' : 'Edit pool'}
                      </button>
                    </div>
                    {showEditPool[admin.id] && (
                      <div className="space-y-2">
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Scans</p>
                            <input
                              type="number"
                              min={0}
                              value={editPoolValues[admin.id]?.poolScans ?? '200'}
                              onChange={e => setEditPoolValues(p => ({ ...p, [admin.id]: { ...(p[admin.id] ?? { poolLocations: '50', maxMembers: '5' }), poolScans: e.target.value } }))}
                              className="bg-slate-700 border border-slate-600 rounded text-xs text-white p-1.5 w-full"
                            />
                          </div>
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Locations</p>
                            <input
                              type="number"
                              min={0}
                              value={editPoolValues[admin.id]?.poolLocations ?? '50'}
                              onChange={e => setEditPoolValues(p => ({ ...p, [admin.id]: { ...(p[admin.id] ?? { poolScans: '200', maxMembers: '5' }), poolLocations: e.target.value } }))}
                              className="bg-slate-700 border border-slate-600 rounded text-xs text-white p-1.5 w-full"
                            />
                          </div>
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Members</p>
                            <input
                              type="number"
                              min={0}
                              value={editPoolValues[admin.id]?.maxMembers ?? '5'}
                              onChange={e => setEditPoolValues(p => ({ ...p, [admin.id]: { ...(p[admin.id] ?? { poolScans: '200', poolLocations: '50' }), maxMembers: e.target.value } }))}
                              className="bg-slate-700 border border-slate-600 rounded text-xs text-white p-1.5 w-full"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSavePool(admin)}
                            disabled={actionLoading[`pool_${admin.id}`]}
                            className="flex-1 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-xs rounded disabled:opacity-50"
                          >
                            Save pool
                          </button>
                          <button
                            onClick={() => setShowEditPool(p => ({ ...p, [admin.id]: false }))}
                            className="flex-1 py-1.5 bg-slate-600 hover:bg-slate-500 text-white text-xs rounded"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

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
                  ) : (memberMap[admin.id] ?? []).length === 0 ? (
                    <p className="text-xs text-gray-500">No team members.</p>
                  ) : (
                    <div className="space-y-2">
                      {memberMap[admin.id].map(member => (
                        <div key={member.id} className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs text-white truncate">{member.name ?? member.email}</div>
                              {member.name && <div className="text-xs text-gray-500 truncate">{member.email}</div>}
                              <div className="text-xs text-gray-400">{member.role}</div>
                            </div>
                            {showEditAllocation[member.id] ? (
                              <button
                                onClick={() => setShowEditAllocation(p => ({ ...p, [member.id]: false }))}
                                className="text-xs px-2 py-1 bg-slate-700 text-gray-300 rounded hover:bg-slate-600"
                              >
                                Cancel
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditAllocationValues(p => ({
                                    ...p,
                                    [member.id]: {
                                      allocatedScans: String(member.allocatedScans ?? 0),
                                      allocatedLocations: String(member.allocatedLocations ?? 0),
                                    },
                                  }));
                                  setShowEditAllocation(p => ({ ...p, [member.id]: true }));
                                }}
                                className="text-xs px-2 py-1 bg-slate-700 text-gray-300 rounded hover:bg-slate-600"
                              >
                                Edit
                              </button>
                            )}
                          </div>
                          {showEditAllocation[member.id] ? (
                            <div className="mt-3 space-y-2">
                              <div className="grid gap-2 sm:grid-cols-2">
                                <div>
                                  <p className="text-xs text-gray-400 mb-1">Scans</p>
                                  <input
                                    type="number"
                                    min={0}
                                    value={editAllocationValues[member.id]?.allocatedScans ?? '0'}
                                    onChange={e => setEditAllocationValues(p => ({ ...p, [member.id]: { ...(p[member.id] ?? { allocatedLocations: '0' }), allocatedScans: e.target.value } }))}
                                    className="bg-slate-700 border border-slate-600 rounded text-xs text-white p-1.5 w-full"
                                  />
                                </div>
                                <div>
                                  <p className="text-xs text-gray-400 mb-1">Locations</p>
                                  <input
                                    type="number"
                                    min={0}
                                    value={editAllocationValues[member.id]?.allocatedLocations ?? '0'}
                                    onChange={e => setEditAllocationValues(p => ({ ...p, [member.id]: { ...(p[member.id] ?? { allocatedScans: '0' }), allocatedLocations: e.target.value } }))}
                                    className="bg-slate-700 border border-slate-600 rounded text-xs text-white p-1.5 w-full"
                                  />
                                </div>
                              </div>
                              <p className="text-xs text-gray-400">Remaining: {poolStats[admin.id]?.remainingScans ?? 0} scans · {poolStats[admin.id]?.remainingLocations ?? 0} locations</p>
                              <button
                                onClick={() => handleSaveAllocation(admin, member)}
                                disabled={actionLoading[`alloc_${member.id}`]}
                                className="w-full py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-xs rounded disabled:opacity-50"
                              >
                                {actionLoading[`alloc_${member.id}`] ? 'Saving…' : 'Save allocation'}
                              </button>
                            </div>
                          ) : (
                            <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-300">
                              <span>{member.allocatedScans ?? 0} / {poolStats[admin.id]?.poolScans ?? 0} scans</span>
                              <span>{member.allocatedLocations ?? 0} / {poolStats[admin.id]?.poolLocations ?? 0} locations</span>
                            </div>
                          )}
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
