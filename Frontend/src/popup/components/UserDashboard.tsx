import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { hasPerm } from '../lib/permissions';
import type { UserInfo } from '../lib/api';
import type { QBStatus, ScanHealth } from '../../types';
import { QBConnectionCard } from './QBConnectionCard';
import { ScannerHealthCard } from './ScannerHealthCard';

interface UserDashboardProps {
  jwt: string;
  user: UserInfo;
}

export function UserDashboard({ jwt, user }: UserDashboardProps) {
  const [qbStatus, setQbStatus] = useState<QBStatus>({ connected: false });
  const [scanHealth, setScanHealth] = useState<ScanHealth | null>(null);
  const [healthDays, setHealthDays] = useState(3);
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
        <div className="animate-pulse bg-slate-800 border border-slate-700 rounded-lg h-16" />
        <div className="animate-pulse bg-slate-800 border border-slate-700 rounded-lg h-20" />
        <div className="animate-pulse bg-slate-800 border border-slate-700 rounded-lg h-16" />
        <div className="animate-pulse bg-slate-800 border border-slate-700 rounded-lg h-16" />
      </div>
    );
  }

  const daysLeft = user.trialExpiresAt
    ? Math.ceil((new Date(user.trialExpiresAt).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <div className="p-4 space-y-3">
      <div className="bg-gray-800 border border-slate-700 rounded-lg p-3">
        <QBConnectionCard qbStatus={qbStatus} onReconnect={handleReconnect} onDisconnect={handleDisconnect} />
      </div>

      {scanHealth && (
        <div className="bg-gray-800 border border-slate-700 rounded-lg p-3">
          <ScannerHealthCard scanHealth={scanHealth} days={healthDays} onDaysChange={setHealthDays} />
        </div>
      )}

      <div className="bg-gray-800 border border-slate-700 rounded-lg p-3 space-y-2">
        <h3 className="text-sm font-medium text-cyan-300">My Permissions</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className={hasPerm(user, 'scan', 'write') ? 'text-green-400' : 'text-red-400'}>{hasPerm(user, 'scan', 'write') ? '✅ Scan' : '❌ Scan'}</div>
          <div className={hasPerm(user, 'map', 'write') ? 'text-green-400' : 'text-red-400'}>{hasPerm(user, 'map', 'write') ? '✅ Map & Rules' : '❌ Map & Rules'}</div>
          <div className={hasPerm(user, 'sync', 'execute') ? 'text-green-400' : 'text-red-400'}>{hasPerm(user, 'sync', 'execute') ? '✅ Sync Data' : '❌ Sync Data'}</div>
          <div className={hasPerm(user, 'locations', 'write') ? 'text-green-400' : 'text-red-400'}>{hasPerm(user, 'locations', 'write') ? '✅ Locations' : '❌ Locations'}</div>
        </div>
      </div>

      <div className="bg-gray-800 border border-slate-700 rounded-lg p-3 space-y-2">
        <h3 className="text-sm font-medium text-cyan-300">Trial Status</h3>
        {user.trialExpiresAt ? (
          <>
            {daysLeft !== null && daysLeft < 0 ? (
              <p className="text-sm text-red-400">❌ Expired</p>
            ) : daysLeft !== null && daysLeft <= 7 ? (
              <p className="text-sm text-yellow-400">⚠️ {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining</p>
            ) : (
              <p className="text-sm text-green-400">✅ {daysLeft} days remaining</p>
            )}
            {user.customExpiryMessage && (
              <p className="text-xs text-gray-400 mt-1">{user.customExpiryMessage}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-green-400">✅ Active — No trial limit</p>
        )}
      </div>
    </div>
  );
}
