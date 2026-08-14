// Background service worker — Manifest V3 (floating window)

const WINDOW_WIDTH = 950;
const WINDOW_HEIGHT = 750;

if (process.env.NODE_ENV !== 'production') console.log('[Qyra BG] Service worker loaded');

// ── Floating window ───────────────────────────────────────────────────────────
chrome.action.onClicked.addListener(async () => {
  if (process.env.NODE_ENV !== 'production') console.log('[Qyra BG] Extension icon clicked — opening floating window');
  const storage = await chrome.storage.session.get(['qyraWindowId', 'solyraWindowId', 'autobooksWindowId', 'nestWindowId']) as { qyraWindowId?: number; solyraWindowId?: number; autobooksWindowId?: number; nestWindowId?: number };
  let qyraWindowId = storage.qyraWindowId;
  if (qyraWindowId === undefined && storage.solyraWindowId !== undefined) {
    qyraWindowId = storage.solyraWindowId;
    await chrome.storage.session.set({ qyraWindowId });
    await chrome.storage.session.remove('solyraWindowId');
  }
  if (qyraWindowId === undefined && storage.autobooksWindowId !== undefined) {
    qyraWindowId = storage.autobooksWindowId;
    await chrome.storage.session.set({ qyraWindowId });
    await chrome.storage.session.remove('autobooksWindowId');
  }
  if (qyraWindowId === undefined && storage.nestWindowId !== undefined) {
    qyraWindowId = storage.nestWindowId;
    await chrome.storage.session.set({ qyraWindowId });
    await chrome.storage.session.remove('nestWindowId');
  }

  if (qyraWindowId !== undefined) {
    try {
      await chrome.windows.get(qyraWindowId);
      await chrome.windows.update(qyraWindowId, { focused: true });
      return;
    } catch {
      await chrome.storage.session.remove('qyraWindowId');
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
      await chrome.storage.session.set({ qyraWindowId: win.id });
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[Qyra] Failed to open floating window:', err);
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { qyraWindowId } = await chrome.storage.session.get('qyraWindowId') as { qyraWindowId?: number };
  if (windowId === qyraWindowId) {
    await chrome.storage.session.remove('qyraWindowId');
  }
});

let qbAuthTabId: number | null = null;
let qbAuthCleanupTimer: number | null = null;

const cleanupQBAuth = () => {
  qbAuthTabId = null;
  if (qbAuthCleanupTimer !== null) {
    clearTimeout(qbAuthCleanupTimer);
    qbAuthCleanupTimer = null;
  }
};

const handleQBAuthCallbackUrl = (tabId: number, url: string) => {
  const callbackUrl = url;
  if (!callbackUrl.includes('/api/quickbooks/callback')) return;

  let success = false;
  let realmId: string | undefined;
  let error: string | undefined;

  try {
    const parsed = new URL(callbackUrl);
    const params = parsed.searchParams;
    const maybeError = params.get('error');
    const code = params.get('code');
    const maybeRealmId = params.get('realmId');

    if (maybeError) {
      error = maybeError;
    } else if (code && maybeRealmId) {
      success = true;
      realmId = maybeRealmId;
    } else {
      error = 'Missing QuickBooks callback parameters.';
    }
  } catch (err) {
    error = 'Failed to parse QuickBooks callback URL.';
  }

  chrome.tabs.remove(tabId).catch(() => {});
  cleanupQBAuth();
  chrome.runtime.sendMessage({
    type: 'QB_AUTH_CALLBACK',
    payload: { success, error, realmId },
  });
};

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (qbAuthTabId === null || tabId !== qbAuthTabId) return;
  const url = changeInfo.url ?? tab.url;
  if (!url) return;
  handleQBAuthCallbackUrl(tabId, url);
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
    chrome.tabs.create({ url: authUrl }, (tab) => {
      if (tab?.id !== undefined) {
        qbAuthTabId = tab.id;
        if (qbAuthCleanupTimer !== null) {
          clearTimeout(qbAuthCleanupTimer);
        }
        qbAuthCleanupTimer = window.setTimeout(() => {
          cleanupQBAuth();
        }, 5 * 60 * 1000);
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

