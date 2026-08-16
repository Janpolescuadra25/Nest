import React, { useState, useEffect, useCallback } from 'react';
import { api, type OwnerAdminPool, type OwnerAdminMember } from '../lib/api';
import { useToast } from './Toast';
import { ErrorCard, StatusBadge, DashboardSkeleton, EmptyState } from './shared';
import { BACKEND_URL } from '../../lib/config';
import type { InviteLink, AdminRequest } from '../../types';

interface Admin {
  id: string;
  email: string;
  name: string | null;
  maxUsers: number | null;
  status: string;
  currentTeamSize: number;
  description: string | null;
  company: string | null;
  brandName?: string | null;
  brandColor?: string | null;
  logoUrl?: string | null;
  agreementPrice?: string | null;
  agreementDate?: string | null;
  agreementTerms?: string | null;
  agreementDocUrl?: string | null;
}

interface ApproveResult {
  user: { id: string; email: string; name: string | null; role: string };
  emailWarning?: string;
}

interface Props {
  jwt: string;
  userRole: string;
}

export default function AdminsTab({ jwt, userRole }: Props) {
  const { showToast } = useToast();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [poolData, setPoolData] = useState<Record<string, OwnerAdminPool>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [memberMap, setMemberMap] = useState<Record<string, OwnerAdminMember[]>>({});
  const [poolStats, setPoolStats] = useState<Record<string, { poolScans: number | null; poolLocations: number | null; poolTemplates: number | null; poolStorageBytes: number | null; maxMembers: number | null; memberCount: number; remainingScans: number; remainingLocations: number; remainingTemplates: number; remainingStorage: number }>>({});
  const [teamLoading, setTeamLoading] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [editMaxUsers, setEditMaxUsers] = useState<Record<string, string>>({});
  const [showEditMaxUsers, setShowEditMaxUsers] = useState<Record<string, boolean>>({});
  const [showEditPool, setShowEditPool] = useState<Record<string, boolean>>({});
  const [editPoolValues, setEditPoolValues] = useState<Record<string, { poolScans: string; poolLocations: string; poolTemplates: string; maxMembers: string }>>({});
  const [showEditAllocation, setShowEditAllocation] = useState<Record<string, boolean>>({});
  const [editAllocationValues, setEditAllocationValues] = useState<Record<string, { allocatedScans: string; allocatedLocations: string; allocatedTemplates: string }>>({});
  const [showEditAgreement, setShowEditAgreement] = useState<Record<string, boolean>>({});
  const [agreementInputs, setAgreementInputs] = useState<Record<string, { agreementPrice: string; agreementDate: string; agreementTerms: string }>>({});
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'clients' | 'requests'>('clients');
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
  const [inviteLinksLoading, setInviteLinksLoading] = useState(false);
  const [createRole, setCreateRole] = useState<string>('STAFF');
  const [createExpiry, setCreateExpiry] = useState<number>(168);
  const [createMaxUses, setCreateMaxUses] = useState<number>(1);
  const [createStorageUnlimited, setCreateStorageUnlimited] = useState(true);
  const [createStorageValue, setCreateStorageValue] = useState<string>('1024');
  const [createStorageUnit, setCreateStorageUnit] = useState<'MB' | 'GB'>('GB');
  const [createScans, setCreateScans] = useState<string>('0');
  const [createLocations, setCreateLocations] = useState<string>('0');
  const [creating, setCreating] = useState(false);
  const [lastCreatedUrl, setLastCreatedUrl] = useState<string | null>(null);
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [approveResult, setApproveResult] = useState<ApproveResult | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [poolInputs, setPoolInputs] = useState<Record<string, { poolScans: string; poolLocations: string; poolTemplates: string; maxMembers: string }>>({});
  const [pendingCount, setPendingCount] = useState<number>(0);

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

  useEffect(() => {
    if (userRole === 'OWNER') {
      setCreateRole('ADMIN');
    }
  }, [userRole]);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getAdminRequests(jwt, 1, 'PENDING');
        setPendingCount(data.total);
      } catch {
        // silent — badge count not critical
      }
    })();
  }, [jwt]);

  useEffect(() => {
    if (viewMode !== 'clients') return;
    (async () => {
      setInviteLinksLoading(true);
      try {
        const data = await api.listOwnerInviteLinks(jwt);
        setInviteLinks(data.invites);
      } catch {
        // silent — invite section non-critical
      } finally {
        setInviteLinksLoading(false);
      }
    })();
  }, [jwt, viewMode]);

  useEffect(() => {
    if (viewMode !== 'requests') return;
    (async () => {
      setRequestsLoading(true);
      try {
        const data = await api.getAdminRequests(jwt, 1, statusFilter || undefined);
        setRequests(data.requests);
      } catch {
        // silent — requests section will show empty
      } finally {
        setRequestsLoading(false);
      }
    })();
  }, [jwt, viewMode, statusFilter]);

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
      poolTemplates: String(poolData[admin.id]?.poolTemplates ?? 25),
      maxMembers: String(poolData[admin.id]?.maxMembers ?? 5),
    };
    const poolScans = parseInt(values.poolScans, 10) || 200;
    const poolLocations = parseInt(values.poolLocations, 10) || 50;
    const poolTemplates = parseInt(values.poolTemplates, 10) || 25;
    const maxMembers = parseInt(values.maxMembers, 10) || 5;
    setActionLoading(p => ({ ...p, [`pool_${admin.id}`]: true }));
    try {
      await api.updateOwnerAdminPool(jwt, admin.id, { poolScans, poolLocations, poolTemplates, maxMembers });
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
      allocatedTemplates: String(member.allocatedTemplates ?? 0),
    };
    const allocatedScans = parseInt(values.allocatedScans, 10);
    const allocatedLocations = parseInt(values.allocatedLocations, 10);
    const allocatedTemplates = parseInt(values.allocatedTemplates, 10);
    if (isNaN(allocatedScans) || allocatedScans < 0 || isNaN(allocatedLocations) || allocatedLocations < 0 || isNaN(allocatedTemplates) || allocatedTemplates < 0) {
      showToast('Enter valid allocation numbers', 'error');
      return;
    }
    const currentScans = member.allocatedScans ?? 0;
    const currentLocations = member.allocatedLocations ?? 0;
    const currentTemplates = member.allocatedTemplates ?? 0;
    const remainingScans = poolStats[admin.id]?.remainingScans ?? 0;
    const remainingLocations = poolStats[admin.id]?.remainingLocations ?? 0;
    const remainingTemplates = poolStats[admin.id]?.remainingTemplates ?? 0;
    const maxAllowedScans = currentScans + remainingScans;
    const maxAllowedLocations = currentLocations + remainingLocations;
    const maxAllowedTemplates = currentTemplates + remainingTemplates;
    if (allocatedScans > maxAllowedScans) {
      showToast(`Scans cannot exceed ${maxAllowedScans}`, 'error');
      return;
    }
    if (allocatedLocations > maxAllowedLocations) {
      showToast(`Locations cannot exceed ${maxAllowedLocations}`, 'error');
      return;
    }
    if (allocatedTemplates > maxAllowedTemplates) {
      showToast(`Templates cannot exceed ${maxAllowedTemplates}`, 'error');
      return;
    }
    setActionLoading(p => ({ ...p, [`alloc_${member.id}`]: true }));
    try {
      await api.updateOwnerMemberAllocation(jwt, admin.id, member.id, { allocatedScans, allocatedLocations, allocatedTemplates });
      showToast('Allocation updated', 'success');
      setShowEditAllocation(p => ({ ...p, [member.id]: false }));
      await loadAdminMembers(admin.id);
    } catch (err: any) {
      showToast(err.message || 'Failed to save allocation', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`alloc_${member.id}`]: false }));
    }
  };

  const handleCreateInviteLink = async () => {
    const expiry = Math.min(720, Math.max(1, createExpiry));
    const uses = Math.min(100, Math.max(1, createMaxUses));
    const bytes = createStorageUnlimited
      ? null
      : Math.max(0, Number(createStorageValue) || 0) * (createStorageUnit === 'GB' ? 1073741824 : 1048576);
    const scans = createScans === '' ? null : Number(createScans);
    const locations = createLocations === '' ? null : Number(createLocations);
    setCreating(true);
    setLastCreatedUrl(null);
    try {
      const data = await api.createInviteLink(jwt, {
        roleHint: userRole === 'OWNER' ? 'ADMIN' : createRole,
        expiresInHours: expiry,
        maxUses: uses,
        maxStorageBytes: bytes,
        maxScans: userRole === 'OWNER' ? null : scans,
        maxLocations: userRole === 'OWNER' ? null : locations,
      });
      const url = `${BACKEND_URL}/api/invite/${data.invite.token ?? ''}`;
      setLastCreatedUrl(url);
      showToast('Invite link created', 'success');
      const inviteData = await api.listOwnerInviteLinks(jwt);
      setInviteLinks(inviteData.invites);
    } catch (err: any) {
      showToast(err.message || 'Failed to create invite link', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeInviteLink = async (id: string) => {
    try {
      await api.revokeOwnerInviteLink(jwt, id);
      setInviteLinks((prev) => prev.filter((link) => link.id !== id));
      showToast('Invite link revoked', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to revoke link', 'error');
    }
  };

  const handleApproveRequest = async (id: string) => {
    setActionLoading(p => ({ ...p, [id]: true }));
    try {
      const pool = poolInputs[id] ?? { poolScans: '200', poolLocations: '50', poolTemplates: '25', maxMembers: '5' };
      const result = await api.approveAdminRequest(jwt, id, {
        poolScans: parseInt(pool.poolScans, 10) || 200,
        poolLocations: parseInt(pool.poolLocations, 10) || 50,
        poolTemplates: parseInt(pool.poolTemplates, 10) || 25,
        maxMembers: parseInt(pool.maxMembers, 10) || 5,
      });
      setApproveResult(result);
      setRequests((prev) => prev.filter((request) => request.id !== id));
      setPendingCount((prev) => Math.max(0, prev - 1));
      showToast('Partner approved', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to approve request.', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [id]: false }));
    }
  };

  const handleRejectRequest = async (id: string) => {
    setActionLoading(p => ({ ...p, [`r_${id}`]: true }));
    try {
      await api.rejectAdminRequest(jwt, id);
      setRequests((prev) => prev.filter((request) => request.id !== id));
      setPendingCount((prev) => Math.max(0, prev - 1));
      showToast('Request rejected', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to reject request.', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`r_${id}`]: false }));
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{viewMode === 'clients' ? 'Clients' : 'Partner Requests'}</h2>
          <p className="text-xs text-gray-500 mt-0.5">Manage client admins, invite links, and pending partner requests in one place.</p>
        </div>
        <button onClick={fetchAdmins} className="text-xs text-gray-600 hover:text-gray-600">↻ Refresh</button>
      </div>

      <div className="flex gap-2 border-b border-gray-200 pb-2">
        <button
          onClick={() => setViewMode('clients')}
          className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors ${
            viewMode === 'clients'
              ? 'text-[var(--brand-color)] border-b-2 border-[var(--brand-color)] bg-[#F5F5F7]'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Active Clients
          {pendingCount > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setViewMode('requests')}
          className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors ${
            viewMode === 'requests'
              ? 'text-[var(--brand-color)] border-b-2 border-[var(--brand-color)] bg-[#F5F5F7]'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Pending Requests
        </button>
      </div>

      {error && <ErrorCard message={error} onDismiss={() => setError('')} />}

      {loading ? (
        <DashboardSkeleton type="list" rows={4} />
      ) : viewMode === 'clients' ? (
        <>
          {admins.length === 0 ? (
            <EmptyState
              icon="👤"
              title="No clients found"
              description="Add a client admin to start managing their team."
            />
          ) : (
            admins.map(admin => (
              <div key={admin.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{admin.name ?? admin.email}</div>
                    {admin.name && <div className="text-xs text-gray-600 truncate">{admin.email}</div>}
                    {admin.company && <div className="text-xs text-gray-600 truncate">{admin.company}</div>}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <StatusBadge status={admin.status} />
                      <span className="text-xs text-gray-600">
                        {admin.currentTeamSize}/{admin.maxUsers ?? '∞'} members
                      </span>
                    </div>
                    {poolData[admin.id]?.poolScans != null && (
                      <div className="text-xs text-gray-600 mt-1">
                        Pool: {poolData[admin.id].poolScans} scans · {poolData[admin.id].poolLocations} locations · max {poolData[admin.id].maxMembers ?? '∞'} members
                      </div>
                    )}
                  </div>
                  <button onClick={() => handleExpand(admin)} className="text-gray-600 hover:text-gray-600 text-xs flex-shrink-0">
                    {expandedId === admin.id ? '▲' : '▼'}
                  </button>
                </div>

                {expandedId === admin.id && (
                  <div className="pt-2 border-t border-gray-200 space-y-3">
                    {poolData[admin.id]?.poolScans != null && (
                      <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium text-gray-600">Pool Settings</p>
                            <p className="text-xs text-gray-600">{poolData[admin.id].poolScans} scans · {poolData[admin.id].poolLocations} locations · {poolData[admin.id].poolTemplates} templates · max {poolData[admin.id].maxMembers ?? '∞'} members</p>
                          </div>
                          <button
                            onClick={() => {
                              setEditPoolValues(p => ({
                                ...p,
                                [admin.id]: {
                                  poolScans: String(poolData[admin.id]?.poolScans ?? 200),
                                  poolLocations: String(poolData[admin.id]?.poolLocations ?? 50),
                                  poolTemplates: String(poolData[admin.id]?.poolTemplates ?? 25),
                                  maxMembers: String(poolData[admin.id]?.maxMembers ?? 5),
                                },
                              }));
                              setShowEditPool(p => ({ ...p, [admin.id]: !p[admin.id] }));
                            }}
                            className="text-xs px-2 py-1 bg-gray-200 text-gray-600 rounded hover:bg-gray-300"
                          >
                            {showEditPool[admin.id] ? 'Cancel' : 'Edit pool'}
                          </button>
                        </div>
                        {showEditPool[admin.id] && (
                          <div className="space-y-2">
                            <div className="grid gap-2 sm:grid-cols-4">
                              <div>
                                <p className="text-xs text-gray-600 mb-1">Scans</p>
                                <input
                                  type="number"
                                  min={0}
                                  value={editPoolValues[admin.id]?.poolScans ?? '200'}
                                  onChange={e => setEditPoolValues(p => ({ ...p, [admin.id]: { ...(p[admin.id] ?? { poolLocations: '50', poolTemplates: '25', maxMembers: '5' }), poolScans: e.target.value } }))}
                                  className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5 w-full"
                                />
                              </div>
                              <div>
                                <p className="text-xs text-gray-600 mb-1">Locations</p>
                                <input
                                  type="number"
                                  min={0}
                                  value={editPoolValues[admin.id]?.poolLocations ?? '50'}
                                  onChange={e => setEditPoolValues(p => ({ ...p, [admin.id]: { ...(p[admin.id] ?? { poolScans: '200', poolTemplates: '25', maxMembers: '5' }), poolLocations: e.target.value } }))}
                                  className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5 w-full"
                                />
                              </div>
                              <div>
                                <p className="text-xs text-gray-600 mb-1">Templates</p>
                                <input
                                  type="number"
                                  min={0}
                                  value={editPoolValues[admin.id]?.poolTemplates ?? '25'}
                                  onChange={e => setEditPoolValues(p => ({ ...p, [admin.id]: { ...(p[admin.id] ?? { poolScans: '200', poolLocations: '50', maxMembers: '5' }), poolTemplates: e.target.value } }))}
                                  className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5 w-full"
                                />
                              </div>
                              <div>
                                <p className="text-xs text-gray-600 mb-1">Members</p>
                                <input
                                  type="number"
                                  min={0}
                                  value={editPoolValues[admin.id]?.maxMembers ?? '5'}
                                  onChange={e => setEditPoolValues(p => ({ ...p, [admin.id]: { ...(p[admin.id] ?? { poolScans: '200', poolLocations: '50', poolTemplates: '25' }), maxMembers: e.target.value } }))}
                                  className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5 w-full"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleSavePool(admin)}
                                disabled={actionLoading[`pool_${admin.id}`]}
                                className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded disabled:opacity-50"
                              >
                                Save pool
                              </button>
                              <button
                                onClick={() => setShowEditPool(p => ({ ...p, [admin.id]: false }))}
                                className="flex-1 py-1.5 bg-gray-300 hover:bg-gray-200 text-gray-900 text-xs rounded"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Agreement Section */}
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Agreement</p>
                      {showEditAgreement[admin.id] ? (
                        <div className="space-y-2">
                          <div>
                            <p className="text-xs text-gray-600 mb-1">Price ($)</p>
                            <input
                              type="number"
                              step="0.01"
                              value={agreementInputs[admin.id]?.agreementPrice ?? ''}
                              onChange={e => setAgreementInputs(prev => ({
                                ...prev,
                                [admin.id]: { ...(prev[admin.id] ?? { agreementPrice: '', agreementDate: '', agreementTerms: '' }), agreementPrice: e.target.value },
                              }))}
                              placeholder="0.00"
                              className="w-full bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5"
                            />
                          </div>

                          <div>
                            <p className="text-xs text-gray-600 mb-1">Date</p>
                            <input
                              type="date"
                              value={agreementInputs[admin.id]?.agreementDate ?? ''}
                              onChange={e => setAgreementInputs(prev => ({
                                ...prev,
                                [admin.id]: { ...(prev[admin.id] ?? { agreementPrice: '', agreementDate: '', agreementTerms: '' }), agreementDate: e.target.value },
                              }))}
                              className="w-full bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5"
                            />
                          </div>

                          <div>
                            <p className="text-xs text-gray-600 mb-1">Terms</p>
                            <textarea
                              value={agreementInputs[admin.id]?.agreementTerms ?? ''}
                              onChange={e => setAgreementInputs(prev => ({
                                ...prev,
                                [admin.id]: { ...(prev[admin.id] ?? { agreementPrice: '', agreementDate: '', agreementTerms: '' }), agreementTerms: e.target.value },
                              }))}
                              placeholder="Agreement terms..."
                              rows={3}
                              className="w-full bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5"
                            />
                          </div>

                          <div className="mt-3">
                            <label className="block text-xs font-medium text-slate-400 mb-1">Signed Agreement Document</label>
                            {admin.agreementDocUrl ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      const res = await api.getAgreementDocUrl(jwt, admin.id);
                                      window.open(res.url, '_blank');
                                    } catch {
                                      showToast('Failed to load document', 'error');
                                    }
                                  }}
                                  className="text-xs text-emerald-400 hover:text-emerald-300 underline"
                                >
                                  View / Download
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!confirm('Remove this agreement document?')) return;
                                    try {
                                      await api.removeAgreementDoc(jwt, admin.id);
                                      await fetchAdmins();
                                      showToast('Document removed', 'success');
                                    } catch {
                                      showToast('Failed to remove document', 'error');
                                    }
                                  }}
                                  className="text-xs text-red-400 hover:text-red-300"
                                >
                                  Remove
                                </button>
                              </div>
                            ) : (
                              <input
                                type="file"
                                accept=".pdf,image/*"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  setUploadingDoc(admin.id);
                                  try {
                                    await api.uploadAgreementDoc(jwt, admin.id, file);
                                    await fetchAdmins();
                                    showToast('Document uploaded', 'success');
                                  } catch {
                                    showToast('Failed to upload document', 'error');
                                  } finally {
                                    setUploadingDoc(null);
                                    if (e.target) {
                                      (e.target as HTMLInputElement).value = '';
                                    }
                                  }
                                }}
                                disabled={uploadingDoc === admin.id}
                                className="block w-full text-xs text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-medium file:bg-emerald-600 file:text-white hover:file:bg-emerald-700 disabled:opacity-50"
                              />
                            )}
                            {uploadingDoc === admin.id && <p className="text-xs text-slate-500 mt-1">Uploading...</p>}
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                const inputs = agreementInputs[admin.id];
                                if (!inputs) return;
                                setActionLoading(p => ({ ...p, [`agreement_${admin.id}`]: true }));
                                try {
                                  await api.updateAgreement(jwt, admin.id, {
                                    agreementPrice: inputs.agreementPrice || null,
                                    agreementDate: inputs.agreementDate || null,
                                    agreementTerms: inputs.agreementTerms || null,
                                  });
                                  showToast('Agreement updated', 'success');
                                  setShowEditAgreement(p => ({ ...p, [admin.id]: false }));
                                  await fetchAdmins();
                                } catch (err: any) {
                                  showToast(err.message || 'Failed to update agreement', 'error');
                                } finally {
                                  setActionLoading(p => ({ ...p, [`agreement_${admin.id}`]: false }));
                                }
                              }}
                              className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setShowEditAgreement(p => ({ ...p, [admin.id]: false }))}
                              className="flex-1 py-1.5 bg-gray-300 hover:bg-gray-200 text-gray-900 text-xs rounded"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setAgreementInputs(prev => ({
                              ...prev,
                              [admin.id]: {
                                agreementPrice: admin.agreementPrice ?? '',
                                agreementDate: admin.agreementDate ? new Date(admin.agreementDate).toISOString().split('T')[0] : '',
                                agreementTerms: admin.agreementTerms ?? '',
                              },
                            }));
                            setShowEditAgreement(p => ({ ...p, [admin.id]: true }));
                          }}
                          className="text-xs px-2 py-1 bg-gray-200 text-gray-600 rounded hover:bg-gray-300"
                        >
                          Edit agreement
                        </button>
                      )}
                    </div>

                    <div>
                      <p className="text-xs text-gray-600 mb-1">Member limit</p>
                      {showEditMaxUsers[admin.id] ? (
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            value={editMaxUsers[admin.id] ?? String(admin.maxUsers ?? '')}
                            onChange={e => setEditMaxUsers(p => ({ ...p, [admin.id]: e.target.value }))}
                            className="flex-1 px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 focus:outline-none focus:border-emerald-500"
                            placeholder="e.g. 10"
                          />
                          <button
                            onClick={() => handleSaveMaxUsers(admin)}
                            disabled={actionLoading[`maxu_${admin.id}`]}
                            className="px-3 py-1 bg-emerald-700 text-emerald-200 rounded text-xs hover:bg-emerald-600 disabled:opacity-50"
                          >
                            {actionLoading[`maxu_${admin.id}`] ? '…' : 'Save'}
                          </button>
                          <button
                            onClick={() => setShowEditMaxUsers(p => ({ ...p, [admin.id]: false }))}
                            className="px-2 py-1 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300"
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
                          className="text-xs px-2 py-1 bg-gray-200 text-gray-600 rounded hover:bg-gray-300"
                        >
                          Edit limit ({admin.maxUsers ?? 'Unlimited'})
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => handleToggleStatus(admin)}
                      disabled={actionLoading[`status_${admin.id}`]}
                      className={`w-full py-1.5 rounded text-xs font-medium disabled:opacity-50 ${
                        admin.status === 'DISABLED'
                          ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-700'
                          : 'bg-red-50 text-red-600 hover:bg-red-700'
                      }`}
                    >
                      {actionLoading[`status_${admin.id}`] ? '…' : admin.status === 'DISABLED' ? 'Enable Admin' : 'Disable Admin'}
                    </button>

                    <div>
                      <p className="text-xs text-gray-600 mb-1">Team members</p>
                      {teamLoading[admin.id] ? (
                        <p className="text-xs text-gray-600">Loading…</p>
                      ) : (memberMap[admin.id] ?? []).length === 0 ? (
                        <p className="text-xs text-gray-600">No team members.</p>
                      ) : (
                        <div className="space-y-2">
                          {memberMap[admin.id].map(member => (
                            <div key={member.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-xs text-gray-900 truncate">{member.name ?? member.email}</div>
                                  {member.name && <div className="text-xs text-gray-600 truncate">{member.email}</div>}
                                  <div className="text-xs text-gray-600">{member.role}</div>
                                </div>
                                {showEditAllocation[member.id] ? (
                                  <button
                                    onClick={() => setShowEditAllocation(p => ({ ...p, [member.id]: false }))}
                                    className="text-xs px-2 py-1 bg-gray-200 text-gray-600 rounded hover:bg-gray-300"
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
                                          allocatedTemplates: String(member.allocatedTemplates ?? 0),
                                        },
                                      }));
                                      setShowEditAllocation(p => ({ ...p, [member.id]: true }));
                                    }}
                                    className="text-xs px-2 py-1 bg-gray-200 text-gray-600 rounded hover:bg-gray-300"
                                  >
                                    Edit
                                  </button>
                                )}
                              </div>
                              {showEditAllocation[member.id] ? (
                                <div className="mt-3 space-y-2">
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <div className="grid gap-2 sm:grid-cols-3">
                                      <div>
                                        <p className="text-xs text-gray-600 mb-1">Scans</p>
                                        <input
                                          type="number"
                                          min={0}
                                          value={editAllocationValues[member.id]?.allocatedScans ?? '0'}
                                          onChange={e => setEditAllocationValues(p => ({ ...p, [member.id]: { ...(p[member.id] ?? { allocatedLocations: '0', allocatedTemplates: '0' }), allocatedScans: e.target.value } }))}
                                          className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5 w-full"
                                        />
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-600 mb-1">Locations</p>
                                        <input
                                          type="number"
                                          min={0}
                                          value={editAllocationValues[member.id]?.allocatedLocations ?? '0'}
                                          onChange={e => setEditAllocationValues(p => ({ ...p, [member.id]: { ...(p[member.id] ?? { allocatedScans: '0', allocatedTemplates: '0' }), allocatedLocations: e.target.value } }))}
                                          className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5 w-full"
                                        />
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-600 mb-1">Templates</p>
                                        <input
                                          type="number"
                                          min={0}
                                          value={editAllocationValues[member.id]?.allocatedTemplates ?? '0'}
                                          onChange={e => setEditAllocationValues(p => ({ ...p, [member.id]: { ...(p[member.id] ?? { allocatedScans: '0', allocatedLocations: '0' }), allocatedTemplates: e.target.value } }))}
                                          className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5 w-full"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  <p className="text-xs text-gray-600">Remaining: {poolStats[admin.id]?.remainingScans ?? 0} scans · {poolStats[admin.id]?.remainingLocations ?? 0} locations · {poolStats[admin.id]?.remainingTemplates ?? 0} templates</p>
                                  <button
                                    onClick={() => handleSaveAllocation(admin, member)}
                                    disabled={actionLoading[`alloc_${member.id}`]}
                                    className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded disabled:opacity-50"
                                  >
                                    {actionLoading[`alloc_${member.id}`] ? 'Saving…' : 'Save allocation'}
                                  </button>
                                </div>
                              ) : (
                                <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
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

          <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Invite Links</h3>
                <p className="text-xs text-gray-500">Create invite links to onboard new client admins.</p>
              </div>
            </div>
            <div className="space-y-3">
              {userRole !== 'OWNER' ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {(['STAFF', 'VIEWER', 'ACCOUNTANT', 'ADMIN', 'MANAGER'] as const).map((role) => (
                      <button
                        key={role}
                        onClick={() => setCreateRole(role)}
                        className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                          createRole === role
                            ? 'border-[var(--brand-color)] text-[var(--brand-color)] bg-[var(--brand-color)]/10'
                            : 'border-gray-300 text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">Scans allocation</label>
                      <input
                        type="number"
                        min={0}
                        value={createScans}
                        onChange={(e) => setCreateScans(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-emerald-200"
                      />
                      <p className="text-xs text-gray-500 mt-1">Remaining: {poolStats[expandedId ?? '']?.remainingScans ?? '—'} scans</p>
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">Locations allocation</label>
                      <input
                        type="number"
                        min={0}
                        value={createLocations}
                        onChange={(e) => setCreateLocations(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-emerald-200"
                      />
                      <p className="text-xs text-gray-500 mt-1">Remaining: {poolStats[expandedId ?? '']?.remainingLocations ?? '—'} locations</p>
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">Storage allocation</label>
                      <div className="grid gap-2 sm:grid-cols-[1fr_100px]">
                        <input
                          type="number"
                          min={0}
                          value={createStorageValue}
                          onChange={(e) => setCreateStorageValue(e.target.value)}
                          disabled={createStorageUnlimited}
                          placeholder="Amount"
                          className="w-full bg-gray-50 border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-emerald-200 disabled:opacity-50"
                        />
                        <select
                          value={createStorageUnit}
                          onChange={(e) => setCreateStorageUnit(e.target.value as 'MB' | 'GB')}
                          disabled={createStorageUnlimited}
                          className="w-full bg-gray-50 border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-emerald-200 disabled:opacity-50"
                        >
                          <option value="MB">MB</option>
                          <option value="GB">GB</option>
                        </select>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Remaining: {poolStats[expandedId ?? '']?.remainingStorage ?? '—'} bytes</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-600">Owners create ADMIN invite links only.</div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">Expires in (hours)</label>
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={createExpiry}
                    onChange={(e) => setCreateExpiry(Math.min(720, Math.max(1, Number(e.target.value))))}
                    className="w-full bg-gray-50 border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-emerald-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">Max uses</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={createMaxUses}
                    onChange={(e) => setCreateMaxUses(Math.min(100, Math.max(1, Number(e.target.value))))}
                    className="w-full bg-gray-50 border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-emerald-200"
                  />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-gray-600">Storage limit</label>
                    <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={createStorageUnlimited}
                        onChange={(e) => setCreateStorageUnlimited(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      Unlimited
                    </label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_100px]">
                    <input
                      type="number"
                      min={0}
                      value={createStorageValue}
                      onChange={(e) => setCreateStorageValue(e.target.value)}
                      disabled={createStorageUnlimited}
                      placeholder="Amount"
                      className="w-full bg-gray-50 border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-emerald-200 disabled:opacity-50"
                    />
                    <select
                      value={createStorageUnit}
                      onChange={(e) => setCreateStorageUnit(e.target.value as 'MB' | 'GB')}
                      disabled={createStorageUnlimited}
                      className="w-full bg-gray-50 border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-emerald-200 disabled:opacity-50"
                    >
                      <option value="MB">MB</option>
                      <option value="GB">GB</option>
                    </select>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Leave unlimited or enter a storage cap for the invited admin.</p>
                </div>
              </div>
              <button
                onClick={handleCreateInviteLink}
                disabled={creating}
                className="w-full rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold py-2 transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create Invite Link'}
              </button>
              {lastCreatedUrl && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-gray-700">
                  <div className="font-medium text-emerald-700">Invite link created</div>
                  <div className="mt-1 break-all">{lastCreatedUrl}</div>
                  <button
                    onClick={() => navigator.clipboard.writeText(lastCreatedUrl).catch(() => {}).then(() => showToast('Copied', 'success'))}
                    className="mt-2 text-xs text-emerald-600 hover:text-emerald-800"
                  >
                    Copy link
                  </button>
                </div>
              )}
              {inviteLinksLoading ? (
                <DashboardSkeleton type="list" rows={3} />
              ) : inviteLinks.length === 0 ? (
                <EmptyState icon="🔗" title="No invite links" description="Create an invite link to onboard a new client." />
              ) : (
                <div className="space-y-2">
                  {inviteLinks.map((link) => {
                    const fullUrl = `${BACKEND_URL}/api/invite/${link.token ?? ''}`;
                    return (
                      <div key={link.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-gray-900">{link.roleHint}</div>
                            <div className="text-xs text-gray-600">{link.useCount}/{link.maxUses} uses</div>
                          </div>
                          <button
                            onClick={() => handleRevokeInviteLink(link.id)}
                            className="rounded px-2 py-1 text-xs text-red-600 border border-red-200 hover:bg-red-50"
                          >
                            Revoke
                          </button>
                        </div>
                        <div className="mt-2 text-xs text-gray-600 break-all">{fullUrl}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          {approveResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-gray-700">
              <div className="font-medium text-emerald-700">Partner approved!</div>
              <div className="text-xs mt-1">Email: <span className="font-mono">{approveResult.user.email}</span></div>
              {approveResult.emailWarning ? (
                <div className="text-xs text-amber-700 mt-1">{approveResult.emailWarning}</div>
              ) : (
                <div className="text-xs text-gray-600 mt-1">A welcome email was sent to the partner with login instructions.</div>
              )}
              <button onClick={() => setApproveResult(null)} className="mt-2 text-xs text-gray-600 hover:text-gray-800">Dismiss</button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`text-xs rounded-full border px-3 py-1 ${
                  statusFilter === status
                    ? 'border-[var(--brand-color)] text-[var(--brand-color)] bg-[var(--brand-color)]/10'
                    : 'border-gray-300 text-gray-600 hover:border-gray-400'
                }`}
              >
                {status === '' ? 'All' : status.charAt(0) + status.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          {requestsLoading ? (
            <DashboardSkeleton type="list" rows={4} />
          ) : requests.length === 0 ? (
            <EmptyState icon="📬" title="No requests" description="No partner requests found for this filter." />
          ) : (
            requests.map((req) => (
              <div key={req.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{req.name ?? req.email}</div>
                    {req.name && <div className="text-xs text-gray-600 truncate">{req.email}</div>}
                    {req.company && <div className="text-xs text-gray-600">{req.company}</div>}
                    <div className="text-xs text-gray-600">{new Date(req.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <StatusBadge status={req.status} />
                    <button
                      onClick={() => setExpandedRequestId(expandedRequestId === req.id ? null : req.id)}
                      className="text-gray-600 hover:text-gray-600 text-xs"
                    >
                      {expandedRequestId === req.id ? '▲' : '▼'}
                    </button>
                  </div>
                </div>
                {expandedRequestId === req.id && (
                  <div className="pt-2 border-t border-gray-200 space-y-3">
                    {req.description && <p className="text-xs text-gray-600 italic">"{req.description}"</p>}
                    <div className="grid gap-2 sm:grid-cols-4">
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Scans</p>
                        <input
                          type="number"
                          min={0}
                          value={poolInputs[req.id]?.poolScans ?? '200'}
                          onChange={(e) => setPoolInputs((p) => ({ ...p, [req.id]: { ...(p[req.id] ?? { poolLocations: '50', poolTemplates: '25', maxMembers: '5' }), poolScans: e.target.value } }))}
                          className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5 w-full"
                        />
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Locations</p>
                        <input
                          type="number"
                          min={0}
                          value={poolInputs[req.id]?.poolLocations ?? '50'}
                          onChange={(e) => setPoolInputs((p) => ({ ...p, [req.id]: { ...(p[req.id] ?? { poolScans: '200', poolTemplates: '25', maxMembers: '5' }), poolLocations: e.target.value } }))}
                          className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5 w-full"
                        />
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Templates</p>
                        <input
                          type="number"
                          min={0}
                          value={poolInputs[req.id]?.poolTemplates ?? '25'}
                          onChange={(e) => setPoolInputs((p) => ({ ...p, [req.id]: { ...(p[req.id] ?? { poolScans: '200', poolLocations: '50', maxMembers: '5' }), poolTemplates: e.target.value } }))}
                          className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5 w-full"
                        />
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Members</p>
                        <input
                          type="number"
                          min={1}
                          value={poolInputs[req.id]?.maxMembers ?? '5'}
                          onChange={(e) => setPoolInputs((p) => ({ ...p, [req.id]: { ...(p[req.id] ?? { poolScans: '200', poolLocations: '50', poolTemplates: '25' }), maxMembers: e.target.value } }))}
                          className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1.5 w-full"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApproveRequest(req.id)}
                        disabled={actionLoading[req.id]}
                        className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded disabled:opacity-50"
                      >
                        {actionLoading[req.id] ? 'Approving…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleRejectRequest(req.id)}
                        disabled={actionLoading[`r_${req.id}`]}
                        className="flex-1 py-1.5 bg-red-50 text-red-600 rounded text-xs font-medium hover:bg-red-200 disabled:opacity-50"
                      >
                        {actionLoading[`r_${req.id}`] ? 'Rejecting…' : 'Reject'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
