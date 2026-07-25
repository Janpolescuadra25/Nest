// Content script — runs on *://*.oraclerestaurants.com/* pages
// DOM scraper for Oracle Simphony "Daily Operations" report
// URL pattern: *.oraclerestaurants.com/portal/*
export {};

// ---------------------------------------------------------------------------
// UTILITIES (copied from salido-scanner.ts — content scripts cannot share imports)
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
// WAIT STRATEGY — two-tier fallback
// ---------------------------------------------------------------------------

/** Wait for the Oracle Daily Operations report to fully render.
 *  Tier 1: Poll for oj-complete on all oj-rna-report-tile-cca components (10s).
 *  Tier 2: Fallback — wait for summary grid table with data rows (25s total). */
async function waitForReportLoaded(timeoutMs = 25000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  // Tier 1: Wait for oj-complete on report tiles
  const tier1Deadline = Date.now() + 10000;
  while (Date.now() < tier1Deadline) {
    const tiles = document.querySelectorAll('oj-rna-report-tile-cca');
    if (tiles.length > 0) {
      const allComplete = Array.from(tiles).every(t => t.classList.contains('oj-complete'));
      if (allComplete) return true;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Tier 2: Fallback — wait for summary grid with data rows
  while (Date.now() < deadline) {
    const grid = document.querySelector('table.oj-fbgbu-grid');
    if (grid) {
      const rows = grid.querySelectorAll('th.oj-fbgbu-grid-row-header');
      if (rows.length > 0) {
        const firstValue = rows[0].nextElementSibling;
        if (firstValue && firstValue.textContent?.trim()) return true;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  return false;
}

// ---------------------------------------------------------------------------
// SECTION NAME RESOLUTION
// ---------------------------------------------------------------------------

const SKIP_SECTIONS = new Set(['Payment Total by Tender Type', 'Report Notes']);

/** Get the section name for a table element by walking up to the nearest
 *  oj-rna-report-tile-cca ancestor and reading its aria-label, or falling
 *  back to a nearby h2 heading. */
function getSectionName(el: Element): string {
  let node: Element | null = el;
  while (node) {
    if (node.tagName?.toLowerCase() === 'oj-rna-report-tile-cca') {
      const label = node.getAttribute('aria-label');
      if (label) return label.trim();
    }
    node = node.parentElement;
  }
  // Fallback: find nearest h2 sibling/ancestor
  let search: Element | null = el.parentElement;
  while (search) {
    const h2 = search.querySelector('h2.oj-typography-subheading-sm');
    if (h2?.textContent) return h2.textContent.trim();
    search = search.parentElement;
  }
  return 'Unknown';
}

// ---------------------------------------------------------------------------
// EXTRACTORS
// ---------------------------------------------------------------------------

/** Extract KPI tiles (top of page) — prefixed with "KPI." */
function extractKPITiles(): Record<string, number> {
  const result: Record<string, number> = {};
  const labels = document.querySelectorAll('div.oj-fbgbu-panel-label');
  labels.forEach(labelEl => {
    const label = labelEl.textContent?.trim();
    if (!label) return;
    // Value is a sibling div.oj-fbgbu-panel-value
    const valueEl = labelEl.nextElementSibling?.matches('.oj-fbgbu-panel-value')
      ? labelEl.nextElementSibling
      : labelEl.parentElement?.querySelector('.oj-fbgbu-panel-value');
    if (!valueEl) return;
    result[`KPI.${label}`] = parseValue(valueEl.textContent ?? '');
  });
  return result;
}

/** Extract a summary grid (Pattern A) — table.oj-fbgbu-grid.
 *  Rows: th.oj-fbgbu-grid-row-header = label, adjacent td = value. */
function extractGridTable(tableEl: Element, sectionName: string): Record<string, number> {
  const result: Record<string, number> = {};
  const rows = tableEl.querySelectorAll('th.oj-fbgbu-grid-row-header');
  rows.forEach(th => {
    const label = th.textContent?.trim();
    if (!label) return;
    const valueTd = th.nextElementSibling;
    if (!valueTd) return;
    const raw = valueTd.textContent?.trim() ?? '';
    result[`Summary.${label}`] = parseValue(raw);
  });
  return result;
}

/** Extract a breakdown table (Pattern B) — table[id^="standard_table_"].
 *  Columns from thead div.oj-table-column-header-text, rows from tbody tr.oj-table-body-row. */
function extractBreakdownTable(tableEl: Element, sectionName: string): Record<string, number> {
  const result: Record<string, number> = {};

  // Collect column headers
  const headerTexts = Array.from(
    tableEl.querySelectorAll('thead div.oj-table-column-header-text')
  ).map(el => el.textContent?.trim() ?? '');

  const rows = tableEl.querySelectorAll('tbody tr.oj-table-body-row');
  rows.forEach(row => {
    // Row label — first td with left-align class
    const labelTd = row.querySelector('td.oj-helper-text-align-left');
    const labelSpan = labelTd?.querySelector('span') ?? labelTd;
    const label = (labelSpan?.textContent ?? labelTd?.textContent ?? '').trim();
    if (!label) return;

    // Value cells — tds with right-align class
    const valueTds = Array.from(row.querySelectorAll('td.oj-helper-text-align-right'));
    valueTds.forEach((td, i) => {
      // Column name starts at index 1 in headerTexts (index 0 is the label column)
      const colName = headerTexts[i + 1] ?? `Col${i + 1}`;
      const raw = td.textContent?.trim() ?? '';
      result[`${sectionName}.${label}.${colName}`] = parseValue(raw);
    });
  });
  return result;
}

// ---------------------------------------------------------------------------
// MAIN SCAN FUNCTION
// ---------------------------------------------------------------------------

async function scanDailyOperations(): Promise<Record<string, number>> {
  const data: Record<string, number> = {};

  // 1. Wait for report to load
  const loaded = await waitForReportLoaded(25000);
  if (!loaded) {
    console.warn('[Oracle Scanner] Report did not fully load — attempting partial scan');
  }

  // 2. KPI tiles (best-effort)
  try {
    Object.assign(data, extractKPITiles());
  } catch (err) {
    console.warn('[Oracle Scanner] KPI tile extraction failed:', err);
  }

  // 3. Summary grids (Pattern A)
  const grids = document.querySelectorAll('table.oj-fbgbu-grid');
  grids.forEach(grid => {
    const sectionName = getSectionName(grid);
    if (SKIP_SECTIONS.has(sectionName)) return;
    try {
      Object.assign(data, extractGridTable(grid, sectionName));
    } catch (err) {
      console.warn(`[Oracle Scanner] Grid extraction failed for "${sectionName}":`, err);
    }
  });

  // 4. Breakdown tables (Pattern B)
  const breakdownTables = document.querySelectorAll('table[id^="standard_table_"]');
  breakdownTables.forEach(table => {
    const sectionName = getSectionName(table);
    if (SKIP_SECTIONS.has(sectionName)) return;
    try {
      Object.assign(data, extractBreakdownTable(table, sectionName));
    } catch (err) {
      console.warn(`[Oracle Scanner] Breakdown extraction failed for "${sectionName}":`, err);
    }
  });

  return data;
}

// ---------------------------------------------------------------------------
// MESSAGE LISTENER (duplicate guard)
// ---------------------------------------------------------------------------

if ((globalThis as unknown as Record<string, boolean>).__oracleScannerLoaded) {
  if (process.env.NODE_ENV !== 'production') console.log('[Oracle Scanner] Already loaded, skipping duplicate registration');
} else {
  (globalThis as unknown as Record<string, boolean>).__oracleScannerLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'REQUEST_SCAN') return false;
    if (process.env.NODE_ENV !== 'production') console.log('[Oracle Scanner] REQUEST_SCAN received');
    (async () => {
      try {
        const data = await scanDailyOperations();
        if (process.env.NODE_ENV !== 'production') console.log(`[Oracle Scanner] Extracted ${Object.keys(data).length} fields`);
        sendResponse({ data });
      } catch (err) {
        console.error('[Oracle Scanner] Scan error:', err);
        sendResponse({ data: {} });
      }
    })();
    return true; // keep message channel open for async response
  });
}

if (process.env.NODE_ENV !== 'production') console.log('[Oracle Scanner] Content script loaded on', window.location.href);
