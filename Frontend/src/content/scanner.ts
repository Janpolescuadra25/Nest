// Content script — runs on *://*.toasttab.com/* pages
// TODO: Replace with real Toast POS DOM selectors when access is available

const MOCK_SCAN_DATA: Record<string, number> = {
  'Food Sales': 1500.00,
  'Beverage Sales': 320.00,
  'Credit Card Tips': 85.00,
  'Cash': 420.00,
  'Tax': 148.00,
  'Discounts': 50.00,
};

// On load: push mock data to background
chrome.runtime.sendMessage({ type: 'SCAN_DATA', payload: MOCK_SCAN_DATA })
  .catch(() => { /* background may not be listening yet */ });

// Respond to REQUEST_SCAN from popup
chrome.runtime.onMessage.addListener((message: { type: string }, _sender, sendResponse) => {
  if (message.type === 'REQUEST_SCAN') {
    sendResponse({ data: MOCK_SCAN_DATA });
    return true; // keep channel open
  }
  return false;
});
