import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { hasPerm } from '../lib/permissions';
import { relativeTime } from '../lib/utils';
import type { RecentScan, UserInfo } from '../lib/api';
import type { QBStatus, ScanHealth } from '../../types';
import { QBConnectionCard } from './QBConnectionCard';
import { ScannerHealthCard } from './ScannerHealthCard';
import { DashboardSkeleton, StatusBadge } from './shared';

interface UserDashboardProps {
  jwt: string;
  user: UserInfo;
}

export function UserDashboard({ jwt, user }: UserDashboardProps) {
  const [qbStatus, setQbStatus] = useState<QBStatus>({ connected: false });
  const [scanHealth, setScanHealth] = useState<ScanHealth | null>(null);
  const [healthDays, setHealthDays] = useState(3);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  const [scansLoading, setScansLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [qb, health] = await Promise.all([
          api.getQBStatus(jwt),
          api.getScanHealth(jwt, healthDays),
        ]);
        if (!cancelled) {
          setQbStatus(qb);
          setScanHealth(health);
        }
      } catch {
        if (!cancelled) {
          setScanHealth(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [jwt, healthDays]);

  useEffect(() => {
    setScansLoading(true);
    api.getRecentScans(jwt)
      .then((response) => setRecentScans(response.scans))
      .catch(() => setRecentScans([]))
      .finally(() => setScansLoading(false));
  }, [jwt]);

  const handleReconnect = useCallback(async () => {
    try {
      const { authUrl } = await api.getQBAuthUrl(jwt);
      chrome.runtime.sendMessage({ type: 'OPEN_QB_AUTH', payload: { authUrl } });
    } catch {
      // silent
    }
  }, [jwt]);

  const handleDisconnect = useCallback(async () => {
    try {
      await api.deleteQBToken(jwt);
      setQbStatus({ connected: false });
    } catch {
      // silent
    }
  }, [jwt]);

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <DashboardSkeleton type="list" rows={4} />
      </div>
    );
  }

  const daysLeft = user.trialExpiresAt
    ? Math.ceil((new Date(user.trialExpiresAt).getTime() - Date.now()) / 86400000)
    : null;

  const canApprove = ['MANAGER', 'ADMIN', 'OWNER'].includes(user.role);

  return (
    <div className="p-4 space-y-3">
      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <QBConnectionCard qbStatus={qbStatus} onReconnect={handleReconnect} onDisconnect={handleDisconnect} />
      </div>

      {scanHealth && (
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <ScannerHealthCard scanHealth={scanHealth} days={healthDays} onDaysChange={setHealthDays} />
        </div>
      )}

      {scanHealth && canApprove && scanHealth.pendingApprovalScans > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-sm font-medium text-blue-700">Pending Approval</div>
          <div className="mt-2 text-3xl font-bold text-blue-900">{scanHealth.pendingApprovalScans}</div>
          <div className="text-xs text-blue-600">scans awaiting approval</div>
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
        <h3 className="text-sm font-medium text-emerald-600">My Permissions</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className={hasPerm(user, 'scan', 'write') ? 'text-emerald-600' : 'text-red-600'}>{hasPerm(user, 'scan', 'write') ? '✅ Scan' : '❌ Scan'}</div>
          <div className={hasPerm(user, 'map', 'write') ? 'text-emerald-600' : 'text-red-600'}>{hasPerm(user, 'map', 'write') ? '✅ Map & Rules' : '❌ Map & Rules'}</div>
          <div className={hasPerm(user, 'sync', 'execute') ? 'text-emerald-600' : 'text-red-600'}>{hasPerm(user, 'sync', 'execute') ? '✅ Sync Data' : '❌ Sync Data'}</div>
          <div className={hasPerm(user, 'locations', 'write') ? 'text-emerald-600' : 'text-red-600'}>{hasPerm(user, 'locations', 'write') ? '✅ Locations' : '❌ Locations'}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
        <h3 className="text-sm font-medium text-emerald-600">Trial Status</h3>
        {user.trialExpiresAt ? (
          <>
            {daysLeft !== null && daysLeft < 0 ? (
              <p className="text-sm text-red-600">❌ Expired</p>
            ) : daysLeft !== null && daysLeft <= 7 ? (
              <p className="text-sm text-amber-600">⚠️ {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining</p>
            ) : (
              <p className="text-sm text-emerald-600">✅ {daysLeft} days remaining</p>
            )}
            {user.customExpiryMessage && (
              <p className="text-xs text-gray-600 mt-1">{user.customExpiryMessage}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-emerald-600">✅ Active — No trial limit</p>
        )}
      </div>
    </div>
  );
}
