// Background service worker — Manifest V3 (floating window)

const BACKEND_URL = 'https://nest-backend-mddn.onrender.com';
const WINDOW_WIDTH = 950;
const WINDOW_HEIGHT = 750;

// ── Floating window ───────────────────────────────────────────────────────────
chrome.action.onClicked.addListener(async () => {
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
    chrome.storage.local.set({ lastScanData: message.payload }, () => {
      sendResponse({ ok: true });
    });

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
        body: JSON.stringify({ locationId, scanDate: today, rawData: message.payload }),
      }).catch((err) => console.error('[BG] Failed to save scan:', err));
    });

    return true;
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

