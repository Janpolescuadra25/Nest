import React, { useEffect, useState } from 'react';
import type { ScanData } from '../../types';

interface Props {
  jwt: string;
  scanData: ScanData | null;
  onScanData: (data: ScanData) => void;
}

export default function ScanView({ jwt: _jwt, scanData, onScanData }: Props) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabUrl, setTabUrl] = useState<string>('');

  // Load cached scan data and current tab URL on mount
  useEffect(() => {
    chrome.storage.local.get(['lastScanData'], (result) => {
      if (result['lastScanData'] && !scanData) {
        onScanData(result['lastScanData'] as ScanData);
      }
    });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) setTabUrl(tabs[0].url);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isToastTab = tabUrl.includes('toasttab.com');

  const handleRescan = async () => {
    setScanning(true);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      if (!tab.url?.includes('toasttab.com')) {
        throw new Error('Navigate to a Toast POS page to scan');
      }

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_SCAN' }) as { data?: ScanData };
      if (response?.data) {
        onScanData(response.data);
        chrome.storage.local.set({ lastScanData: response.data });
      } else {
        throw new Error('No data returned from scanner');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="p-3">
      {/* Status bar */}
      <div className="flex items-center justify-between mb-3">
        <div className={`text-xs px-2 py-1 rounded-full ${
          isToastTab ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'
        }`}>
          {isToastTab ? '🟢 Toast page detected' : '⚪ Not on Toast page'}
        </div>
        <button
          onClick={handleRescan}
          disabled={scanning}
          className="text-xs bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white px-3 py-1 rounded-lg transition-colors"
        >
          {scanning ? 'Scanning…' : '↻ Re-scan Page'}
        </button>
      </div>

      {error && (
        <div className="mb-3 bg-red-900/40 border border-red-700 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {scanData ? (
        <>
          <div className="text-xs text-gray-500 mb-2">Extracted Toast fields</div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left text-xs text-gray-500 px-3 py-2">Field</th>
                  <th className="text-right text-xs text-gray-500 px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(scanData).map(([field, amount]) => (
                  <tr key={field} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="px-3 py-2 text-gray-300 text-xs">{field}</td>
                    <td className="px-3 py-2 text-white text-xs text-right font-mono">
                      ${Number(amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-700/40">
                  <td className="px-3 py-2 text-xs text-gray-400 font-medium">Total</td>
                  <td className="px-3 py-2 text-xs text-cyan-400 text-right font-mono font-bold">
                    ${Object.values(scanData).reduce((s, v) => s + v, 0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-3xl mb-3">🍽️</div>
          <p className="text-gray-400 text-sm">No scan data yet</p>
          <p className="text-gray-600 text-xs mt-1">
            Navigate to a Toast report page, then click Re-scan Page
          </p>
        </div>
      )}
    </div>
  );
}
