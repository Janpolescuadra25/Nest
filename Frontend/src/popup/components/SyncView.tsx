import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import type { ScanRecord } from '../../types';

interface Props {
  jwt: string;
  selectedLocationId: string;
  onLocationChange: (id: string) => void;
}

const STATUS_CLASSES: Record<string, string> = {
  SYNCED: 'text-green-400 bg-green-900/30 border-green-800',
  FAILED: 'text-red-400 bg-red-900/30 border-red-800',
  PENDING: 'text-yellow-400 bg-yellow-900/30 border-yellow-800',
  MAPPED: 'text-blue-400 bg-blue-900/30 border-blue-800',
};

export default function SyncView({ jwt, selectedLocationId, onLocationChange }: Props) {
  const { locations } = useLocations(jwt);
  const locationId = selectedLocationId || locations[0]?.id || '';
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId) return;
    setLoading(true);
    setError(null);
    api.getScans(jwt, locationId)
      .then((data) => setScans(data as ScanRecord[]))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sync history'))
      .finally(() => setLoading(false));
  }, [jwt, locationId]);

  const totalSynced = scans.filter((s) => s.status === 'SYNCED').length;
  const totalFailed = scans.filter((s) => s.status === 'FAILED').length;
  const totalPending = scans.filter((s) => s.status === 'PENDING' || s.status === 'MAPPED').length;

  return (
    <div className="p-3 space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-white">{scans.length}</div>
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 flex-shrink-0">📍 Location:</span>
          <select
            className="flex-1 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
            value={locationId}
            onChange={(e) => onLocationChange(e.target.value)}
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
        ) : scans.length === 0 ? (
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
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => {
                  const syncLog = scan.syncLogs?.[0];
                  return (
                    <tr key={scan.id} className="border-t border-gray-700/50 hover:bg-gray-700/20">
                      <td className="px-3 py-2 text-gray-200 font-mono">{scan.scanDate}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded border text-xs ${STATUS_CLASSES[scan.status] ?? 'text-gray-400'}`}>
                          {scan.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-400">
                        {syncLog?.qbJournalEntryId ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {new Date(scan.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
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
    </div>
  );
}
