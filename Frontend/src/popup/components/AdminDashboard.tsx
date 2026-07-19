import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { QBConnectionCard } from './QBConnectionCard';
import { ScannerHealthCard } from './ScannerHealthCard';
import { useToast } from './Toast';
import { ErrorCard, DashboardSkeleton } from './shared';
import { formatAction, relativeTime, trialCountdown } from '../lib/utils';
import type { QBStatus, ScanHealth, TeamMember, AuditLogEntry } from '../../types';

interface Props {
  jwt: string;
}

interface AdminStats {
  teamSize: number;
  maxUsers: number;
  totalScans: number;
  totalSynced: number;
  totalFailed: number;
  expiringSoon: number;
  totalPending: number;
}

const EMPTY_STATS: AdminStats = {
  teamSize: 0,
  maxUsers: 0,
  totalScans: 0,
  totalSynced: 0,
  totalFailed: 0,
  expiringSoon: 0,
  totalPending: 0,
};


function isExpiringSoon(member: TeamMember): boolean {
  if (member.status !== 'ACTIVE' || !member.trialExpiresAt) return false;
  const now = Date.now();
  const exp = new Date(member.trialExpiresAt).getTime();
  const inThreeDays = now + 3 * 24 * 60 * 60 * 1000;
  return exp >= now && exp <= inThreeDays;
}

export default function AdminDashboard({ jwt }: Props) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [stats, setStats] = useState<AdminStats>(EMPTY_STATS);
  const [qbStatus, setQbStatus] = useState<QBStatus>({ connected: false });
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [recentActivity, setRecentActivity] = useState<AuditLogEntry[]>([]);
  const [scanHealth, setScanHealth] = useState<ScanHealth | null>(null);
  const [scanHealthLoaded, setScanHealthLoaded] = useState(false);
  const [healthDays, setHealthDays] = useState(3);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsData, qbData, teamData, auditData] = await Promise.all([
        api.getAdminStats(jwt),
        api.getQBStatus(jwt),
        api.getAdminTeam(jwt),
        api.getAdminAuditLog(jwt, 1, 5),
      ]);

      setStats(statsData);
      setQbStatus(qbData);
      setTeamMembers(teamData.users as TeamMember[]);
      setRecentActivity(auditData.logs);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load admin dashboard.';
      setError(message);
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
    void fetchData();
    void fetchScanHealth();
  }, [fetchData, fetchScanHealth]);

  const expiringMembers = useMemo(() => {
    return teamMembers
      .filter(isExpiringSoon)
      .sort((a, b) => {
        const aTs = a.trialExpiresAt ? new Date(a.trialExpiresAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bTs = b.trialExpiresAt ? new Date(b.trialExpiresAt).getTime() : Number.MAX_SAFE_INTEGER;
        return aTs - bTs;
      });
  }, [teamMembers]);

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
        <ErrorCard message={error} onRetry={fetchData} />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">🏠 Team Overview</h2>
        {stats.expiringSoon > 0 && (
          <span className="text-xs px-2 py-1 rounded bg-yellow-900/50 border border-yellow-700 text-yellow-300">
            ⚠ {stats.expiringSoon} expiring soon
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-gray-400">👥 Team</div>
          <div className="text-2xl font-bold text-white mt-1">{stats.teamSize}/{stats.maxUsers || 0}</div>
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
        <div className="bg-slate-800 border border-yellow-900 rounded-lg p-3">
          <div className="text-xs text-yellow-400">⚠ Expiring Soon</div>
          <div className="text-2xl font-bold text-yellow-400 mt-1">{stats.expiringSoon}</div>
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
        <h3 className="text-sm font-medium text-emerald-300">Expiring Soon</h3>
        {expiringMembers.length === 0 ? (
          <p className="text-sm text-gray-500">No team members expiring in the next 3 days</p>
        ) : (
          expiringMembers.map(member => (
            <div key={member.id} className="bg-slate-900 border border-slate-700 rounded p-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-white truncate">⚠ {member.name ?? member.email}</p>
                {member.name && <p className="text-xs text-gray-500 truncate">{member.email}</p>}
              </div>
              <span className="text-xs text-yellow-300 flex-shrink-0">{trialCountdown(member.trialExpiresAt)}</span>
            </div>
          ))
        )}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
        <h3 className="text-sm font-medium text-emerald-300 mb-2">Team Members</h3>
        {teamMembers.length === 0 ? (
          <p className="text-sm text-gray-500">No team members yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b border-slate-700">
                  <th className="py-2 pr-2">Name / Email</th>
                  <th className="py-2 pr-2">Role</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2">Trial</th>
                </tr>
              </thead>
              <tbody>
                {teamMembers.map(member => (
                  <tr key={member.id} className="border-b border-slate-800/80 text-gray-200">
                    <td className="py-2 pr-2">
                      <div className="truncate max-w-[180px] text-gray-100">{member.name ?? member.email}</div>
                      {member.name && <div className="text-gray-500 truncate max-w-[180px]">{member.email}</div>}
                    </td>
                    <td className="py-2 pr-2">
                      <span className="px-1.5 py-0.5 rounded text-[11px] bg-emerald-900 text-emerald-300">{member.role}</span>
                    </td>
                    <td className="py-2 pr-2">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] ${
                        member.status === 'ACTIVE'
                          ? 'bg-green-900 text-green-400'
                          : member.status === 'DISABLED'
                            ? 'bg-red-900 text-red-400'
                            : 'bg-yellow-900 text-yellow-400'
                      }`}>
                        {member.status}
                      </span>
                    </td>
                    <td className="py-2 text-gray-400">{trialCountdown(member.trialExpiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-2">
        <h3 className="text-sm font-medium text-emerald-300">Recent Activity</h3>
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
    </div>
  );
}
