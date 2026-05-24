// Background service worker — Manifest V3

// Backend URL — update to your Render URL after deployment:
// e.g. https://nest-backend-xxx.onrender.com
const BACKEND_URL = 'http://localhost:3000';

interface ScanDataMessage {
  type: 'SCAN_DATA';
  payload: Record<string, number>;
}

interface OpenQBAuthMessage {
  type: 'OPEN_QB_AUTH';
  payload: { authUrl: string };
}

type ExtMessage = ScanDataMessage | OpenQBAuthMessage;

chrome.runtime.onMessage.addListener((message: ExtMessage, _sender, sendResponse) => {
  if (message.type === 'SCAN_DATA') {
    // Store latest scan data for popup retrieval
    chrome.storage.local.set({ lastScanData: message.payload }, () => {
      sendResponse({ ok: true });
    });

    // Optionally POST to backend if JWT is available
    chrome.storage.local.get(['jwt', 'selectedLocationId'], (result) => {
      const jwt = result['jwt'] as string | undefined;
      const locationId = result['selectedLocationId'] as string | undefined;
      if (!jwt || !locationId) return;

      const today = new Date().toISOString().split('T')[0];
      fetch(`${BACKEND_URL}/api/scans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          locationId,
          scanDate: today,
          rawData: message.payload,
        }),
      }).catch((err) => console.error('[BG] Failed to save scan:', err));
    });

    return true; // async response
  }

  if (message.type === 'OPEN_QB_AUTH') {
    const { authUrl } = message.payload;
    chrome.tabs.create({ url: authUrl }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});
