// Background service worker — Manifest V3 (floating window)

import { BACKEND_URL } from '../lib/config';
const WINDOW_WIDTH = 950;
const WINDOW_HEIGHT = 750;

if (process.env.NODE_ENV !== 'production') console.log('[Nest BG] Service worker loaded');

// ── Floating window ───────────────────────────────────────────────────────────
chrome.action.onClicked.addListener(async () => {
  if (process.env.NODE_ENV !== 'production') console.log('[Nest BG] Extension icon clicked — opening floating window');
  const { nestWindowId } = await chrome.storage.session.get('nestWindowId') as { nestWindowId?: number };

  if (nestWindowId !== undefined) {
    try {
      await chrome.windows.get(nestWindowId);
      await chrome.windows.update(nestWindowId, { focused: true });
      return;
    } catch {
      await chrome.storage.session.remove('nestWindowId');
    }
  }

  const popupUrl = chrome.runtime.getURL('popup/index.html');
  try {
    const win = await chrome.windows.create({
      url: popupUrl,
      type: 'popup',
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      focused: true,
    });
    if (win?.id !== undefined) {
      await chrome.storage.session.set({ nestWindowId: win.id });
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[Nest] Failed to open floating window:', err);
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { nestWindowId } = await chrome.storage.session.get('nestWindowId') as { nestWindowId?: number };
  if (windowId === nestWindowId) {
    await chrome.storage.session.remove('nestWindowId');
  }
});

// ── Message handlers ──────────────────────────────────────────────────────────
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
    // 1. Cache locally (fire-and-forget)
    chrome.storage.local.set({ lastScanData: message.payload });

    // 2. Prevent double-response and handle timeout
    let responded = false;
    const safeRespond = (response: object) => {
      if (responded) return;
      responded = true;
      sendResponse(response);
    };

    // 3. Timeout guard — Chrome message channel closes after ~5 seconds
    setTimeout(() => safeRespond({ ok: false, error: 'Save timed out' }), 8000);

    // 4. Attempt backend save, then respond with result
    chrome.storage.local.get(['jwt', 'selectedLocationId'], (result) => {
      const jwt = result['jwt'] as string | undefined;
      const locationId = result['selectedLocationId'] as string | undefined;

      if (!jwt || !locationId) {
        safeRespond({ ok: false, error: 'Missing auth or location' });
        return;
      }

      const today = new Date().toISOString().split('T')[0];
      fetch(`${BACKEND_URL}/api/scans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({ locationId, scanDate: today, rawData: message.payload }),
      })
      .then(() => safeRespond({ ok: true }))
      .catch((err) => {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[BG] Failed to save scan:', err);
        }
        safeRespond({ ok: false, error: 'Failed to save scan' });
      });
    });

    return true;  // keep channel open for async response
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

