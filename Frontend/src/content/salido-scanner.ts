// Content script — runs on *://*.salido.com/* pages
// DOM scraper for SALIDO Bridge Accounting Summary page
// URL pattern: bridge-preview.salido.com/reports/new/accounting-summary
export {};

// ---------------------------------------------------------------------------
// UTILITIES (copied from scanner.ts — content scripts cannot share imports)
// ---------------------------------------------------------------------------

/** Wait for an element matching selector to appear in the DOM.
 *  Returns the element if found, or null if timed out. */
function waitForElement(selector: string, timeoutMs = 8000): Promise<Element | null> {
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
  if (/^\d{1,2}:\d{2}/.test(s)) return 0;
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

// ---------------------------------------------------------------------------
// WAIT FOR DATA TO LOAD
// ---------------------------------------------------------------------------

/** Wait until skeleton loaders are gone from all report sections. */
async function waitForDataLoaded(timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const skeletons = document.querySelectorAll('.fake-table-entry');
    const noResults = document.querySelectorAll('.no-results-wrapper');
    const sections = document.querySelectorAll('div.reports-results');
    if (sections.length > 0 && skeletons.length === 0 && noResults.length === 0) {
      return true;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// ---------------------------------------------------------------------------
// EXTRACTORS
// ---------------------------------------------------------------------------

/** Read text from a SALIDO cell by selector. */
function cellText(el: Element, selector: string): string {
  return el.querySelector(selector)?.textContent?.trim() ?? '';
}

/** Extract column headers from the table-header tbody. */
function getColumnHeaders(headerTbody: Element): string[] {
  return Array.from(
    headerTbody.querySelectorAll('td.--grouped-header .table-cell-inner')
  ).map(el => el.textContent?.trim() ?? '').filter(h => h.length > 0);
}

/** Extract a regular (non-grouped) section. */
function extractRegularSection(
  block: Element,
  sectionName: string,
  headers: string[]
): Record<string, number> {
  const result: Record<string, number> = {};
  const rowGroups = block.querySelectorAll('tbody.result-row-group');
  rowGroups.forEach(group => {
    group.querySelectorAll('tr.table-row').forEach(row => {
      const label = cellText(row, 'td.--value.--text .table-cell-inner');
      if (!label) return;
      const valueCells = Array.from(row.querySelectorAll('td.--value.--money .table-cell-inner'));
      if (headers.length > 0) {
        valueCells.forEach((cell, i) => {
          const colName = headers[i] ?? `Col${i + 1}`;
          result[`${sectionName}.${label}.${colName}`] = parseValue(cell.textContent ?? '');
        });
      } else {
        // Single value column
        const val = valueCells[0]?.textContent ?? '';
        result[`${sectionName}.${label}`] = parseValue(val);
      }
    });
  });
  return result;
}

/** Extract a grouped (Payments) section — rows are grouped by sub-header. */
function extractGroupedSection(
  block: Element,
  sectionName: string,
  headers: string[]
): Record<string, number> {
  const result: Record<string, number> = {};
  const rowGroups = block.querySelectorAll('tbody.result-row-group, tbody.result-row-group.--with-subheader');
  rowGroups.forEach(group => {
    let currentGroup = 'Other';
    group.querySelectorAll('tr.table-row').forEach(row => {
      // Check for sub-header row
      const subheaderEl = row.querySelector('td.--subheader .table-cell-inner');
      if (subheaderEl) {
        currentGroup = subheaderEl.textContent?.trim() ?? currentGroup;
        return;
      }
      const label = cellText(row, 'td.--value.--text .table-cell-inner');
      if (!label) return;
      const valueCells = Array.from(row.querySelectorAll('td.--value.--money .table-cell-inner'));
      if (headers.length > 0) {
        valueCells.forEach((cell, i) => {
          const colName = headers[i] ?? `Col${i + 1}`;
          result[`${sectionName}.${currentGroup}.${label}.${colName}`] = parseValue(cell.textContent ?? '');
        });
      } else {
        const val = valueCells[0]?.textContent ?? '';
        result[`${sectionName}.${currentGroup}.${label}`] = parseValue(val);
      }
    });
  });
  return result;
}

// ---------------------------------------------------------------------------
// MAIN SCAN FUNCTION
// ---------------------------------------------------------------------------

async function scanAccountingSummary(): Promise<Record<string, number>> {
  const data: Record<string, number> = {};

  // Wait for the report table to appear
  const tableEl = await waitForElement('table.reports-table', 10000);
  if (!tableEl) {
    console.warn('[SALIDO Scanner] No report table found — page may not be loaded');
    return data;
  }

  // Wait for skeleton loaders to clear
  await waitForDataLoaded(15000);

  // Iterate all report section blocks
  const blocks = document.querySelectorAll('div.reports-results');
  blocks.forEach(block => {
    const headerTbody = block.querySelector('tbody.table-header');
    if (!headerTbody) return;

    // Read section title
    const sectionName = cellText(headerTbody, 'td.summary-header .table-cell-inner') || 'Unknown';

    // Read column headers
    const headers = getColumnHeaders(headerTbody);

    // Determine if this is a grouped section (Payments)
    const table = block.querySelector('table.reports-table');
    const isGrouped = table?.classList.contains('grouped') ?? false;

    if (isGrouped) {
      Object.assign(data, extractGroupedSection(block, sectionName, headers));
    } else {
      Object.assign(data, extractRegularSection(block, sectionName, headers));
    }
  });

  return data;
}

// ---------------------------------------------------------------------------
// MESSAGE LISTENER
// ---------------------------------------------------------------------------

if ((globalThis as unknown as Record<string, boolean>).__salidoScannerLoaded) {
  console.log('[SALIDO Scanner] Already loaded, skipping duplicate registration');
} else {
  (globalThis as unknown as Record<string, boolean>).__salidoScannerLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'REQUEST_SCAN') return false;

    console.log('[SALIDO Scanner] REQUEST_SCAN received');

    scanAccountingSummary()
      .then(data => {
        console.log(`[SALIDO Scanner] Extracted ${Object.keys(data).length} fields`);
        sendResponse({ data });
      })
      .catch(err => {
        console.error('[SALIDO Scanner] Scan error:', err);
        sendResponse({ data: {} });
      });

    return true; // keep message channel open for async response
  });
}

console.log('[SALIDO Scanner] Content script loaded on', window.location.href);
