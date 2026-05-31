import React, { useEffect, useState } from 'react';
import type { ScanData } from '../../types';
import { api } from '../lib/api';

const POS_URLS: Record<string, { pattern: RegExp; name: string }> = {
  toast: { pattern: /toasttab\.com/, name: 'Toast' },
  salido: { pattern: /salido\.com/, name: 'SALIDO' },
};

async function findPOSTab(): Promise<{ tab: chrome.tabs.Tab; posType: string; posName: string } | null> {
  const allTabs = await chrome.tabs.query({});
  for (const [posType, { pattern, name }] of Object.entries(POS_URLS)) {
    const tab = allTabs.find(t => t.url && pattern.test(t.url));
    if (tab) return { tab, posType, posName: name };
  }
  return null;
}

interface Props {
  jwt: string;
  scanData: ScanData | null;
  onScanData: (data: ScanData) => void;
  onClearScanData: () => void;
  onScanRecordId?: (id: string) => void;
  locationId: string | null;
}

export default function ScanView({ jwt, scanData, onScanData, onClearScanData, onScanRecordId, locationId }: Props) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedPOS, setDetectedPOS] = useState<{ type: string; name: string } | null>(null);

  // Load cached scan data and detect POS tab on mount
  useEffect(() => {
    chrome.storage.local.get(['lastScanData'], (result) => {
      const cached = result['lastScanData'] as ScanData | undefined;
      if (cached) {
        if ('Food Sales' in cached || 'Beverage Sales' in cached) {
          chrome.storage.local.remove(['lastScanData']);
          console.log('[Nest] Cleared stale cached scan data (old mock format)');
          return;
        }
        if (!scanData) onScanData(cached);
      }
    });
    findPOSTab().then(result => {
      if (result) setDetectedPOS({ type: result.posType, name: result.posName });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleClear = () => {
    onClearScanData();
    chrome.storage.local.remove(['lastScanData']);
  };

  const handleRescan = async () => {
    setScanning(true);
    setError(null);
    try {
      // Find any open POS tab across ALL windows
      const posResult = await findPOSTab();
      const tab = posResult?.tab;
      const posType = posResult?.posType ?? 'toast';
      const posName = posResult?.posName ?? 'POS';
      console.log(`[Nest Popup] Scan triggered — found ${posName} tab:`, tab?.id, 'url:', tab?.url);
      if (!tab?.id) throw new Error('No POS report tab found — open a supported POS report page');

      // Try sending the scan message
      let response = await sendScanMessage(tab.id);

      // If content script isn't injected yet, inject it and retry
      if (!response) {
        const scriptFile = posType === 'salido'
          ? 'content/salido-scanner.js'
          : 'content/scanner.js';
        console.log('[Nest Popup] Content script not responding — injecting scanner into tab', tab.id);
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [scriptFile],
          });
          await new Promise(r => setTimeout(r, 1500));
          console.log('[Nest Popup] Scanner injected — retrying scan...');
          response = await sendScanMessage(tab.id);
        } catch (injectErr) {
          console.error('[Nest Popup] Failed to inject content script:', injectErr);
          throw new Error('Could not inject scanner into tab — try refreshing the page');
        }
      }

      console.log('[Nest Popup] Response from content script:', response,
        response?.data ? `| keys: ${Object.keys(response.data).length}` : '| no data');
      if (response?.data) {
        onScanData(response.data);
        chrome.storage.local.set({ lastScanData: response.data });
        if (locationId) {
          try {
            const scanRecord = await api.saveScan(
              jwt,
              locationId,
              new Date().toISOString().split('T')[0],
              response.data
            );
            console.log('[Nest] Scan data saved to backend');
            if (scanRecord?.id && onScanRecordId) {
              onScanRecordId(scanRecord.id);
            }
          } catch (saveErr) {
            console.error('[Nest] Failed to save scan to backend:', saveErr);
            // Don't block the UI — scan still worked locally
          }
        }
      } else {
        throw new Error('No data returned from scanner — try refreshing the page');
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
          detectedPOS ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'
        }`}>
          {detectedPOS ? `🟢 ${detectedPOS.name} report page detected` : '⚪ No POS tab found'}
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
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500">Extracted {detectedPOS?.name ?? 'POS'} fields ({Object.keys(scanData).length})</span>
            <button
              onClick={handleClear}
              className="text-xs text-gray-400 hover:text-red-400 border border-gray-600 hover:border-red-700 px-2 py-0.5 rounded transition-colors"
            >
              ✕ Clear
            </button>
          </div>
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
            Navigate to a POS report page, then click Re-scan Page
          </p>
        </div>
      )}
    </div>
  );
}
