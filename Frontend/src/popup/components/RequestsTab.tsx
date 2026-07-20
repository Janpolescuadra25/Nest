import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';
import type { AdminRequest } from '../../types';

interface ApproveResult {
  user: { id: string; email: string; name: string | null; role: string };
  emailWarning?: string;
}

interface Props {
  jwt: string;
}

export default function RequestsTab({ jwt }: Props) {
  const { showToast } = useToast();
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [approveResult, setApproveResult] = useState<ApproveResult | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [poolInputs, setPoolInputs] = useState<Record<string, { poolScans: string; poolLocations: string; maxMembers: string }>>({});

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
      const pool = poolInputs[id] ?? { poolScans: '200', poolLocations: '50', maxMembers: '5' };
      const result = await api.approveAdminRequest(jwt, id, {
        poolScans: parseInt(pool.poolScans, 10) || 200,
        poolLocations: parseInt(pool.poolLocations, 10) || 50,
        maxMembers: parseInt(pool.maxMembers, 10) || 5,
      });
      setApproveResult(result);
      await fetchRequests();
      showToast('Partner approved', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to approve request.');
      showToast('Action failed', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [id]: false }));
    }
  };

  const handleReject = async (id: string) => {
    setActionLoading(p => ({ ...p, [`r_${id}`]: true }));
    try {
      await api.rejectAdminRequest(jwt, id);
      await fetchRequests();
      showToast('Request rejected', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to reject request.');
      showToast('Action failed', 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`r_${id}`]: false }));
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-gray-900">Partner Requests</h2>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-xs bg-gray-200 border border-gray-300 rounded px-2 py-1 text-gray-600 focus:outline-none"
        >
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </select>
      </div>

      {approveResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
          <p className="text-emerald-600 font-medium">Partner approved!</p>
          <p className="text-gray-600 text-xs mt-1">Email: <span className="font-mono">{approveResult.user.email}</span></p>
          {approveResult.emailWarning ? (
            <p className="text-amber-600 text-xs mt-1">{approveResult.emailWarning}</p>
          ) : (
            <p className="text-gray-600 text-xs mt-1">A welcome email was sent to the partner with login instructions.</p>
          )}
          <button onClick={() => setApproveResult(null)} className="mt-2 text-xs text-gray-600 hover:text-gray-600">Dismiss</button>
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {loading ? (
        <p className="text-gray-600 text-sm">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="text-gray-600 text-sm">No {statusFilter.toLowerCase() || ''} requests.</p>
      ) : (
        requests.map(req => (
          <div key={req.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{req.name ?? req.email}</div>
                {req.name && <div className="text-xs text-gray-600 truncate">{req.email}</div>}
                {req.company && <div className="text-xs text-gray-600">{req.company}</div>}
                <div className="text-xs text-gray-600">{new Date(req.createdAt).toLocaleDateString()}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  req.status === 'PENDING' ? 'bg-amber-50 text-amber-600' :
                  req.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-600' :
                  'bg-red-50 text-red-600'
                }`}>{req.status}</span>
                <button onClick={() => setExpandedId(expandedId === req.id ? null : req.id)} className="text-gray-600 hover:text-gray-600 text-xs">
                  {expandedId === req.id ? '▲' : '▼'}
                </button>
              </div>
            </div>
            {expandedId === req.id && (
              <div className="pt-2 border-t border-gray-200 space-y-2">
                {req.description && (
                  <p className="text-xs text-gray-600 italic">"{req.description}"</p>
                )}
                {req.status === 'PENDING' && (
                  <>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <p className="text-xs text-gray-600 mb-1">Scans</p>
                        <input
                          type="number"
                          min={0}
                          value={poolInputs[req.id]?.poolScans ?? '200'}
                          onChange={e => setPoolInputs(p => ({ ...p, [req.id]: { ...(p[req.id] ?? { poolLocations: '50', maxMembers: '5' }), poolScans: e.target.value } }))}
                          className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1 w-full"
                        />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-gray-600 mb-1">Locations</p>
                        <input
                          type="number"
                          min={0}
                          value={poolInputs[req.id]?.poolLocations ?? '50'}
                          onChange={e => setPoolInputs(p => ({ ...p, [req.id]: { ...(p[req.id] ?? { poolScans: '200', maxMembers: '5' }), poolLocations: e.target.value } }))}
                          className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1 w-full"
                        />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-gray-600 mb-1">Members</p>
                        <input
                          type="number"
                          min={0}
                          value={poolInputs[req.id]?.maxMembers ?? '5'}
                          onChange={e => setPoolInputs(p => ({ ...p, [req.id]: { ...(p[req.id] ?? { poolScans: '200', poolLocations: '50' }), maxMembers: e.target.value } }))}
                          className="bg-gray-200 border border-gray-300 rounded text-xs text-gray-900 p-1 w-full"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(req.id)}
                        disabled={actionLoading[req.id]}
                        className="flex-1 py-1.5 bg-emerald-600 text-emerald-700 rounded text-xs font-medium hover:bg-emerald-600 disabled:opacity-50"
                      >
                        {actionLoading[req.id] ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleReject(req.id)}
                        disabled={actionLoading[`r_${req.id}`]}
                        className="flex-1 py-1.5 bg-red-50 text-red-600 rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                      >
                        {actionLoading[`r_${req.id}`] ? 'Rejecting...' : 'Reject'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
