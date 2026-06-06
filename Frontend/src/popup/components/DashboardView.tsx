import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';
import { QBConnectionCard } from './QBConnectionCard';
import { ScannerHealthCard } from './ScannerHealthCard';
import { ErrorCard, DashboardSkeleton } from './shared';
import { formatAction, relativeTime } from '../lib/utils';
import type { QBStatus, ScanHealth, AdminRequest, OwnerAuditLogEntry } from '../../types';

interface Props {
  jwt: string;
}

interface OwnerStats {
  totalPartners: number;
  totalTeamMembers: number;
  totalLocations: number;
  totalScans: number;
  totalSynced: number;
  totalFailed: number;
  totalPendingRequests: number;
  expiredMembers: number;
  totalPending: number;
}

interface AdminPartner {
  id: string;
  email: string;
  name: string | null;
  maxUsers: number | null;
  status: string;
  currentTeamSize: number;
  updatedAt: string;
}

const EMPTY_STATS: OwnerStats = {
  totalPartners: 0,
  totalTeamMembers: 0,
  totalLocations: 0,
  totalScans: 0,
  totalSynced: 0,
  totalFailed: 0,
  totalPendingRequests: 0,
  expiredMembers: 0,
  totalPending: 0,
};


export default function DashboardView({ jwt }: Props) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const [stats, setStats] = useState<OwnerStats>(EMPTY_STATS);
  const [qbStatus, setQbStatus] = useState<QBStatus>({ connected: false });
  const [pendingRequests, setPendingRequests] = useState<AdminRequest[]>([]);
  const [recentActivity, setRecentActivity] = useState<OwnerAuditLogEntry[]>([]);
  const [partners, setPartners] = useState<AdminPartner[]>([]);
  const [scanHealth, setScanHealth] = useState<ScanHealth | null>(null);
  const [scanHealthLoaded, setScanHealthLoaded] = useState(false);
  const [healthDays, setHealthDays] = useState(3);

  const fetchPendingRequests = useCallback(async () => {
    const data = await api.getAdminRequests(jwt, 1, 'PENDING');
    setPendingRequests(data.requests as AdminRequest[]);
  }, [jwt]);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsData, qbData, requestsData, activityData, adminsData] = await Promise.all([
        api.getOwnerStats(jwt),
        api.getQBStatus(jwt),
        api.getAdminRequests(jwt, 1, 'PENDING'),
        api.getAuditLog(jwt, { page: 1, limit: 5 }),
        api.getOwnerAdmins(jwt),
      ]);
      setStats(statsData);
      setQbStatus(qbData);
      setPendingRequests(requestsData.requests as AdminRequest[]);
      setRecentActivity(activityData.logs as OwnerAuditLogEntry[]);
      setPartners(adminsData.admins as AdminPartner[]);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  const fetchScanHealth = useCallback(async () => {
    try {
      const health = await api.getScanHealth(jwt, healthDays);
      setScanHealth(health);
    } catch (err) {
      setScanHealth(null);
    } finally {
      setScanHealthLoaded(true);
    }
  }, [jwt, healthDays]);

  const handleReconnect = useCallback(async () => {
    try {
      const { authUrl } = await api.getQBAuthUrl(jwt);
      chrome.runtime.sendMessage({ type: 'OPEN_QB_AUTH', payload: { authUrl } });
    } catch (err) {
      // silently fail — user can retry from Settings
    }
  }, [jwt]);

  const handleDisconnect = useCallback(async () => {
    try {
      await api.deleteQBToken(jwt);
      showToast('QuickBooks disconnected', 'success');
      setQbStatus({ connected: false, reason: 'not_connected' });
    } catch (err: any) {
      showToast(err.message || 'Failed to disconnect', 'error');
    }
  }, [jwt]);

  useEffect(() => {
    void fetchDashboard();
    void fetchScanHealth();
  }, [fetchDashboard, fetchScanHealth]);

  const handleApprove = async (id: string) => {
    setActionLoading(prev => ({ ...prev, [`approve_${id}`]: true }));
    try {
      await api.approveAdminRequest(jwt, id);
      showToast('Request approved', 'success');
      await fetchPendingRequests();
      const refreshedStats = await api.getOwnerStats(jwt);
      setStats(refreshedStats);
    } catch (err: any) {
      showToast(err.message || 'Failed to approve request', 'error');
    } finally {
      setActionLoading(prev => ({ ...prev, [`approve_${id}`]: false }));
    }
  };

  const handleReject = async (id: string) => {
    setActionLoading(prev => ({ ...prev, [`reject_${id}`]: true }));
    try {
      await api.rejectAdminRequest(jwt, id);
      showToast('Request rejected', 'success');
      await fetchPendingRequests();
      const refreshedStats = await api.getOwnerStats(jwt);
      setStats(refreshedStats);
    } catch (err: any) {
      showToast(err.message || 'Failed to reject request', 'error');
    } finally {
      setActionLoading(prev => ({ ...prev, [`reject_${id}`]: false }));
    }
  };

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <DashboardSkeleton type="cards" rows={6} />
        <DashboardSkeleton type="list" rows={2} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <ErrorCard message={error} onRetry={fetchDashboard} />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">🏠 Dashboard</h2>
        {stats.expiredMembers > 0 && (
          <span className="text-xs px-2 py-1 rounded bg-yellow-900/50 border border-yellow-700 text-yellow-300">
            ⚠ {stats.expiredMembers} expired members
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-gray-400">📍 Locations</div>
          <div className="text-2xl font-bold text-white mt-1">{stats.totalLocations}</div>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-gray-400">🤝 Partners</div>
          <div className="text-2xl font-bold text-white mt-1">{stats.totalPartners}</div>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-gray-400">🔍 Scans</div>
          <div className="text-2xl font-bold text-white mt-1">{stats.totalScans}</div>
        </div>
        <div className="bg-slate-800 border border-amber-900 rounded-lg p-3">
          <div className="text-xs text-amber-400">⏳ Pending</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">{stats.totalPending}</div>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-gray-400">✅ Synced</div>
          <div className="text-2xl font-bold text-green-400 mt-1">{stats.totalSynced}</div>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-gray-400">❌ Failed</div>
          <div className="text-2xl font-bold text-red-400 mt-1">{stats.totalFailed}</div>
        </div>
      </div>

      <QBConnectionCard qbStatus={qbStatus} onReconnect={() => void handleReconnect()} onDisconnect={() => void handleDisconnect()} />
      {scanHealthLoaded ? (
        scanHealth ? <ScannerHealthCard scanHealth={scanHealth} days={healthDays} onDaysChange={setHealthDays} /> : null
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-2">
          <div className="h-4 bg-slate-900 rounded animate-pulse" />
          <div className="h-3 bg-slate-900 rounded animate-pulse" />
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-2">
        <h3 className="text-sm font-medium text-cyan-300">Pending Requests</h3>
        {pendingRequests.length === 0 ? (
          <p className="text-sm text-gray-500">No pending requests</p>
        ) : (
          pendingRequests.map(req => (
            <div key={req.id} className="bg-slate-900 border border-slate-700 rounded p-2 space-y-1">
              <div className="text-sm text-white truncate">📬 {req.email}</div>
              <div className="text-xs text-gray-400">{req.company ?? 'No company provided'}</div>
              <div className="text-xs text-gray-500">{req.description ?? 'No description provided'}</div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleApprove(req.id)}
                  disabled={actionLoading[`approve_${req.id}`]}
                  className="px-2 py-1 rounded bg-green-800 text-green-100 text-xs hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading[`approve_${req.id}`] ? 'Approving...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleReject(req.id)}
                  disabled={actionLoading[`reject_${req.id}`]}
                  className="px-2 py-1 rounded bg-red-900 text-red-200 text-xs hover:bg-red-800 disabled:opacity-50"
                >
                  {actionLoading[`reject_${req.id}`] ? 'Rejecting...' : 'Reject'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-2">
        <h3 className="text-sm font-medium text-cyan-300">Recent Activity</h3>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-gray-500">No recent activity</p>
        ) : (
          recentActivity.map(log => (
            <div key={log.id} className="flex items-start justify-between gap-2 bg-slate-900 border border-slate-700 rounded p-2">
              <div className="min-w-0">
                <p className="text-sm text-gray-200 truncate">{formatAction(log.action)}</p>
                <p className="text-xs text-gray-500 truncate">{log.actor.name ?? log.actor.email}</p>
              </div>
              <span className="text-xs text-gray-500 flex-shrink-0">{relativeTime(log.createdAt)}</span>
            </div>
          ))
        )}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
        <h3 className="text-sm font-medium text-cyan-300 mb-2">Partners</h3>
        {partners.length === 0 ? (
          <p className="text-sm text-gray-500">No partners yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b border-slate-700">
                  <th className="py-2 pr-2">Email</th>
                  <th className="py-2 pr-2">Team</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {partners.map(partner => (
                  <tr key={partner.id} className="border-b border-slate-800/80 text-gray-200">
                    <td className="py-2 pr-2 truncate max-w-[150px]">{partner.email}</td>
                    <td className="py-2 pr-2">{partner.currentTeamSize}/{partner.maxUsers ?? '-'}</td>
                    <td className="py-2 pr-2">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] ${
                        partner.status === 'ACTIVE'
                          ? 'bg-green-900 text-green-400'
                          : partner.status === 'DISABLED'
                            ? 'bg-red-900 text-red-400'
                            : 'bg-yellow-900 text-yellow-400'
                      }`}>
                        {partner.status}
                      </span>
                    </td>
                    <td className="py-2 text-gray-400">{relativeTime(partner.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}