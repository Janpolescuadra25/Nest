// Content script — runs on *://*.toasttab.com/* pages
// Real DOM scraper for Toast POS Sales Summary page
// Sections 1–17 extracted via data-testid selectors

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
 *  Always returns a string — empty string if not found.
 *  Strips Toast tooltip descriptions that are appended to the label
 *  (e.g. "Taxable amountThe taxable amount..." → "Taxable amount",
 *   "AmountAmount of service charges..." → "Amount"). */
function getCellTitle(cell: Element): string {
  const raw = cell.querySelector('div[data-testid="formatted-value-text"]')
    ?.getAttribute('title')?.trim() ?? '';
  // Toast appends tooltip descriptions right after the label with no separator.
  // The label is a short phrase (1-3 words), then a descriptive sentence follows.
  // Patterns seen:
  //   "Taxable amountThe taxable amount (net sales...)" → "Taxable amount"
  //   "AmountAmount of service charges minus refunds..." → "Amount"
  //
  // Strategy: The label is always short (≤30 chars). If the title is longer than 30 chars,
  // we look for where the label ends and the description begins.
  // Descriptions always contain a verb or preposition like "of", "that", "is", "for",
  // "The", "This", "Note", "minus", etc. within the first few words after the label.
  if (raw.length <= 30) return raw; // Short titles are just labels

  // Try: find where a lowercase letter is immediately followed by an uppercase letter
  // that starts a new sentence (the description). This catches "amountThe" and "AmountAmount".
  const match = raw.match(/^(.+?[a-z])([A-Z].{10,})$/);
  if (match) {
    const label = match[1];
    const desc = match[2];
    // Verify it looks like a description (contains common English words)
    if (/\b(of|that|is|for|the|are|was|will|has|can|may|note|minus)\b/i.test(desc)) {
      return label;
    }
  }

  // Try: same word repeated (e.g. "AmountAmount")
  const repeatMatch = raw.match(/^([A-Z][a-z]+)([A-Z][a-z]+)/);
  if (repeatMatch && repeatMatch[1] === repeatMatch[2]) {
    return repeatMatch[1];
  }

  return raw;
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
  {
    const sectionData = extractKeyValueTable(
      document.querySelector('tbody[data-testid="revenue-summary-table-body"]'),
      'Revenue'
    );
    Object.assign(data, sectionData);
  }

  // Section 2: Net Sales Summary (key-value)
  {
    const sectionData = extractKeyValueTable(
      document.querySelector('tbody[data-testid="net-sales-summary-table-body"]'),
      'Net Sales'
    );
    Object.assign(data, sectionData);
  }

  // Section 3: Tip Summary (key-value)
  {
    const sectionData = extractKeyValueTable(
      document.querySelector('tbody[data-testid="tip-summary-table-body"]'),
      'Tips'
    );
    Object.assign(data, sectionData);
  }

  // Section 4: Cash Activity (key-value)
  {
    const sectionData = extractKeyValueTable(
      document.querySelector('tbody[data-testid="cash-activity-table-body"]'),
      'Cash Activity'
    );
    Object.assign(data, sectionData);
  }

  // Section 5: Cash Summary (key-value)
  {
    const sectionData = extractKeyValueTable(
      document.querySelector('tbody[data-testid="cash-summary-table-body"]'),
      'Cash Summary'
    );
    Object.assign(data, sectionData);
  }

  // Section 6: Unpaid Orders (key-value)
  {
    const sectionData = extractKeyValueTable(
      document.querySelector('tbody[data-testid="unpaid-orders-summary-data-table-body"]'),
      'Unpaid Orders'
    );
    Object.assign(data, sectionData);
  }

  // Section 7: Void Summary (key-value)
  {
    const sectionData = extractKeyValueTable(
      document.querySelector('tbody[data-testid="void-summary-table-body"]'),
      'Void'
    );
    Object.assign(data, sectionData);
  }

  // Section 8: Payments Summary (multi-column)
  {
    const sectionData = extractMultiColumnTable(
      document.querySelector('thead[data-testid="payments-summary-table-header"]'),
      document.querySelector('tbody[data-testid="payments-summary-table-body"]'),
      'Payments'
    );
    Object.assign(data, sectionData);
  }

  // Section 9: Sales Category Summary (multi-column)
  {
    const sectionData = extractMultiColumnTable(
      document.querySelector('thead[data-testid="sales-categories-data-table-header"]'),
      document.querySelector('tbody[data-testid="sales-categories-data-table-body"]'),
      'Sales Category'
    );
    Object.assign(data, sectionData);
  }

  // Section 10: Tax Summary (multi-column)
  {
    const sectionData = extractMultiColumnTable(
      document.querySelector('thead[data-testid="tax-summary-data-table-header"]'),
      document.querySelector('tbody[data-testid="tax-summary-data-table-body"]'),
      'Tax'
    );
    Object.assign(data, sectionData);
  }

  // Section 11: Discount Summary (multi-column)
  {
    const sectionData = extractMultiColumnTable(
      document.querySelector('thead[data-testid="discount-data-table-header"]'),
      document.querySelector('tbody[data-testid="discount-data-table-body"]'),
      'Discount'
    );
    Object.assign(data, sectionData);
  }

  // Section 12: Service Charge Summary (multi-column; total in <tfoot>)
  {
    const sectionData = extractMultiColumnTable(
      document.querySelector('thead[data-testid="service-charge-data-table-header"]'),
      document.querySelector('tbody[data-testid="service-charge-data-table-body"]'),
      'Service Charge'
    );
    Object.assign(data, sectionData);
  }

  // Section 13: Revenue Center Summary (multi-column; total in <tfoot>)
  {
    const sectionData = extractMultiColumnTable(
      document.querySelector('thead[data-testid="RevenueTable-data-table-header"]'),
      document.querySelector('tbody[data-testid="RevenueTable-data-table-body"]'),
      'Revenue Center'
    );
    Object.assign(data, sectionData);
  }

  // Section 14: Service / Daypart Summary (multi-column)
  {
    const sectionData = extractMultiColumnTable(
      document.querySelector('thead[data-testid="Services-data-table-header"]'),
      document.querySelector('tbody[data-testid="Services-data-table-body"]'),
      'Service Daypart'
    );
    Object.assign(data, sectionData);
  }

  // Section 15: Dining Options Summary (multi-column)
  {
    const sectionData = extractMultiColumnTable(
      document.querySelector('thead[data-testid="dining-options-data-table-header"]'),
      document.querySelector('tbody[data-testid="dining-options-data-table-body"]'),
      'Dining Option'
    );
    Object.assign(data, sectionData);
  }

  // Section 16: Service Mode Summary (pivot table; multi-column)
  {
    const sectionData = extractMultiColumnTable(
      document.querySelector('thead[data-testid="service-mode-summary-data-table-header"]'),
      document.querySelector('tbody[data-testid="service-mode-summary-data-table-body"]'),
      'Service Mode'
    );
    Object.assign(data, sectionData);
  }

  // Section 17: Deferred Summary (multi-column; only present when deferred items exist)
  {
    const sectionData = extractMultiColumnTable(
      document.querySelector('thead[data-testid="Deferred-data-table-header"]'),
      document.querySelector('tbody[data-testid="Deferred-data-table-body"]'),
      'Deferred'
    );
    Object.assign(data, sectionData);
  }

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
          sendResponse({ data: scanData });
        } catch (err) {
          console.error('[Nest Scanner] Scan failed:', err);
          sendResponse({ data: null });
        }
      });

    return true; // Keep message channel open for async response
  }
  return false;
});
