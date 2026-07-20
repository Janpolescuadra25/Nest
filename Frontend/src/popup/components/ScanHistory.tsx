import React, { useEffect, useState } from 'react';
import type { ScanEntry, ScanRecord } from '../../types';
import { api } from '../lib/api';

interface Props {
  jwt: string;
  locationId: string;
  onLoadScan: (scan: {
    id: string;
    rawData: Record<string, number>;
    rawScanEntry?: ScanEntry | null;
    source: string;
  }) => void;
}

export default function ScanHistory({ jwt, locationId, onLoadScan }: Props) {
  const [page, setPage] = useState(1);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeLoadId, setActiveLoadId] = useState<string | null>(null);

  const loadPage = async (nextPage: number) => {
    setLoading(true);
    try {
      const result = await api.getScans(jwt, locationId, nextPage, 10);
      setScans(result.scans ?? []);
      setHasMore(result.hasMore ?? false);
      setPage(nextPage);
    } catch (err) {
      console.error('[ScanHistory] Failed to load scans', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPage(1);
  }, [jwt, locationId]);

  const handleLoad = async (scan: ScanRecord) => {
    setActiveLoadId(scan.id);
    try {
      onLoadScan({
        id: scan.id,
        rawData: scan.rawData,
        rawScanEntry: scan.rawScanEntry ?? null,
        source: scan.source ?? 'pos',
      });
    } finally {
      setTimeout(() => setActiveLoadId(null), 300);
    }
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-gray-900">Scan History</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => loadPage(page - 1)}
            className="text-xs bg-gray-200 hover:bg-gray-100 disabled:opacity-40 text-gray-600 px-2 py-1 rounded"
          >
            ← Prev
          </button>
          <button
            type="button"
            disabled={!hasMore || loading}
            onClick={() => loadPage(page + 1)}
            className="text-xs bg-gray-200 hover:bg-gray-100 disabled:opacity-40 text-gray-600 px-2 py-1 rounded"
          >
            Next →
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-gray-600">Loading...</div>
      ) : scans.length === 0 ? (
        <div className="text-xs text-gray-600">No scan history yet.</div>
      ) : (
        <div className="space-y-2">
          {scans.map((scan) => (
            <div key={scan.id} className="bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <div className="text-xs text-gray-600 font-semibold">{new Date(scan.scanDate).toLocaleDateString()}</div>
                  <div className="text-[10px] uppercase px-2 py-0.5 rounded bg-gray-200 text-gray-600">{scan.source?.toUpperCase() ?? 'POS'}</div>
                </div>
                <div className="text-[10px] inline-flex items-center rounded px-2 py-0.5 font-medium">
                  {scan.status === 'PENDING' && (
                    <span className="bg-amber-100 text-amber-600">PENDING</span>
                  )}
                  {scan.status === 'MAPPED' && (
                    <span className="bg-emerald-600/30 text-emerald-400">MAPPED</span>
                  )}
                  {scan.status === 'SYNCED' && (
                    <span className="bg-emerald-100 text-emerald-600">SYNCED</span>
                  )}
                  {scan.status === 'FAILED' && (
                    <span className="bg-red-600/30 text-red-600">FAILED</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                disabled={loading || activeLoadId === scan.id}
                onClick={() => handleLoad(scan)}
                className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1 rounded disabled:opacity-40"
              >
                {activeLoadId === scan.id ? 'Loading…' : 'Load'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
