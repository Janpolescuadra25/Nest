import type { QBStatus } from '../../types';

interface QBConnectionCardProps {
  qbStatus: QBStatus;
}

export function QBConnectionCard({ qbStatus }: QBConnectionCardProps) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-1">
      <h3 className="text-sm font-medium text-cyan-300">QuickBooks Connection</h3>
      {qbStatus.connected ? (
        <>
          <p className="text-sm text-green-400">✅ Connected · Company ID: {qbStatus.realmId ?? '-'}</p>
          <p className="text-xs text-gray-400">Token expires: {qbStatus.expiresAt ? new Date(qbStatus.expiresAt).toLocaleString() : '-'}</p>
        </>
      ) : (
        <p className="text-sm text-yellow-400">⚠ Not connected</p>
      )}
    </div>
  );
}
