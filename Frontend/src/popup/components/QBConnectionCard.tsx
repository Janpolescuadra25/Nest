import { useState } from 'react';
import { ConfirmDialog } from './shared';
import type { QBStatus } from '../../types';

interface QBConnectionCardProps {
  qbStatus: QBStatus;
  onReconnect?: () => void;
  onDisconnect?: () => void;
}

export function QBConnectionCard({ qbStatus, onReconnect, onDisconnect }: QBConnectionCardProps) {
  const isExpired = !qbStatus.connected && (qbStatus.reason === 'token_expired' || qbStatus.tokenExpired);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-1">
      <h3 className="text-sm font-medium text-emerald-300">QuickBooks Connection</h3>
      {qbStatus.connected ? (
        <>
          <p className="text-sm text-green-400">✅ Connected · Company ID: {qbStatus.realmId ?? '-'}</p>
          <p className="text-xs text-gray-400">Token expires: {qbStatus.expiresAt ? new Date(qbStatus.expiresAt).toLocaleString() : '-'}</p>
          {onDisconnect && (
            <>
              <button
                type="button"
                onClick={() => setShowDisconnectDialog(true)}
                className="mt-1 text-xs bg-slate-700 hover:bg-slate-600 text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 px-3 py-1 rounded transition-colors"
              >
                Disconnect
              </button>
              <ConfirmDialog
                open={showDisconnectDialog}
                title="Disconnect QuickBooks"
                message="Disconnect QuickBooks? You'll need to reconnect to sync data."
                confirmText="Disconnect"
                cancelText="Cancel"
                onConfirm={() => {
                  setShowDisconnectDialog(false);
                  onDisconnect();
                }}
                onCancel={() => setShowDisconnectDialog(false)}
                variant="danger"
              />
            </>
          )}
        </>
      ) : isExpired ? (
        <>
          <p className="text-sm text-orange-400">⚠️ Connection Expired — Reconnect Required</p>
          {qbStatus.realmId && <p className="text-xs text-gray-400">Previously connected to Company ID: {qbStatus.realmId}</p>}
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
        <>
          <p className="text-sm text-red-400">❌ Not connected</p>
          {onReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              className="mt-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1 rounded"
            >
              Connect QuickBooks
            </button>
          )}
        </>
      )}
    </div>
  );
}
