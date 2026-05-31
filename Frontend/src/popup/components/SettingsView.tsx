import React, { useState } from 'react';
import { api } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import { useQuickBooks } from '../hooks/useQuickBooks';

interface Props {
  jwt: string;
  onLogout: () => void;
}

export default function SettingsView({ jwt, onLogout }: Props) {
  const { locations, refetch } = useLocations(jwt);
  const { status, connect } = useQuickBooks(jwt);
  const [showAddLoc, setShowAddLoc] = useState(false);
  const [locForm, setLocForm] = useState({ name: '', toastUrl: '' });
  const [locError, setLocError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locForm.name) return;
    try {
      await api.createLocation(jwt, locForm.name, locForm.toastUrl);
      setLocForm({ name: '', toastUrl: '' });
      setShowAddLoc(false);
      await refetch();
    } catch (err) {
      setLocError(err instanceof Error ? err.message : 'Failed to create location');
    }
  };

  const handleDeleteLoc = async (id: string) => {
    if (!confirm('Delete this location and all its data?')) return;
    setDeleting(id);
    try {
      await api.deleteLocation(jwt, id);
      await refetch();
    } catch (err) {
      setLocError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="p-3 space-y-4">
      {/* QuickBooks section */}
      <div>
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">QuickBooks Online</div>
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
          {status.connected && !status.tokenExpired ? (
            <>
              <div className="text-green-400 text-xs mb-1">✅ Connected</div>
              <div className="text-gray-400 text-xs">Company ID: <span className="text-white font-mono">{status.realmId}</span></div>
              {status.expiresAt && (
                <div className="text-gray-600 text-xs mt-1">
                  Expires: {new Date(status.expiresAt).toLocaleString()}
                </div>
              )}
            </>
          ) : status.connected && status.tokenExpired ? (
            <>
              <div className="text-orange-400 text-xs mb-1">⚠️ Token Expired — Reconnect required</div>
              <div className="text-gray-400 text-xs">Company ID: <span className="text-white font-mono">{status.realmId}</span></div>
            </>
          ) : (
            <div className="text-red-400 text-xs mb-2">❌ Not connected to QuickBooks</div>
          )}
          <button
            onClick={connect}
            className={`mt-2 w-full py-2 text-xs font-semibold rounded-lg transition-colors ${
              status.tokenExpired
                ? 'bg-orange-700 hover:bg-orange-600 text-white'
                : status.connected
                  ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                  : 'bg-cyan-700 hover:bg-cyan-600 text-white'
            }`}
          >
            {status.connected ? '↻ Reconnect to QuickBooks' : '🔗 Connect to QuickBooks'}
          </button>
        </div>
      </div>

      {/* Locations section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Locations</div>
          <button
            onClick={() => setShowAddLoc(!showAddLoc)}
            className="text-xs text-cyan-400 hover:text-cyan-300"
          >
            + Add
          </button>
        </div>

        {locError && <p className="text-red-400 text-xs mb-2">{locError}</p>}

        {showAddLoc && (
          <form onSubmit={handleAddLocation} className="bg-gray-800 border border-gray-600 rounded-lg p-3 mb-2 space-y-2">
            <input
              value={locForm.name}
              onChange={(e) => setLocForm({ ...locForm, name: e.target.value })}
              placeholder="Location name"
              className="w-full bg-gray-900 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-cyan-500 focus:outline-none"
              required
            />
            <input
              value={locForm.toastUrl}
              onChange={(e) => setLocForm({ ...locForm, toastUrl: e.target.value })}
              placeholder="Toast URL (optional)"
              className="w-full bg-gray-900 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-cyan-500 focus:outline-none"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowAddLoc(false)} className="text-xs text-gray-500 px-2 py-1">Cancel</button>
              <button type="submit" className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-3 py-1 rounded">Save</button>
            </div>
          </form>
        )}

        <div className="space-y-1">
          {locations.length === 0 ? (
            <p className="text-gray-600 text-xs">No locations. Add one above.</p>
          ) : (
            locations.map((l) => (
              <div key={l.id} className="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
                <div>
                  <div className="text-white text-xs">{l.name}</div>
                  {l.toastUrl && <div className="text-gray-500 text-xs truncate max-w-48">{l.toastUrl}</div>}
                </div>
                <button
                  onClick={() => void handleDeleteLoc(l.id)}
                  disabled={deleting === l.id}
                  className="text-gray-600 hover:text-red-400 text-xs ml-2"
                >
                  {deleting === l.id ? '…' : '✕'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Account section */}
      <div>
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Account</div>
        <button
          onClick={onLogout}
          className="w-full py-2 text-xs text-red-400 border border-red-800 hover:bg-red-900/20 rounded-lg transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-700/60" />

      {/* About Nest */}
      <div>
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">About Nest</div>

        {/* Branding card */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 mb-3 flex items-center gap-3">
          <span className="text-3xl leading-none">🪹</span>
          <div>
            <div className="text-white font-bold text-sm">Nest</div>
            <div className="text-gray-400 text-xs">Version 1.0.0</div>
            <div className="text-gray-500 text-xs mt-0.5">Bridge between POS and QuickBooks</div>
          </div>
        </div>

        {/* Creator card */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-800/60 border border-gray-700 rounded-lg p-3 mb-3">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Created By</div>
          <div className="text-white text-sm font-medium">John Paul O. Escuadra</div>
          <div className="text-gray-500 text-xs mt-1 leading-relaxed">
            John Paul is a full-stack developer specializing in restaurant technology and financial integrations.
            Nest was built to solve the real-world challenge of bridging POS sales data with QuickBooks accounting,
            making daily bookkeeping effortless for restaurant teams.
          </div>
        </div>

        {/* Support card */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 mb-3">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Need Help?</div>
          <a
            href="mailto:paulescuadra25@gmail.com"
            className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 text-xs transition-colors mb-2"
          >
            <span>✉️</span>
            <span>paulescuadra25@gmail.com</span>
          </a>
          <div className="flex gap-2">
            <a
              href="mailto:paulescuadra25@gmail.com?subject=Nest%20Bug%20Report"
              className="flex-1 text-center text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white py-1.5 rounded transition-colors"
            >
              🐛 Report a Bug
            </a>
            <a
              href="mailto:paulescuadra25@gmail.com?subject=Nest%20Feature%20Request"
              className="flex-1 text-center text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white py-1.5 rounded transition-colors"
            >
              💡 Feature Request
            </a>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-600">Made with ❤️ in the Philippines</p>
      </div>
    </div>
  );
}
