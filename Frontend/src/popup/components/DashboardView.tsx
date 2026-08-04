import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, type RecentScan } from '../lib/api';
import { useToast } from './Toast';
import { QBConnectionCard } from './QBConnectionCard';
import { ScannerHealthCard } from './ScannerHealthCard';
import { ErrorCard, DashboardSkeleton } from './shared';
import StatusBadge from './shared/StatusBadge';
import { formatAction, relativeTime } from '../lib/utils';
import type { QBStatus, ScanHealth, AdminRequest, OwnerAuditLogEntry, TabId } from '../../types';
import type { OnboardingState } from '../lib/onboarding';

interface Props {
  jwt: string;
  onboardingState?: OnboardingState;
  onNavigate?: (tab: TabId) => void;
  onHasSynced?: () => void;
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


export default function DashboardView({ jwt, onboardingState, onNavigate, onHasSynced }: Props) {
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
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  const [scansLoading, setScansLoading] = useState(true);
  const [showCelebration, setShowCelebration] = useState(false);
  const prevStepRef = useRef<number>(0);

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
      showToast('Failed to reconnect QuickBooks. Please try again.', 'error');
    }
  }, [jwt, showToast]);

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

  useEffect(() => {
    setScansLoading(true);
    api.getRecentScans(jwt)
      .then((response) => setRecentScans(response.scans))
      .catch(() => setRecentScans([]))
      .finally(() => setScansLoading(false));
  }, [jwt]);

  useEffect(() => {
    if (stats.totalSynced > 0) {
      onHasSynced?.();
    }
  }, [stats.totalSynced, onHasSynced]);

  useEffect(() => {
    const prevStep = prevStepRef.current;
    const currentStep = onboardingState?.step ?? 0;
    if (prevStep > 0 && currentStep === 0) {
      setShowCelebration(true);
      const timer = window.setTimeout(() => setShowCelebration(false), 5000);
      return () => window.clearTimeout(timer);
    }
    prevStepRef.current = currentStep;
  }, [onboardingState?.step]);

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
        <h2 className="text-base font-semibold text-gray-900">🏠 Dashboard</h2>
        {stats.expiredMembers > 0 && (
          <span className="text-xs px-2 py-1 rounded bg-amber-50 border border-amber-200 text-amber-600">
            ⚠ {stats.expiredMembers} expired members
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <div className="text-xs text-gray-600">📍 Locations</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{stats.totalLocations}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <div className="text-xs text-gray-600">🤝 Partners</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{stats.totalPartners}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <div className="text-xs text-gray-600">🔍 Scans</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{stats.totalScans}</div>
        </div>
        <div className="bg-white border border-amber-200 rounded-lg p-3">
          <div className="text-xs text-amber-400">⏳ Pending</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">{stats.totalPending}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <div className="text-xs text-gray-600">✅ Synced</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{stats.totalSynced}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <div className="text-xs text-gray-600">❌ Failed</div>
          <div className="text-2xl font-bold text-red-600 mt-1">{stats.totalFailed}</div>
          {stats.totalFailed > 0 && (
            <p className="text-[10px] text-slate-500 mt-1">
              Check SyncView for retry details
            </p>
          )}
        </div>
      </div>

      {onboardingState?.step === 1 ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">
          <div className="font-semibold">Connect QuickBooks to get started.</div>
          <div className="mt-1 text-xs text-emerald-100">QuickBooks connection is required before you can sync your first report.</div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="mt-3 rounded bg-white px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-gray-100"
            >
              Connect QuickBooks
            </button>
          )}
        </div>
      ) : onboardingState?.step && onboardingState.step > 1 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-3 text-sm text-gray-700">
          <div className="font-semibold">You're on step {onboardingState.step}: {onboardingState.step === 2 ? 'Add Your First Location' : onboardingState.step === 3 ? 'Create a Mapping' : 'Begin Your First Sync'}</div>
          <div className="mt-1 text-xs text-gray-600">Continue setup to complete your onboarding flow.</div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate(onboardingState.step === 2 ? 'locations' : onboardingState.step === 3 ? 'mappings' : 'scan')}
              className="mt-3 rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600"
            >
              Continue setup
            </button>
          )}
        </div>
      ) : null}

      {showCelebration && (
        <div
          className="bg-emerald-500/20 border border-emerald-500/30 rounded-lg p-4 text-center cursor-pointer"
          onClick={() => setShowCelebration(false)}
          role="button"
          tabIndex={0}
        >
          <div className="text-2xl mb-1">🎉</div>
          <p className="text-emerald-600 text-sm font-medium">You're all set!</p>
          <p className="text-emerald-600 text-xs mt-1">AutoBooks is now syncing your data automatically.</p>
        </div>
      )}

      <QBConnectionCard qbStatus={qbStatus} onReconnect={() => void handleReconnect()} onDisconnect={() => void handleDisconnect()} />
      {scanHealthLoaded ? (
        scanHealth ? <ScannerHealthCard scanHealth={scanHealth} days={healthDays} onDaysChange={setHealthDays} /> : null
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="h-4 bg-gray-50 rounded animate-pulse" />
          <div className="h-3 bg-gray-50 rounded animate-pulse" />
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Recent Scans</h3>
        {scansLoading ? (
          <div className="space-y-2">
            <div className="bg-gray-100 animate-pulse h-10 rounded-lg" />
            <div className="bg-gray-100 animate-pulse h-10 rounded-lg" />
          </div>
        ) : recentScans.length === 0 ? (
          <p className="text-sm text-gray-400">No scans yet. Start by scanning your first report.</p>
        ) : (
          <div className="space-y-2">
            {recentScans.map(scan => (
              <div key={scan.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-900">{scan.location.name}</p>
                  <p className="text-xs text-gray-400">{relativeTime(scan.createdAt)} · {scan.source}</p>
                </div>
                <StatusBadge status={scan.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
        <h3 className="text-sm font-medium text-emerald-600">Pending Requests</h3>
        {pendingRequests.length === 0 ? (
          <p className="text-sm text-gray-600">No pending requests</p>
        ) : (
          pendingRequests.map(req => (
            <div key={req.id} className="bg-gray-50 border border-gray-200 rounded p-2 space-y-1">
              <div className="text-sm text-gray-900 truncate">📬 {req.email}</div>
              <div className="text-xs text-gray-600">{req.company ?? 'No company provided'}</div>
              <div className="text-xs text-gray-600">{req.description ?? 'No description provided'}</div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleApprove(req.id)}
                  disabled={actionLoading[`approve_${req.id}`]}
                  className="px-2 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-600 disabled:opacity-50"
                >
                  {actionLoading[`approve_${req.id}`] ? 'Approving...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleReject(req.id)}
                  disabled={actionLoading[`reject_${req.id}`]}
                  className="px-2 py-1 rounded bg-red-50 text-red-700 text-xs hover:bg-red-700 disabled:opacity-50"
                >
                  {actionLoading[`reject_${req.id}`] ? 'Rejecting...' : 'Reject'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
        <h3 className="text-sm font-medium text-emerald-600">Recent Activity</h3>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-gray-600">No recent activity</p>
        ) : (
          recentActivity.map(log => (
            <div key={log.id} className="flex items-start justify-between gap-2 bg-gray-50 border border-gray-200 rounded p-2">
              <div className="min-w-0">
                <p className="text-sm text-gray-700 truncate">{formatAction(log.action)}</p>
                <p className="text-xs text-gray-600 truncate">{log.actor.name ?? log.actor.email}</p>
              </div>
              <span className="text-xs text-gray-600 flex-shrink-0">{relativeTime(log.createdAt)}</span>
            </div>
          ))
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <h3 className="text-sm font-medium text-emerald-600 mb-2">Partners</h3>
        {partners.length === 0 ? (
          <p className="text-sm text-gray-600">No partners yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-600 border-b border-gray-200">
                  <th className="py-2 pr-2">Email</th>
                  <th className="py-2 pr-2">Team</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {partners.map(partner => (
                  <tr key={partner.id} className="border-b border-slate-800/80 text-gray-700">
                    <td className="py-2 pr-2 truncate max-w-[150px]">{partner.email}</td>
                    <td className="py-2 pr-2">{partner.currentTeamSize}/{partner.maxUsers ?? '-'}</td>
                    <td className="py-2 pr-2">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] ${
                        partner.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-emerald-600'
                          : partner.status === 'DISABLED'
                            ? 'bg-red-50 text-red-600'
                            : 'bg-amber-50 text-amber-600'
                      }`}>
                        {partner.status}
                      </span>
                    </td>
                    <td className="py-2 text-gray-600">{relativeTime(partner.updatedAt)}</td>
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