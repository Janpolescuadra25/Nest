# Phase 2A: Add Debug Logging to scanner.ts for Verification

## Context
We just rewrote `Frontend/src/content/scanner.ts` in Phase 2 (commit b5cdbdf) to scrape real Toast POS Sales Summary data using 17 `data-testid` selectors. We now need to verify the scanner works on the LIVE Toast POS page before moving to Phase 2B.

Your job: Add comprehensive debug logging to `scanner.ts` WITHOUT changing any existing logic, selectors, or data flow. All existing code must work exactly as before. Only ADD `console.log` / `console.warn` / `console.error` statements.

## ABSOLUTE RULES (violating any of these = instant reject)

1. **DO NOT change any existing logic, selectors, helper functions, or return values**
2. **DO NOT change the `parseValue` function signature** — it stays `(raw: string): number`. No extra parameters.
3. **DO NOT change the data format** — `ScanData = Record<string, number>` stays the same
4. **DO NOT add new dependencies or imports**
5. **DO NOT touch any other file** (no types, no views, no manifest)
6. **ONLY add console.log / console.warn / console.error statements**
7. All logs must be prefixed with `[Nest Scanner]` for easy filtering in DevTools
8. Keep the file clean and readable — max ~30 log statements total

## What to Add

### 1. URL Logging (in the message listener, NOT in scanSalesSummary)

The URL guard lives in the message listener, not in `scanSalesSummary()`. Log the URL and guard result THERE:

```typescript
// Inside the message listener, BEFORE the URL guard:
console.log('[Nest Scanner] URL:', url);

// When the guard fails:
if (!isSalesSummary) {
  console.warn('[Nest Scanner] Returning null — reason: wrong page');
  sendResponse({ data: null });
  return true;
}
```

### 2. Per-Section Key Count Logging

For each of the 17 sections, log whether the tbody was found AND how many keys were extracted from the returned object (NOT the DOM row count — row count is misleading for multi-column tables).

**For key-value tables** (Revenue, Net Sales, Tips, Cash Activity, Cash Summary, Unpaid Orders, Void):

```typescript
const sectionData = extractKeyValueTable(
  document.querySelector('tbody[data-testid="revenue-summary-table-body"]'),
  'Revenue'
);
const keyCount = Object.keys(sectionData).length;
console.log(`[Nest Scanner] Section "Revenue": tbody found = ${!!document.querySelector('tbody[data-testid="revenue-summary-table-body"]')} | keys = ${keyCount}`);
Object.assign(data, sectionData);
```

**For multi-column tables** (Payments, Sales Category, Tax, Discount, Service Charge, Revenue Center, Service Daypart, Dining Option, Service Mode, Deferred):

```typescript
const sectionData = extractMultiColumnTable(
  document.querySelector('thead[data-testid="payments-summary-table-header"]'),
  document.querySelector('tbody[data-testid="payments-summary-table-body"]'),
  'Payments'
);
const keyCount = Object.keys(sectionData).length;
console.log(`[Nest Scanner] Section "Payments": tbody found = ${!!document.querySelector('tbody[data-testid="payments-summary-table-body"]')} | keys = ${keyCount}`);
Object.assign(data, sectionData);
```

Apply this pattern to ALL 17 sections.

### 3. Key Count Summary

After all sections are collected, BEFORE returning from `scanSalesSummary()`, log:

```typescript
console.log(`[Nest Scanner] Extracted ${Object.keys(data).length} keys total`);
console.log('[Nest Scanner] Keys:', Object.keys(data).join(', '));
```

### 4. Value Validation

After the key count, check and log any problematic values:

```typescript
const invalidKeys = Object.entries(data).filter(([k, v]) => v === undefined || v === null || isNaN(v));
if (invalidKeys.length > 0) {
  console.warn('[Nest Scanner] WARNING: Invalid values found:', invalidKeys);
} else {
  console.log('[Nest Scanner] All values are valid numbers ✓');
}
```

### 5. Negative Value Check

Log all keys with negative values (important for accounting verification):

```typescript
const negatives = Object.entries(data).filter(([k, v]) => v < 0);
if (negatives.length > 0) {
  console.log('[Nest Scanner] Negative values:', negatives.map(([k, v]) => `${k}: ${v}`));
}
```

### 6. Time Value Skips

