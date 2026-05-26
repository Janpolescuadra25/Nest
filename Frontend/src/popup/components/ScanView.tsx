import React, { useEffect, useState } from 'react';
import type { ScanData } from '../../types';
import { api } from '../lib/api';

interface Props {
  jwt: string;
  scanData: ScanData | null;
  onScanData: (data: ScanData) => void;
  locationId: string | null;
}

export default function ScanView({ jwt, scanData, onScanData, locationId }: Props) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabUrl, setTabUrl] = useState<string>('');

  // Load cached scan data and current tab URL on mount
  useEffect(() => {
    chrome.storage.local.get(['lastScanData'], (result) => {
      const cached = result['lastScanData'] as ScanData | undefined;
      if (cached) {
        // If cached data has old mock keys, clear it
        if ('Food Sales' in cached || 'Beverage Sales' in cached) {
          chrome.storage.local.remove(['lastScanData']);
          console.log('[Nest] Cleared stale cached scan data (old mock format)');
          return;
        }
        if (!scanData) onScanData(cached);
      }
    });
    // Search for Toast tabs across ALL windows (popup is in a floating window)
    chrome.tabs.query({ url: '*://*.toasttab.com/*' }, (tabs) => {
      if (tabs[0]?.url) setTabUrl(tabs[0].url);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isToastTab = tabUrl.includes('toasttab.com');

  /** Send REQUEST_SCAN to a tab and return the response (or null on failure). */
  const sendScanMessage = (tabId: number): Promise<{ data?: ScanData } | null> => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[Nest Popup] Scan timed out for tab', tabId);
        resolve(null);
      }, 10000);

      chrome.tabs.sendMessage(tabId, { type: 'REQUEST_SCAN' }, (resp) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          console.warn('[Nest Popup] sendMessage error:', chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });
  };

  const handleRescan = async () => {
    setScanning(true);
    setError(null);
    try {
      // Query specifically for Toast tabs across ALL windows (popup is in a floating window)
      const toastTabs = await chrome.tabs.query({ url: "*://*.toasttab.com/*" });
      const tab = toastTabs[0];
      console.log('[Nest Popup] Scan triggered — found Toast tab:', tab?.id, 'url:', tab?.url);
      if (!tab?.id) throw new Error('No Toast tab found — navigate to a Toast POS page first');

      // Try sending the scan message
      let response = await sendScanMessage(tab.id);

      // If content script isn't injected yet, inject it and retry
      if (!response) {
        console.log('[Nest Popup] Content script not responding — injecting scanner into tab', tab.id);
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/scanner.js']
          });
          // Wait a moment for the script to initialize
          await new Promise(r => setTimeout(r, 500));
          console.log('[Nest Popup] Scanner injected — retrying scan...');
          response = await sendScanMessage(tab.id);
        } catch (injectErr) {
          console.error('[Nest Popup] Failed to inject content script:', injectErr);
          throw new Error('Could not inject scanner into Toast tab — try refreshing the page');
        }
      }

      console.log('[Nest Popup] Response from content script:', response,
        response?.data ? `| keys: ${Object.keys(response.data).length}` : '| no data');
      if (response?.data) {
        onScanData(response.data);
        chrome.storage.local.set({ lastScanData: response.data });
        if (locationId) {
          try {
            await api.saveScan(
              jwt,
              locationId,
              new Date().toISOString().split('T')[0],
              response.data
            );
            console.log('[Nest] Scan data saved to backend');
          } catch (saveErr) {
            console.error('[Nest] Failed to save scan to backend:', saveErr);
            // Don't block the UI — scan still worked locally
          }
        }
      } else {
        throw new Error('No data returned from scanner — try refreshing the Toast page');
      }
    } catch (err) {
      console.error('[Nest Popup] Scan error:', err);
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
          <div className="text-xs text-gray-500 mb-2">Extracted Toast fields ({Object.keys(scanData).length})</div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left text-xs text-gray-500 px-3 py-2">Field</th>
                  <th className="text-right text-xs text-gray-500 px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(scanData).map(([field, value]) => (
                  <tr key={field} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="px-3 py-2 text-gray-300 text-xs">{field}</td>
                    <td className="px-3 py-2 text-white text-xs text-right font-mono">
                      {field.includes('Count')
                        ? String(value)
                        : `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-700/40">
                  <td className="px-3 py-2 text-xs text-gray-400 font-medium">Total</td>
                  <td className="px-3 py-2 text-xs text-cyan-400 text-right font-mono font-bold">
                    ${Object.entries(scanData)
                      .filter(([key]) => !key.includes('Count'))
                      .reduce((sum, [, v]) => sum + v, 0)
                      .toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
