import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

interface AdminRequest {
  id: string;
  email: string;
  name: string | null;
  description: string | null;
  company: string | null;
  status: string;
  createdAt: string;
  approvedBy?: { id: string; name: string | null } | null;
}

interface ApproveResult {
  user: { id: string; email: string; name: string | null; role: string };
  tempPassword: string;
}

interface Props {
  jwt: string;
}

export default function RequestsTab({ jwt }: Props) {
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [approveResult, setApproveResult] = useState<ApproveResult | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getAdminRequests(jwt, 1, statusFilter || undefined);
      setRequests(data.requests);
    } catch (err: any) {
      setError(err.message || 'Failed to load requests.');
    } finally {
      setLoading(false);
    }
  }, [jwt, statusFilter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleApprove = async (id: string) => {
    setActionLoading(p => ({ ...p, [id]: true }));
    try {
      const result = await api.approveAdminRequest(jwt, id);
      setApproveResult(result);
      await fetchRequests();
    } catch (err: any) {
      setError(err.message || 'Failed to approve request.');
    } finally {
      setActionLoading(p => ({ ...p, [id]: false }));
    }
  };

  const handleReject = async (id: string) => {
    setActionLoading(p => ({ ...p, [`r_${id}`]: true }));
    try {
      await api.rejectAdminRequest(jwt, id);
      await fetchRequests();
    } catch (err: any) {
      setError(err.message || 'Failed to reject request.');
    } finally {
      setActionLoading(p => ({ ...p, [`r_${id}`]: false }));
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-white">Partner Requests</h2>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-gray-300 focus:outline-none"
        >
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </select>
      </div>

      {approveResult && (
        <div className="bg-green-900/40 border border-green-700 rounded-lg p-3 text-sm">
          <p className="text-green-400 font-medium">Partner approved!</p>
          <p className="text-gray-300 text-xs mt-1">Email: <span className="font-mono">{approveResult.user.email}</span></p>
          <p className="text-gray-300 text-xs">Temp password: <span className="font-mono text-yellow-400">{approveResult.tempPassword}</span></p>
          <p className="text-gray-500 text-xs mt-1">Share this password securely — they'll be prompted to change it on first login.</p>
          <button onClick={() => setApproveResult(null)} className="mt-2 text-xs text-gray-400 hover:text-gray-300">Dismiss</button>
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="text-gray-500 text-sm">No {statusFilter.toLowerCase() || ''} requests.</p>
      ) : (
        requests.map(req => (
          <div key={req.id} className="bg-slate-800 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">{req.name ?? req.email}</div>
                {req.name && <div className="text-xs text-gray-400 truncate">{req.email}</div>}
                {req.company && <div className="text-xs text-gray-500">{req.company}</div>}
                <div className="text-xs text-gray-500">{new Date(req.createdAt).toLocaleDateString()}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  req.status === 'PENDING' ? 'bg-yellow-900 text-yellow-400' :
                  req.status === 'APPROVED' ? 'bg-green-900 text-green-400' :
                  'bg-red-900 text-red-400'
                }`}>{req.status}</span>
                <button onClick={() => setExpandedId(expandedId === req.id ? null : req.id)} className="text-gray-500 hover:text-gray-300 text-xs">
                  {expandedId === req.id ? '▲' : '▼'}
                </button>
              </div>
            </div>
            {expandedId === req.id && (
              <div className="pt-2 border-t border-slate-700 space-y-2">
                {req.description && (
                  <p className="text-xs text-gray-400 italic">"{req.description}"</p>
                )}
                {req.status === 'PENDING' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(req.id)}
                      disabled={actionLoading[req.id]}
                      className="flex-1 py-1.5 bg-green-800 text-green-200 rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                      {actionLoading[req.id] ? '...' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleReject(req.id)}
                      disabled={actionLoading[`r_${req.id}`]}
                      className="flex-1 py-1.5 bg-red-900 text-red-300 rounded text-xs font-medium hover:bg-red-800 disabled:opacity-50"
                    >
                      {actionLoading[`r_${req.id}`] ? '...' : 'Reject'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