The existing `parseValue` function already has a `console.warn` for time values. **DO NOT change `parseValue`** — its signature stays `(raw: string): number`.

The existing log is sufficient:
```typescript
console.warn(`[Nest Scanner] Skipping time value: ${s}`);
```

This is already in the code. Do NOT add a `key` parameter to `parseValue`. The raw value logged is enough to identify which cell produced the time value during verification.

### 7. Error Path Logging

In the message listener, log the specific reason whenever `data: null` is returned:

```typescript
// Wrong page (already covered in #1 above)
console.warn('[Nest Scanner] Returning null — reason: wrong page');

// Timeout
if (!el) {
  console.error('[Nest Scanner] Timed out waiting for Sales Summary page to load');
  console.warn('[Nest Scanner] Returning null — reason: timeout');
  sendResponse({ data: null });
  return;
}

// Empty scan
if (Object.keys(scanData).length === 0) {
  console.error('[Nest Scanner] Page loaded but no data extracted — selectors may be outdated');
  console.warn('[Nest Scanner] Returning null — reason: empty scan');
  sendResponse({ data: null });
  return;
}

// Catch block
catch (err) {
  console.error('[Nest Scanner] Scan failed:', err);
  console.warn('[Nest Scanner] Returning null — reason: error');
  sendResponse({ data: null });
}
```

### 8. Total Row Detection

For multi-column tables, log when a total row is detected inside `extractMultiColumnTable`:

```typescript
if (total) {
  console.log(`[Nest Scanner] Section "${sectionPrefix}": detected total row "${label}"`);
}
```

Add this AFTER the `const total = isTotalRow(row);` line, BEFORE the label normalization.

## Expected Console Output

When the user opens DevTools console on the live Toast Sales Summary page and triggers a scan, they should see something like:

```
[Nest Scanner] URL: https://www.toasttab.com/restaurants/xxx/reports/sales/sales-summary?startDate=...
[Nest Scanner] Section "Revenue": tbody found = true | keys = 8
[Nest Scanner] Section "Net Sales": tbody found = true | keys = 4
[Nest Scanner] Section "Tips": tbody found = true | keys = 3
[Nest Scanner] Section "Cash Activity": tbody found = true | keys = 9
[Nest Scanner] Section "Cash Summary": tbody found = true | keys = 6
[Nest Scanner] Section "Unpaid Orders": tbody found = true | keys = 1
[Nest Scanner] Section "Void": tbody found = true | keys = 4
[Nest Scanner] Section "Payments": tbody found = true | keys = 30
[Nest Scanner] Section "Payments": detected total row "Total"
[Nest Scanner] Section "Sales Category": tbody found = true | keys = 25
[Nest Scanner] Section "Sales Category": detected total row "Total"
[Nest Scanner] Section "Tax": tbody found = true | keys = 9
[Nest Scanner] Section "Discount": tbody found = true | keys = 6
[Nest Scanner] Section "Discount": detected total row "Total discounts"
[Nest Scanner] Section "Service Charge": tbody found = true | keys = 6
[Nest Scanner] Section "Service Charge": detected total row "Total service charges"
[Nest Scanner] Section "Revenue Center": tbody found = true | keys = 14
[Nest Scanner] Section "Revenue Center": detected total row "Total"
[Nest Scanner] Section "Service Daypart": tbody found = true | keys = 8
[Nest Scanner] Section "Dining Option": tbody found = true | keys = 8
[Nest Scanner] Section "Service Mode": tbody found = true | keys = 24
[Nest Scanner] Section "Deferred": tbody found = true | keys = 10
[Nest Scanner] Extracted 153 keys total
[Nest Scanner] Keys: Revenue.Net Sales, Revenue.Gratuity, Revenue.Tax Amount, ...
[Nest Scanner] All values are valid numbers ✓
[Nest Scanner] Negative values: Cash Activity.Credit/non-cash tips: -7201.74
```

## Verification

After making changes:

1. Run `npx tsc --noEmit` — must have zero errors
2. Run `npm run build` — must succeed
3. Commit with message: `feat: add debug logging to scanner for verification phase`
4. Do NOT push (user will test locally first)

## Deliverables

1. **Modified file**: `Frontend/src/content/scanner.ts` — only additions, no logic changes
2. **NO other files touched**
