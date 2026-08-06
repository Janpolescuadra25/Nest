// Background service worker — Manifest V3 (floating window)

const WINDOW_WIDTH = 950;
const WINDOW_HEIGHT = 750;

if (process.env.NODE_ENV !== 'production') console.log('[Solyra BG] Service worker loaded');

// ── Floating window ───────────────────────────────────────────────────────────
chrome.action.onClicked.addListener(async () => {
  if (process.env.NODE_ENV !== 'production') console.log('[Solyra BG] Extension icon clicked — opening floating window');
  const storage = await chrome.storage.session.get(['solyraWindowId', 'autobooksWindowId', 'nestWindowId']) as { solyraWindowId?: number; autobooksWindowId?: number; nestWindowId?: number };
  let solyraWindowId = storage.solyraWindowId;
  if (solyraWindowId === undefined && storage.autobooksWindowId !== undefined) {
    solyraWindowId = storage.autobooksWindowId;
    await chrome.storage.session.set({ solyraWindowId });
    await chrome.storage.session.remove('autobooksWindowId');
  }
  if (solyraWindowId === undefined && storage.nestWindowId !== undefined) {
    solyraWindowId = storage.nestWindowId;
    await chrome.storage.session.set({ solyraWindowId });
    await chrome.storage.session.remove('nestWindowId');
  }

  if (solyraWindowId !== undefined) {
    try {
      await chrome.windows.get(solyraWindowId);
      await chrome.windows.update(solyraWindowId, { focused: true });
      return;
    } catch {
      await chrome.storage.session.remove('solyraWindowId');
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
      await chrome.storage.session.set({ solyraWindowId: win.id });
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[Solyra] Failed to open floating window:', err);
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { solyraWindowId } = await chrome.storage.session.get('solyraWindowId') as { solyraWindowId?: number };
  if (windowId === solyraWindowId) {
    await chrome.storage.session.remove('solyraWindowId');
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

