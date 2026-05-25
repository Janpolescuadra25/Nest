// Content script — runs on *://*.toasttab.com/* pages
// TODO: Replace with real Toast POS DOM selectors when access is available
// Current keys match Toast POS Sales Report field names (verified via screenshots)
console.log('[Nest Scanner] Content script loaded on Toast POS page');

const MOCK_SCAN_DATA: Record<string, number> = {
  // Revenue Summary
  'Net Sales': 24545.00,
  'Gratuity': 0.00,
  'Tax Amount': 2177.91,
  'Tips': 5265.87,
  'Total Amount': 31988.78,

  // Net Sales Breakdown
  'Gross Sales': 24657.00,
  'Sales Discounts': 112.00,
  'Sales Refunds': 0.00,

  // Tip Breakdown
  'Tips Collected': 5265.87,
  'Tips Refunded': 0.00,
  'Tips Withheld': 130.39,
  'Tips After Withholding': 5135.48,

  // Cash Activity
  'Total Cash Payments': 497.56,
  'Cash Refunds': 0.00,
  'Total Cash': 497.56,

  // Void Summary
  'Void Amount': 667.00,
  'Void Order Count': 2,
  'Void Item Count': 2,

  // Unpaid
  'Unpaid Amount': 0.00,
};

// Respond to REQUEST_SCAN from popup
chrome.runtime.onMessage.addListener((message: { type: string }, _sender, sendResponse) => {
  if (message.type === 'REQUEST_SCAN') {
    sendResponse({ data: MOCK_SCAN_DATA });
    return true; // keep channel open
  }
  return false;
});
