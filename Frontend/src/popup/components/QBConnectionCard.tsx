import type { QBStatus } from '../../types';

interface QBConnectionCardProps {
  qbStatus: QBStatus;
  onReconnect?: () => void;
}

export function QBConnectionCard({ qbStatus, onReconnect }: QBConnectionCardProps) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-1">
      <h3 className="text-sm font-medium text-cyan-300">QuickBooks Connection</h3>
      {qbStatus.connected && !qbStatus.tokenExpired ? (
        <>
          <p className="text-sm text-green-400">✅ Connected · Company ID: {qbStatus.realmId ?? '-'}</p>
          <p className="text-xs text-gray-400">Token expires: {qbStatus.expiresAt ? new Date(qbStatus.expiresAt).toLocaleString() : '-'}</p>
        </>
      ) : qbStatus.connected && qbStatus.tokenExpired ? (
        <>
          <p className="text-sm text-orange-400">⚠️ Token Expired — Reconnect</p>
          <p className="text-xs text-gray-400">Company ID: {qbStatus.realmId ?? '-'}</p>
          {onReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              className="mt-1 text-xs bg-orange-700 hover:bg-orange-600 text-white px-3 py-1 rounded"
            >
              ↻ Reconnect to QuickBooks
            </button>
          )}
        </>
      ) : (
        <p className="text-sm text-red-400">❌ Not connected</p>
      )}
    </div>
  );
}
