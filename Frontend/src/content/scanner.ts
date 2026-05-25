// Content script — runs on *://*.toasttab.com/* pages
// Real DOM scraper for Toast POS Sales Summary page
// Sections 1–17 extracted via data-testid selectors
console.log('[Nest Scanner] Content script loaded on Toast POS page');

// ---------------------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------------------

/** Wait for an element matching selector to appear in the DOM.
 *  Returns the element if found, or null if timed out. */
function waitForElement(selector: string, timeoutMs = 5000): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
  });
}

/** Parse a formatted value string to a number. */
function parseValue(raw: string): number {
  const s = raw.trim();
  if (s === '—' || s === '-' || s === '') return 0;
  // Time values like "03:48" or "1:17:20" — skip
  if (/^\d{1,2}:\d{2}/.test(s)) {
    console.warn(`[Nest Scanner] Skipping time value: ${s}`);
    return 0;
  }
  // Parenthesized negatives: "(549.75)" → -549.75
  if (/^\(.*\)$/.test(s)) {
    const inner = s.replace(/[()$,]/g, '');
    const num = parseFloat(inner);
    return isNaN(num) ? 0 : -num;
  }
  // Percentage: "0.6%" → 0.6
  if (s.endsWith('%')) {
    const num = parseFloat(s.replace(/[^0-9.\-]/g, ''));
    return isNaN(num) ? 0 : num;
  }
  // Trailing minus: "549.75-" → -549.75
  const cleaned = s.replace(/[$,]/g, '');
  if (cleaned.endsWith('-') && !cleaned.startsWith('-')) {
    const num = parseFloat(cleaned.slice(0, -1));
    return isNaN(num) ? 0 : -num;
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/** Get the title attribute from the formatted-value-text div inside an element.
 *  Always returns a string — empty string if not found. */
function getCellTitle(cell: Element): string {
  return cell.querySelector('div[data-testid="formatted-value-text"]')
    ?.getAttribute('title')?.trim() ?? '';
}

/** Extract column headers from a table header element. */
function getColumnHeaders(headerEl: Element | null): string[] {
  if (!headerEl) return [];
  const headers = Array.from(
    headerEl.querySelectorAll('div[data-testid="table-header-text"]')
  ).map(el => el.textContent?.trim() ?? '').filter(h => h.length > 0);
  if (headers.length > 0) return headers;
  // Fallback: <th> text content
  return Array.from(headerEl.querySelectorAll('th'))
    .map(th => th.textContent?.trim() ?? '')
    .filter(h => h.length > 0);
}

/** Check if a row is a total row. */
function isTotalRow(row: Element): boolean {
  if (row.closest('tfoot')) return true;
  const firstCell = row.querySelector(':scope > td:first-child');
  if (!firstCell) return false;
  const label = getCellTitle(firstCell);
  return /^total\b/i.test(label);
}

/** Collect all rows from a table's tbody AND tfoot (scoped to prevent leaking). */
function collectTableRows(table: Element): Element[] {
  return Array.from(
    table.querySelectorAll(':scope > tbody > tr, :scope > tfoot > tr')
  );
}

// ---------------------------------------------------------------------------
// EXTRACTORS
// ---------------------------------------------------------------------------

/** Extract a 2-column (label → value) table into section-prefixed keys. */
function extractKeyValueTable(
  tbody: Element | null,
  sectionPrefix: string
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!tbody) return result;
  const table = tbody.closest('table');
  const rows = table
    ? collectTableRows(table)
    : Array.from(tbody.querySelectorAll(':scope > tr'));
  rows.forEach(row => {
    const cells = row.querySelectorAll(':scope > td');
    if (cells.length < 2) return;
    const label = getCellTitle(cells[0] as Element);
    if (label) {
      result[`${sectionPrefix}.${label}`] = parseValue(
        getCellTitle(cells[1] as Element)
      );
    }
  });
  return result;
}

/** Extract an N-column table into section-prefixed keys. */
function extractMultiColumnTable(
  thead: Element | null,
  tbody: Element | null,
  sectionPrefix: string,
  labelColumnIndex = 0
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!tbody) return result;
  const headers = getColumnHeaders(thead);
  const table = tbody.closest('table');
  const rows = table
    ? collectTableRows(table)
    : Array.from(tbody.querySelectorAll(':scope > tr'));
  rows.forEach(row => {
    const cells = row.querySelectorAll(':scope > td');
    if (cells.length < 2) return;
    const total = isTotalRow(row);
    const label = getCellTitle(cells[labelColumnIndex] as Element);
    if (!label) return;
    // Normalize total row label to "Total" unless it already starts with "Total"
    const rowLabel = total
      ? (/^total\b/i.test(label) ? label : 'Total')
      : label;
    for (let i = 0; i < cells.length; i++) {
      if (i === labelColumnIndex) continue;
      const colName = headers[i] ?? `Col${i}`;
      result[`${sectionPrefix}.${rowLabel}.${colName}`] = parseValue(
        getCellTitle(cells[i] as Element)
      );
    }
  });
  return result;
}

// ---------------------------------------------------------------------------
// MAIN SCAN FUNCTION
// ---------------------------------------------------------------------------

