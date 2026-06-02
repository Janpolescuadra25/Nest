import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import { useQuickBooks } from '../hooks/useQuickBooks';
import { useQBContext } from '../contexts/QBContext';
import { useToast } from './Toast';
import { buildJEPayload } from '../lib/je-builder';
import type { ScanRecord } from '../../types';

interface Props {
  jwt: string;
  selectedLocationId: string;
  onLocationChange: (id: string) => void;
  onTabChange?: (tab: string) => void;
  onScanRecordId?: (id: string) => void;
}

const STATUS_CLASSES: Record<string, string> = {
  SYNCED: 'text-green-400 bg-green-900/30 border-green-800',
  FAILED: 'text-red-400 bg-red-900/30 border-red-800',
  PENDING: 'text-yellow-400 bg-yellow-900/30 border-yellow-800',
  MAPPED: 'text-blue-400 bg-blue-900/30 border-blue-800',
};

export default function SyncView({ jwt, selectedLocationId, onLocationChange, onTabChange, onScanRecordId }: Props) {
  const { locations } = useLocations(jwt);
  const { status } = useQuickBooks(jwt);
  const { accounts } = useQBContext();
  const { showToast } = useToast();
  const locationId = selectedLocationId || locations[0]?.id || '';
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [batchSyncing, setBatchSyncing] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');

  useEffect(() => {
    if (!locationId) return;
    setLoading(true);
    setError(null);
    setScans([]);
    setPage(1);
    setHasMore(false);
    api.getScans(jwt, locationId, 1)
      .then((data) => { setScans(data.scans ?? []); setHasMore(data.hasMore ?? false); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sync history'))
      .finally(() => setLoading(false));
  }, [jwt, locationId]);

  const loadMore = () => {
    if (loading || !hasMore) return;
    const nextPage = page + 1;
    setLoading(true);
    api.getScans(jwt, locationId, nextPage)
      .then((data) => { setScans(prev => [...prev, ...(data.scans ?? [])]); setHasMore(data.hasMore ?? false); setPage(nextPage); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load more'))
      .finally(() => setLoading(false));
  };

  const handleSyncAll = async () => {
    setBatchSyncing(true);
    setBatchProgress('Preparing...');
    try {
      // Fetch all pending/mapped scans for this location (all pages)
      const allPending: ScanRecord[] = [];
      let fetchPage = 1;
      let fetchMore = true;
      while (fetchMore) {
        const { scans: pageScans, hasMore: more } = await api.getScans(jwt, locationId, fetchPage, 100);
        allPending.push(...(pageScans ?? []).filter((s) => s.status === 'PENDING' || s.status === 'MAPPED'));
        fetchMore = more;
        fetchPage++;
      }

      const mappings = await api.getMappings(jwt, locationId);

      const items = allPending
        .map((scan) => buildJEPayload({
          scanRecordId: scan.id,
          scanData: scan.rawData,
          mappings,
          accounts,
          txnDate: scan.scanDate.slice(0, 10),
        }))
        .filter((item) => item.lines.length > 0);

      if (items.length === 0) {
        showToast('No scans with mapped lines to sync', 'info');
        return;
      }

      setBatchProgress(`Syncing ${items.length} scan${items.length !== 1 ? 's' : ''}...`);

      const { results, summary } = await api.syncBatch(jwt, items);

      const hasAuthFailure = results.some((r) => r.status === 'FAILED' && r.errorType === 'AUTH');
      showToast(
        `${summary.synced} synced, ${summary.skipped} skipped, ${summary.failed} failed`,
        summary.failed > 0 ? 'error' : 'success',
      );
      if (hasAuthFailure) {
        showToast('QuickBooks connection expired. Please reconnect.', 'error');
      }

      // Refresh scan list
      const { scans: freshScans, hasMore: freshMore } = await api.getScans(jwt, locationId, 1);
      setScans(freshScans ?? []);
      setHasMore(freshMore ?? false);
      setPage(1);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Batch sync failed', 'error');
    } finally {
      setBatchSyncing(false);
      setBatchProgress('');
    }
  };

  const safeScans = scans ?? [];
  const totalSynced = safeScans.filter((s) => s.status === 'SYNCED').length;
  const totalFailed = safeScans.filter((s) => s.status === 'FAILED').length;
  const totalPending = safeScans.filter((s) => s.status === 'PENDING' || s.status === 'MAPPED').length;

  return (
    <div className="p-3 space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-white">{safeScans.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total Scans</div>
        </div>
        <div className="bg-gray-800 border border-green-900 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-green-400">{totalSynced}</div>
          <div className="text-xs text-gray-500 mt-0.5">Synced to QB</div>
        </div>
        <div className="bg-gray-800 border border-red-900 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-red-400">{totalFailed}</div>
          <div className="text-xs text-gray-500 mt-0.5">Failed</div>
        </div>
      </div>

      {/* Location picker */}
      {locations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 flex-shrink-0">📍 Location:</span>
            <select
              className="flex-1 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
              value={locationId}
              onChange={(e) => onLocationChange(e.target.value)}
              disabled={batchSyncing}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            {totalPending > 0 && (
              <span className="text-xs text-yellow-400 bg-yellow-900/30 border border-yellow-800 px-2 py-0.5 rounded flex-shrink-0">
                {totalPending} pending
              </span>
            )}
            {status.connected && (totalPending > 0 || batchSyncing) && (
              <button
                onClick={() => void handleSyncAll()}
                disabled={batchSyncing}
                className="text-xs bg-amber-700 hover:bg-amber-600 disabled:bg-amber-900 text-white px-3 py-1 rounded transition-colors flex-shrink-0"
              >
                {batchSyncing ? '⏳ Syncing...' : '⚡ Sync All Pending'}
              </button>
            )}
          </div>
          {batchSyncing && batchProgress && (
            <p className="text-xs text-amber-400 text-center animate-pulse">{batchProgress}</p>
          )}
        </div>
      )}

      {/* History table */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-700">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Sync History</span>
        </div>

        {loading ? (
          <div className="py-8 text-center text-gray-500 text-sm">Loading…</div>
        ) : error ? (
          <div className="py-4 text-center text-red-400 text-xs px-3">{error}</div>
        ) : !locationId ? (
          <div className="py-8 text-center">
            <div className="text-2xl mb-2">📍</div>
            <p className="text-gray-500 text-sm">No location selected</p>
            <p className="text-gray-600 text-xs mt-1">Add a location in Settings first</p>
          </div>
        ) : safeScans.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-2xl mb-2">📭</div>
            <p className="text-gray-500 text-sm">No scans yet</p>
            <p className="text-gray-600 text-xs mt-1">Go to Scan tab and scan a Toast report to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-700/30">
                  <th className="text-left px-3 py-2 text-gray-400 font-medium">Scan Date</th>
                  <th className="text-left px-3 py-2 text-gray-400 font-medium">Status</th>
                  <th className="text-left px-3 py-2 text-gray-400 font-medium">QB Journal Entry ID</th>
                  <th className="text-left px-3 py-2 text-gray-400 font-medium">Created</th>
                  <th className="text-left px-3 py-2 text-gray-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {safeScans.map((scan) => {
                  const syncLog = scan.syncLogs?.[0];
                  const jeId = syncLog?.qbJournalEntryId;
                  const qbBaseUrl = status.environment === 'sandbox'
                    ? 'https://app.sandbox.qbo.intuit.com'
                    : 'https://app.qbo.intuit.com';
                  return (
                    <React.Fragment key={scan.id}>
                      <tr className="border-t border-gray-700/50 hover:bg-gray-700/20">
                        <td className="px-3 py-2 text-gray-200 font-mono">{scan.scanDate}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded border text-xs ${STATUS_CLASSES[scan.status] ?? 'text-gray-400'}`}>
                            {scan.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-gray-400">
                          {jeId
                            ? <a href={`${qbBaseUrl}/app/journal?txnId=${jeId}`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline" title="View in QuickBooks">{jeId} ↗</a>
                            : '—'
                          }
                        </td>
                        <td className="px-3 py-2 text-gray-500">
                          {new Date(scan.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2">
                          {scan.status === 'FAILED' && onTabChange && onScanRecordId && (
                            <button
                              onClick={() => { onScanRecordId(scan.id); onTabChange('preview'); }}
                              className="text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-800 hover:border-cyan-600 px-2 py-0.5 rounded transition-colors"
                              title="Go to Preview tab to retry sync"
                            >
                              ↻ Retry
                            </button>
                          )}
                        </td>
                      </tr>
                      {scan.status === 'FAILED' && syncLog && (syncLog.errorMessage || syncLog.errorType) && (
                        <tr>
                          <td colSpan={5} className="px-3 pb-2 pt-0">
                            {syncLog.errorType === 'AUTH' ? (
                              <div className="text-xs text-red-400 bg-red-900/20 border border-red-900 rounded px-2 py-1.5 space-y-1">
                                <div>QuickBooks connection expired. Please reconnect.</div>
                                <button
                                  onClick={() => {
                                    api.getQBAuthUrl(jwt)
                                      .then(({ authUrl }) => window.open(authUrl, '_blank'))
                                      .catch(() => {});
                                  }}
                                  className="text-xs text-orange-400 hover:text-orange-300 border border-orange-800 hover:border-orange-600 px-2 py-0.5 rounded transition-colors"
                                >
                                  ↻ Reconnect QuickBooks
                                </button>
                              </div>
                            ) : syncLog.errorType === 'TRANSIENT' ? (
                              <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800 rounded px-2 py-1">
                                ⚠ Sync failed due to a temporary issue. Please try again.
                              </div>
                            ) : syncLog.errorType === 'VALIDATION' ? (
                              <div className="text-xs text-gray-300 bg-slate-900 border border-slate-700 rounded px-2 py-1">
                                Sync failed: {syncLog.errorMessage}
                              </div>
                            ) : syncLog.errorType === 'FATAL' ? (
                              <div className="text-xs text-red-400 bg-red-900/20 border border-red-900 rounded px-2 py-1">
                                Sync failed. Please try again or contact support.
                              </div>
                            ) : (
                              <div className="text-xs text-red-400 bg-red-900/20 border border-red-900 rounded px-2 py-1">
                                {syncLog.errorMessage}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info */}
      <p className="text-xs text-gray-700 text-center">
        Sync journal entries from the Preview tab (⚡ Sync to QuickBooks)
      </p>

      {/* Load more */}
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading || batchSyncing}
          className="w-full py-2 text-xs text-gray-400 hover:text-gray-200 border border-dashed border-gray-700 hover:border-gray-500 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
