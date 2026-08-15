import React, { useState, useEffect, useCallback } from 'react';
import { api, downloadCSV } from '../lib/api';
import { relativeTime } from '../lib/utils';
import type { OwnerAuditLogEntry } from '../../types';

interface Props {
  jwt: string;
}

const ACTION_OPTIONS = [
  'ADMIN_APPROVED',
  'ADMIN_REJECTED',
  'ADMIN_UPDATED',
  'USER_INVITED',
  'ROLE_CHANGED',
  'PERMISSION_UPDATED',
  'TIMEBOMB_SET',
  'USER_STATUS_CHANGED',
  'USER_DISABLED',
];

const ACTION_COLORS: Record<string, string> = {
  ADMIN_APPROVED: 'bg-emerald-50 text-emerald-600',
  ADMIN_REJECTED: 'bg-red-50 text-red-600',
  ADMIN_UPDATED: 'bg-amber-50 text-amber-600',
  USER_INVITED: 'bg-emerald-50 text-emerald-400',
  ROLE_CHANGED: 'bg-gray-200 text-gray-600',
  PERMISSION_UPDATED: 'bg-emerald-50 text-emerald-400',
  TIMEBOMB_SET: 'bg-orange-50 text-orange-400',
  USER_STATUS_CHANGED: 'bg-amber-50 text-amber-600',
  USER_DISABLED: 'bg-red-50 text-red-600',
};


export default function ActivityTab({ jwt }: Props) {
  const [logs, setLogs] = useState<OwnerAuditLogEntry[]>([]);;
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const LIMIT = 25;

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const params: Parameters<typeof api.getAuditLog>[1] = { page: p, limit: LIMIT };
      if (actionFilter) params.action = actionFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const data = await api.getAuditLog(jwt, params);
      setLogs(data.logs);
      setTotal(data.total);
      setPage(data.page);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load activity.');
    } finally {
      setLoading(false);
    }
  }, [jwt, actionFilter, dateFrom, dateTo]);

  useEffect(() => { fetchLogs(1); }, [fetchLogs]);

  const handleClearFilters = () => {
    setActionFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (actionFilter) params.set('action', actionFilter);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const qs = params.toString();
      await downloadCSV(jwt, `/api/exports/audit-logs${qs ? '?' + qs : ''}`, 'audit-logs-export.csv');
    } catch (err) {
      console.error('[ActivityTab] Export failed', err);
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / LIMIT);
  const startIdx = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIdx = Math.min(page * LIMIT, total);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Activity Log</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={exporting || loading}
            onClick={handleExport}
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded disabled:opacity-40"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <span className="text-xs text-gray-600">{total} entries</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
        <div className="flex gap-2 flex-wrap">
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="flex-1 min-w-[120px] px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-600 focus:outline-none"
          >
            <option value="">All Actions</option>
            {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button
            onClick={handleClearFilters}
            className="px-2 py-1 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300"
          >
            Clear
          </button>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs text-gray-600 mb-0.5">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-600 focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-600 mb-0.5">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full px-2 py-1 bg-gray-200 border border-gray-300 rounded text-xs text-gray-600 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-gray-600 text-sm">Loading…</div>
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8 text-gray-600 text-sm">No activity yet.</div>
      ) : (
        <div className="space-y-2">
          {logs.map(log => {
            const actionColor = ACTION_COLORS[log.action] ?? 'bg-gray-200 text-gray-600';
            const isExpanded = expandedId === log.id;
            return (
              <div key={log.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {/* Action badge */}
                    <span className={`inline-block text-xs px-1.5 py-0.5 rounded font-medium ${actionColor}`}>
                      {log.action}
                    </span>

                    {/* Actor */}
                    <div className="mt-1 text-xs text-gray-600">
                      <span className="text-emerald-600">{log.actor.name ?? log.actor.email}</span>
                      {log.actor.name && <span className="text-gray-600 ml-1">({log.actor.email})</span>}
                    </div>

                    {/* Target */}
                    {log.target ? (
                      <div className="text-xs text-gray-600">
                        → <span className="text-emerald-400">{log.target.name ?? log.target.email}</span>
                        {log.target.name && <span className="text-gray-600 ml-1">({log.target.email})</span>}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-600">→ —</div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-gray-600">{relativeTime(log.createdAt)}</span>
                    {log.meta && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                        className="text-xs text-gray-600 hover:text-gray-600"
                      >
                        {isExpanded ? '▲ hide' : '▼ details'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded meta */}
                {isExpanded && log.meta && (
                  <div className="pt-1.5 border-t border-gray-200">
                    <pre className="text-xs text-gray-600 bg-gray-50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(log.meta, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-gray-600">
            {startIdx}–{endIdx} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => fetchLogs(page - 1)}
              disabled={page <= 1 || loading}
              className="px-2 py-1 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300 disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              onClick={() => fetchLogs(page + 1)}
              disabled={page >= totalPages || loading}
              className="px-2 py-1 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