function scanSalesSummary(): Record<string, number> {
  const data: Record<string, number> = {};

  // Section 1: Revenue Summary (key-value)
  Object.assign(data, extractKeyValueTable(
    document.querySelector('tbody[data-testid="revenue-summary-table-body"]'),
    'Revenue'
  ));

  // Section 2: Net Sales Summary (key-value)
  Object.assign(data, extractKeyValueTable(
    document.querySelector('tbody[data-testid="net-sales-summary-table-body"]'),
    'Net Sales'
  ));

  // Section 3: Tip Summary (key-value)
  Object.assign(data, extractKeyValueTable(
    document.querySelector('tbody[data-testid="tip-summary-table-body"]'),
    'Tips'
  ));

  // Section 4: Cash Activity (key-value)
  Object.assign(data, extractKeyValueTable(
    document.querySelector('tbody[data-testid="cash-activity-table-body"]'),
    'Cash Activity'
  ));

  // Section 5: Cash Summary (key-value)
  Object.assign(data, extractKeyValueTable(
    document.querySelector('tbody[data-testid="cash-summary-table-body"]'),
    'Cash Summary'
  ));

  // Section 6: Unpaid Orders (key-value)
  Object.assign(data, extractKeyValueTable(
    document.querySelector('tbody[data-testid="unpaid-orders-summary-data-table-body"]'),
    'Unpaid Orders'
  ));

  // Section 7: Void Summary (key-value)
  Object.assign(data, extractKeyValueTable(
    document.querySelector('tbody[data-testid="void-summary-table-body"]'),
    'Void'
  ));

  // Section 8: Payments Summary (multi-column)
  Object.assign(data, extractMultiColumnTable(
    document.querySelector('thead[data-testid="payments-summary-table-header"]'),
    document.querySelector('tbody[data-testid="payments-summary-table-body"]'),
    'Payments'
  ));

  // Section 9: Sales Category Summary (multi-column)
  Object.assign(data, extractMultiColumnTable(
    document.querySelector('thead[data-testid="sales-categories-data-table-header"]'),
    document.querySelector('tbody[data-testid="sales-categories-data-table-body"]'),
    'Sales Category'
  ));

  // Section 10: Tax Summary (multi-column)
  Object.assign(data, extractMultiColumnTable(
    document.querySelector('thead[data-testid="tax-summary-data-table-header"]'),
    document.querySelector('tbody[data-testid="tax-summary-data-table-body"]'),
    'Tax'
  ));

  // Section 11: Discount Summary (multi-column)
  Object.assign(data, extractMultiColumnTable(
    document.querySelector('thead[data-testid="discount-data-table-header"]'),
    document.querySelector('tbody[data-testid="discount-data-table-body"]'),
    'Discount'
  ));

  // Section 12: Service Charge Summary (multi-column; total in <tfoot>)
  Object.assign(data, extractMultiColumnTable(
    document.querySelector('thead[data-testid="service-charge-data-table-header"]'),
    document.querySelector('tbody[data-testid="service-charge-data-table-body"]'),
    'Service Charge'
  ));

  // Section 13: Revenue Center Summary (multi-column; total in <tfoot>)
  Object.assign(data, extractMultiColumnTable(
    document.querySelector('thead[data-testid="RevenueTable-data-table-header"]'),
    document.querySelector('tbody[data-testid="RevenueTable-data-table-body"]'),
    'Revenue Center'
  ));

  // Section 14: Service / Daypart Summary (multi-column)
  Object.assign(data, extractMultiColumnTable(
    document.querySelector('thead[data-testid="Services-data-table-header"]'),
    document.querySelector('tbody[data-testid="Services-data-table-body"]'),
    'Service Daypart'
  ));

  // Section 15: Dining Options Summary (multi-column)
  Object.assign(data, extractMultiColumnTable(
    document.querySelector('thead[data-testid="dining-options-data-table-header"]'),
    document.querySelector('tbody[data-testid="dining-options-data-table-body"]'),
    'Dining Option'
  ));

  // Section 16: Service Mode Summary (pivot table; multi-column)
  Object.assign(data, extractMultiColumnTable(
    document.querySelector('thead[data-testid="service-mode-summary-data-table-header"]'),
    document.querySelector('tbody[data-testid="service-mode-summary-data-table-body"]'),
    'Service Mode'
  ));

  // Section 17: Deferred Summary (multi-column; only present when deferred items exist)
  Object.assign(data, extractMultiColumnTable(
    document.querySelector('thead[data-testid="Deferred-data-table-header"]'),
    document.querySelector('tbody[data-testid="Deferred-data-table-body"]'),
    'Deferred'
  ));

  return data;
}

// ---------------------------------------------------------------------------
// MESSAGE LISTENER
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: { type: string }, _sender, sendResponse) => {
  if (message.type === 'REQUEST_SCAN') {
    const url = window.location.href;
    const isSalesSummary = /\/restaurants\/admin\/reports\/sales\/sales-summary/.test(url);

    if (!isSalesSummary) {
      sendResponse({ data: null });
      return true;
    }

    // Wait for the revenue summary table (confirms page is fully loaded)
    waitForElement('tbody[data-testid="revenue-summary-table-body"]', 5000)
      .then((el) => {
        if (!el) {
          console.error('[Nest Scanner] Timed out waiting for Sales Summary page to load');
          sendResponse({ data: null });
          return;
        }
        try {
          const scanData = scanSalesSummary();
          if (Object.keys(scanData).length === 0) {
            console.error('[Nest Scanner] Page loaded but no data extracted — selectors may be outdated');
            sendResponse({ data: null });
            return;
          }
          console.log(`[Nest Scanner] Extracted ${Object.keys(scanData).length} keys`);
          sendResponse({ data: scanData });
        } catch (err) {
          console.error('[Nest Scanner] Error:', err);
          sendResponse({ data: null });
        }
      });

    return true; // Keep message channel open for async response
  }
  return false;
});
