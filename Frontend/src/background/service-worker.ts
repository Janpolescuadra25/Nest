// Background service worker — Manifest V3 (floating window)

const WINDOW_WIDTH = 950;
const WINDOW_HEIGHT = 750;

if (process.env.NODE_ENV !== 'production') console.log('[AutoBooks BG] Service worker loaded');

// ── Floating window ───────────────────────────────────────────────────────────
chrome.action.onClicked.addListener(async () => {
  if (process.env.NODE_ENV !== 'production') console.log('[AutoBooks BG] Extension icon clicked — opening floating window');
  const storage = await chrome.storage.session.get(['autobooksWindowId', 'nestWindowId']) as { autobooksWindowId?: number; nestWindowId?: number };
  let autobooksWindowId = storage.autobooksWindowId;
  if (autobooksWindowId === undefined && storage.nestWindowId !== undefined) {
    autobooksWindowId = storage.nestWindowId;
    await chrome.storage.session.set({ autobooksWindowId });
    await chrome.storage.session.remove('nestWindowId');
  }

  if (autobooksWindowId !== undefined) {
    try {
      await chrome.windows.get(autobooksWindowId);
      await chrome.windows.update(autobooksWindowId, { focused: true });
      return;
    } catch {
      await chrome.storage.session.remove('autobooksWindowId');
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
      await chrome.storage.session.set({ autobooksWindowId: win.id });
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[AutoBooks] Failed to open floating window:', err);
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { autobooksWindowId } = await chrome.storage.session.get('autobooksWindowId') as { autobooksWindowId?: number };
  if (windowId === autobooksWindowId) {
    await chrome.storage.session.remove('autobooksWindowId');
  }
});

// ── Message handlers ──────────────────────────────────────────────────────────
interface OpenQBAuthMessage {
  type: 'OPEN_QB_AUTH';
  payload: { authUrl: string };
}

type ExtMessage = OpenQBAuthMessage;

chrome.runtime.onMessage.addListener((message: ExtMessage, _sender, sendResponse) => {
  if (message.type === 'OPEN_QB_AUTH') {
    const { authUrl } = message.payload;
    chrome.tabs.create({ url: authUrl }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

