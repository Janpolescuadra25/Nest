import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
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
  ADMIN_APPROVED: 'bg-green-900 text-green-400',
  ADMIN_REJECTED: 'bg-red-900 text-red-400',
  ADMIN_UPDATED: 'bg-yellow-900 text-yellow-400',
  USER_INVITED: 'bg-blue-900 text-blue-400',
  ROLE_CHANGED: 'bg-purple-900 text-purple-400',
  PERMISSION_UPDATED: 'bg-emerald-900 text-emerald-400',
  TIMEBOMB_SET: 'bg-orange-900 text-orange-400',
  USER_STATUS_CHANGED: 'bg-yellow-900 text-yellow-400',
  USER_DISABLED: 'bg-red-900 text-red-400',
};


export default function ActivityTab({ jwt }: Props) {
  const [logs, setLogs] = useState<OwnerAuditLogEntry[]>([]);;
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  const totalPages = Math.ceil(total / LIMIT);
  const startIdx = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIdx = Math.min(page * LIMIT, total);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Activity Log</h2>
        <span className="text-xs text-gray-500">{total} entries</span>
      </div>

      {/* Filters */}
      <div className="bg-slate-800 rounded-lg p-3 space-y-2">
        <div className="flex gap-2 flex-wrap">
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="flex-1 min-w-[120px] px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-gray-300 focus:outline-none"
          >
            <option value="">All Actions</option>
            {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button
            onClick={handleClearFilters}
            className="px-2 py-1 bg-slate-700 text-gray-400 rounded text-xs hover:bg-slate-600"
          >
            Clear
          </button>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-0.5">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-gray-300 focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-0.5">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-gray-300 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-gray-500 text-sm">Loading…</div>
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">No activity yet.</div>
      ) : (
        <div className="space-y-2">
          {logs.map(log => {
            const actionColor = ACTION_COLORS[log.action] ?? 'bg-slate-700 text-gray-300';
            const isExpanded = expandedId === log.id;
            return (
              <div key={log.id} className="bg-slate-800 rounded-lg p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {/* Action badge */}
                    <span className={`inline-block text-xs px-1.5 py-0.5 rounded font-medium ${actionColor}`}>
                      {log.action}
                    </span>

                    {/* Actor */}
                    <div className="mt-1 text-xs text-gray-400">
                      <span className="text-green-400">{log.actor.name ?? log.actor.email}</span>
                      {log.actor.name && <span className="text-gray-600 ml-1">({log.actor.email})</span>}
                    </div>

                    {/* Target */}
                    {log.target ? (
                      <div className="text-xs text-gray-500">
                        → <span className="text-blue-400">{log.target.name ?? log.target.email}</span>
                        {log.target.name && <span className="text-gray-600 ml-1">({log.target.email})</span>}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-600">→ —</div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-gray-500">{relativeTime(log.createdAt)}</span>
                    {log.meta && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                        className="text-xs text-gray-500 hover:text-gray-300"
                      >
                        {isExpanded ? '▲ hide' : '▼ details'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded meta */}
                {isExpanded && log.meta && (
                  <div className="pt-1.5 border-t border-slate-700">
                    <pre className="text-xs text-gray-400 bg-slate-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
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
          <span className="text-xs text-gray-500">
            {startIdx}–{endIdx} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => fetchLogs(page - 1)}
              disabled={page <= 1 || loading}
              className="px-2 py-1 bg-slate-700 text-gray-400 rounded text-xs hover:bg-slate-600 disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              onClick={() => fetchLogs(page + 1)}
              disabled={page >= totalPages || loading}
              className="px-2 py-1 bg-slate-700 text-gray-400 rounded text-xs hover:bg-slate-600 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
