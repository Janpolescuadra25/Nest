import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import { useQuickBooks } from '../hooks/useQuickBooks';
import { useQBContext } from '../contexts/QBContext';
import { useToast } from './Toast';
import { buildJEPayload } from '../lib/je-builder';
import type { ScanRecord, ScanEntry } from '../../types';

interface Props {
  jwt: string;
  selectedLocationId: string;
  onLocationChange: (id: string) => void;
  onTabChange?: (tab: string) => void;
  onScanRecordId?: (id: string) => void;
  onboardingStep?: number;
  onHasSynced?: () => void;
}

const STATUS_CLASSES: Record<string, string> = {
  SYNCED: 'text-green-400 bg-green-900/30 border-green-800',
  FAILED: 'text-red-400 bg-red-900/30 border-red-800',
  PENDING: 'text-yellow-400 bg-yellow-900/30 border-yellow-800',
  MAPPED: 'text-blue-400 bg-blue-900/30 border-blue-800',
};

export default function SyncView({ jwt, selectedLocationId, onLocationChange, onTabChange, onScanRecordId, onboardingStep = 0, onHasSynced }: Props) {
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
  const [isRetryingId, setIsRetryingId] = useState<string | null>(null);
  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [expandedScanId, setExpandedScanId] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId) return;
    setLoading(true);
    setError(null);
    setScans([]);
    setPage(1);
    setHasMore(false);
    setSourceFilter('all');
    setExpandedScanId(null);
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

  const refreshScans = async () => {
    const { scans: freshScans, hasMore: freshMore } = await api.getScans(jwt, locationId, 1);
    setScans(freshScans ?? []);
    setHasMore(freshMore ?? false);
    setPage(1);
  };

  const handleRetryScan = async (scanId: string) => {
    setIsRetryingId(scanId);
    try {
      const result = await api.retryScan(jwt, scanId);
      if (result.success) {
        showToast(
          `Retry succeeded — JE ${result.docNumber ?? result.qbJournalEntryId ?? 'created'} (attempt ${result.attemptCount})`,
          'success',
        );
      } else {
        showToast(
          `Retry failed: ${result.errorMessage ?? 'Unknown error'} (attempt ${result.attemptCount}/3)`,
          'error',
        );
      }
      await refreshScans();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Retry error', 'error');
    } finally {
      setIsRetryingId(null);
    }
  };

  const handleRetryAllFailed = async () => {
    setIsRetryingAll(true);
    try {
      const { summary } = await api.retryBatch(jwt, { locationId });
      showToast(
        `Retry complete — ${summary.succeeded} succeeded, ${summary.failed} failed, ${summary.skipped} skipped`,
        summary.failed > 0 ? 'error' : 'success',
      );
      await refreshScans();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Batch retry failed', 'error');
    } finally {
      setIsRetryingAll(false);
    }
  };

  const getScanAttention = (scan: ScanRecord): 'stale' | 'max-retried' | 'old-failure' | null => {
    if (scan.status === 'PENDING' || scan.status === 'MAPPED') {
      const scanAge = Date.now() - new Date(scan.scanDate).getTime();
      if (scanAge > 24 * 60 * 60 * 1000) return 'stale';
    }
    if (scan.status === 'FAILED') {
      const latestLog = scan.syncLogs?.slice().sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime())[0];
      if (latestLog?.attemptCount && latestLog.attemptCount >= 3) return 'max-retried';
      if (latestLog) {
        const failureAge = Date.now() - new Date(latestLog.syncedAt).getTime();
        if (failureAge > 24 * 60 * 60 * 1000) return 'old-failure';
      }
    }
    return null;
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
          scanEntry: scan.source && scan.source !== 'pos' && scan.rawScanEntry
            ? scan.rawScanEntry as ScanEntry
            : undefined,
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

      await refreshScans();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Batch sync failed', 'error');
    } finally {
      setBatchSyncing(false);
      setBatchProgress('');
    }
  };

  const safeScans = scans ?? [];
  const filteredScans = sourceFilter === 'all'
    ? safeScans
    : safeScans.filter((s) => (s.source ?? 'pos').toLowerCase() === sourceFilter);
  const totalSynced = safeScans.filter((s) => s.status === 'SYNCED').length;
  const totalFailed = safeScans.filter((s) => s.status === 'FAILED').length;
  const totalPending = safeScans.filter((s) => s.status === 'PENDING' || s.status === 'MAPPED').length;
  const staleCount = safeScans.filter((s) => getScanAttention(s) === 'stale').length;
  const maxRetriedCount = safeScans.filter((s) => getScanAttention(s) === 'max-retried').length;
  const oldFailureCount = safeScans.filter((s) => getScanAttention(s) === 'old-failure').length;
  const totalAttention = staleCount + maxRetriedCount + oldFailureCount;

  useEffect(() => {
    if (totalSynced > 0) {
      onHasSynced?.();
    }
  }, [totalSynced, onHasSynced]);

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
                disabled={batchSyncing || isRetryingAll}
                className="text-xs bg-amber-700 hover:bg-amber-600 disabled:bg-amber-900 text-white px-3 py-1 rounded transition-colors flex-shrink-0"
              >
                {batchSyncing ? '⏳ Syncing...' : '⚡ Sync All Pending'}
              </button>
            )}
            {status.connected && totalFailed > 0 && (
              <button
                onClick={() => void handleRetryAllFailed()}
                disabled={batchSyncing || isRetryingAll}
                className="text-xs bg-amber-600 hover:bg-amber-700 disabled:bg-amber-900 text-white px-3 py-1 rounded transition-colors flex-shrink-0"
              >
                {isRetryingAll ? '⏳ Retrying...' : `↻ Retry ${totalFailed} Failed`}
              </button>
            )}
          </div>
          {batchSyncing && batchProgress && (
            <p className="text-xs text-amber-400 text-center animate-pulse">{batchProgress}</p>
          )}
        </div>
      )}

      {totalAttention > 0 && (
        <div className="mb-3 px-3 py-2 rounded bg-amber-900/20 border border-amber-800/50 text-xs">
          <span className="text-amber-300 font-medium">
            ⚠ {totalAttention} scan{totalAttention > 1 ? 's' : ''} need{totalAttention === 1 ? 's' : ''} attention
          </span>
          <span className="text-slate-400 ml-2">
            {staleCount > 0 && `${staleCount} stale`}
            {staleCount > 0 && maxRetriedCount > 0 && ' · '}
            {maxRetriedCount > 0 && `${maxRetriedCount} max-retried`}
            {maxRetriedCount > 0 && oldFailureCount > 0 && ' · '}
            {oldFailureCount > 0 && `${oldFailureCount} old failure${oldFailureCount > 1 ? 's' : ''}`}
          </span>
          {maxRetriedCount > 0 && (
            <span className="text-slate-500 ml-2">— Re-sync max-retried scans from Preview tab</span>
          )}
        </div>
      )}

      {/* History table */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-700">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Sync History</span>
        </div>
        <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-2">
          <span className="text-xs text-gray-500 flex-shrink-0">Filter:</span>
          <select
            className="bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="all">All Sources</option>
            <option value="pos">POS Only</option>
            <option value="excel">Excel Only</option>
            <option value="image">Image Only</option>
            <option value="pdf">PDF Only</option>
          </select>
          {sourceFilter !== 'all' && (
            <span className="text-xs text-gray-500">
              {filteredScans.length} of {safeScans.length} scans
            </span>
          )}
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
        ) : filteredScans.length === 0 && safeScans.length > 0 ? (
          <div className="py-8 text-center">
            <div className="text-2xl mb-2">🔍</div>
            <p className="text-gray-500 text-sm">No scans match the selected filter</p>
            <p className="text-gray-600 text-xs mt-1">Try changing the source filter above</p>
          </div>
        ) : safeScans.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-2xl mb-2">📭</div>
            <p className="text-gray-500 text-sm">No scans yet</p>
            <p className="text-gray-600 text-xs mt-1">
              {onboardingStep === 4
                ? 'Begin your first sync — scan a POS report, map it, and push to QuickBooks'
                : 'Go to Scan tab and scan a Toast report to get started'}
            </p>
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
                  <th className="text-left px-3 py-2 text-gray-400 font-medium">Source</th>
                  <th className="text-left px-3 py-2 text-gray-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredScans.map((scan) => {
                  const latestLog = scan.syncLogs?.slice().sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime())[0];
                  const attempts = latestLog?.attemptCount ?? 1;
                  const jeId = latestLog?.qbJournalEntryId;
                  const qbBaseUrl = status.environment === 'sandbox'
                    ? 'https://app.sandbox.qbo.intuit.com'
                    : 'https://app.qbo.intuit.com';
                  const retryDisabled = scan.syncLogs?.some((l) => l.attemptCount >= 3) ?? false;
                  const attention = getScanAttention(scan);
                  const scanSource = (scan.source ?? 'pos').toLowerCase();
                  return (
                    <React.Fragment key={scan.id}>
                      <tr className={`border-t border-gray-700/50 hover:bg-gray-700/20 ${attention === 'max-retried' ? 'bg-red-900/20' : attention === 'stale' || attention === 'old-failure' ? 'bg-amber-900/10' : ''}`}>
                        <td className="px-3 py-2 text-gray-200 font-mono">{scan.scanDate}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded border text-xs ${STATUS_CLASSES[scan.status] ?? 'text-gray-400'}`}>
                            {scan.status}
                            {scan.status === 'FAILED' ? ` (${attempts}/3)` : ''}
                            {attention === 'stale' && (
                              <span className="ml-1 text-amber-400" title="Scan data is over 24h old and hasn't been synced">⏰</span>
                            )}
                            {attention === 'max-retried' && (
                              <span className="ml-1 text-red-500" title="Maximum retries reached (3/3). Re-sync from Preview tab.">⛔</span>
                            )}
                            {attention === 'old-failure' && (
                              <span className="ml-1 text-amber-400" title="Failed over 24h ago. Retries available — use Retry button.">⚠️</span>
                            )}
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
                          {scanSource === 'excel' ? (
                            <span
                              className="px-2 py-0.5 rounded border text-xs bg-emerald-900/30 border-emerald-800 text-emerald-400 cursor-pointer hover:bg-emerald-900/50"
                              title="Excel import — click to inspect"
                              onClick={() => {
                                if (scan.rawScanEntry) {
                                  setExpandedScanId(expandedScanId === scan.id ? null : scan.id);
                                }
                              }}
                            >
                              Excel{expandedScanId === scan.id ? ' ▾' : ' ▸'}
                            </span>
                          ) : scanSource === 'image' ? (
                            <span
                              className="px-2 py-0.5 rounded border text-xs bg-purple-900/30 border-purple-800 text-purple-400 cursor-pointer hover:bg-purple-900/50"
                              title="Image scan — click to inspect"
                              onClick={() => {
                                if (scan.rawScanEntry) {
                                  setExpandedScanId(expandedScanId === scan.id ? null : scan.id);
                                }
                              }}
                            >
                              Image{expandedScanId === scan.id ? ' ▾' : ' ▸'}
                            </span>
                          ) : scanSource === 'pdf' ? (
                            <span
                              className="px-2 py-0.5 rounded border text-xs bg-orange-900/30 border-orange-800 text-orange-400 cursor-pointer hover:bg-orange-900/50"
                              title="PDF scan — click to inspect"
                              onClick={() => {
                                if (scan.rawScanEntry) {
                                  setExpandedScanId(expandedScanId === scan.id ? null : scan.id);
                                }
                              }}
                            >
                              PDF{expandedScanId === scan.id ? ' ▾' : ' ▸'}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded border text-xs bg-cyan-900/30 border-cyan-800 text-cyan-400" title="POS scan">
                              POS
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {scan.status === 'FAILED' && (
                            <button
                              onClick={() => void handleRetryScan(scan.id)}
                              disabled={isRetryingId === scan.id || retryDisabled}
                              title={retryDisabled ? 'Maximum retries reached (3 attempts)' : 'Retry sync'}
                              className="text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-800 hover:border-cyan-600 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                            >
                              {isRetryingId === scan.id ? '⏳ Retrying...' : '↻ Retry'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedScanId === scan.id && scan.rawScanEntry && (
                        <tr className="border-t border-gray-700/30 bg-gray-900/50">
                          <td colSpan={6} className="px-4 py-3" onClick={() => setExpandedScanId(null)}>
                            {(() => {
                              const entry = scan.rawScanEntry as ScanEntry;
                              const header = entry.header ?? {};
                              const headerKeys = Object.keys(header);
                              return (
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                                    {entry.fileName && (
                                      <span className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5">
                                        📄 {entry.fileName}
                                      </span>
                                    )}
                                    {entry.rowNumber != null && (
                                      <span className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5">
                                        Row {entry.rowNumber}
                                      </span>
                                    )}
                                    {entry.source && (
                                      <span className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5">
                                        Source: {entry.source}
                                      </span>
                                    )}
                                  </div>
                                  {headerKeys.length > 0 && (
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                      {headerKeys.map((key) => (
                                        <div key={key} className="text-xs">
                                          <span className="text-gray-500">{key}:</span>{' '}
                                          <span className="text-gray-300">{header[key]}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {entry.lineItems && entry.lineItems.length > 0 && (
                                    <div className="mt-1 text-xs text-gray-500">
                                      {entry.lineItems.length} line item{entry.lineItems.length !== 1 ? 's' : ''}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      )}
                      {scan.status === 'FAILED' && latestLog && (latestLog.errorMessage || latestLog.errorType) && (
                        <tr>
                          <td colSpan={6} className="px-3 pb-2 pt-0">
                            {latestLog.errorType === 'AUTH' ? (
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
                            ) : latestLog.errorType === 'TRANSIENT' ? (
                              <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800 rounded px-2 py-1">
                                ⚠ Sync failed due to a temporary issue. Please try again.
                              </div>
                            ) : latestLog.errorType === 'VALIDATION' ? (
                              <div className="text-xs text-gray-300 bg-slate-900 border border-slate-700 rounded px-2 py-1">
                                Sync failed: {latestLog.errorMessage}
                              </div>
                            ) : latestLog.errorType === 'FATAL' ? (
                              <div className="text-xs text-red-400 bg-red-900/20 border border-red-900 rounded px-2 py-1">
                                Sync failed. Please try again or contact support.
                              </div>
                            ) : (
                              <div className="text-xs text-red-400 bg-red-900/20 border border-red-900 rounded px-2 py-1">
                                {latestLog.errorMessage}
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
