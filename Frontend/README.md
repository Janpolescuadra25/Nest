# Qyra — Chrome Extension (Frontend)

## Overview
MV3 Chrome extension built with React 18 + TypeScript + Tailwind CSS + esbuild. Scans POS reports (Toast, Salido, Oracle), Excel files, and images (Gemini OCR). Maps data to QuickBooks transaction types and syncs via the backend API.

## Architecture
- `src/popup/` — Main popup UI (App.tsx root, components/, hooks/, lib/, contexts/)
- `src/background/service-worker.ts` — MV3 service worker (OAuth messaging, scan orchestration)
- `src/content/` — Content scripts for POS DOM scraping (scanner.ts=Toast, salido-scanner.ts, oracle-scanner.ts)
- `src/lib/` — Config, types

### Key Components
- `ScanView.tsx` — Scan tab (POS/Excel/Image modes, cheque template cards, "Sync All Cheques" button)
- `MappingView/index.tsx` — Map tab (column mapping, AI Suggest, Auto-Detect)
- `JournalEntryPreview.tsx` — JE preview (variable-column padding, account visibility)
- `SyncView.tsx` — Sync history (errorType categories: AUTH, TRANSIENT, VALIDATION, FATAL)
- `CheckPreviewForm.tsx` — Cheque preview/sync form
- `WelcomeOverlay.tsx` — Role-based welcome (OWNER/ADMIN/MANAGER/VIEWER)
- `LogoSplash.tsx` — First-install logo splash (chrome.storage.local gated)

### State Management
- React Context: `QBContext.tsx` (accounts, classes, employees, vendors, customers)
- Custom hooks: `useAuth`, `useQuickBooks`, `useLocations`, `useDuplicateCheck`
- In-memory state in `App.tsx`: `scanData`, `scanEntries`, `activeScanEntryId`, `selectedTemplateForScan` — not persisted across popup close (F-6 target)
- `chrome.storage.local`: `lastScanData`, `hasSeenLogoAnimation`
- `localStorage`: JE column visibility (`qyra_je_col_vis`)

## Build
```bash
npm run build
```
Outputs to `dist/`. Load as unpacked extension in Chrome at `chrome://extensions/` (enable Developer Mode).

## Manifest
- Version: 1.0.1
- Permissions: activeTab, storage, tabs, scripting, windows
- Host permissions: localhost:3000, *.onrender.com, toasttab/salido/oraclerestaurants POS domains
- CSP: allows intuit/quickbooks endpoints
- Extension ID: ccghhfmkjbcakhnoamgihifonfiammoc

## Testing
Vitest tests in `src/popup/lib/__tests__/`:
- `batch-payload-builder.test.ts`
- `je-builder.test.ts`
- `mapping-conditions.test.ts`
- `parse-numeric-value.test.ts`
- `resolve-value-mapping.test.ts`
- `scan-mode-utils.test.ts`
- `scanview-parse-excel.test.ts`
- `value-mapping-column-utils.test.ts`
- `app-bill-preview-routing.test.tsx`

## Store Prep
`STORE_LISTING.md` contains Chrome Web Store listing copy. Extension description aligned in manifest.

## Completion Status
**DONE** — Core extension features implemented and verified:
- Scan (POS/Excel/Image modes)
- Cheque auto-mapping (11 columns) + template cards + Sync All Cheques button
- JE preview with variable-column padding
- AI Suggest and Auto-Detect for Excel
- Map tab with column mapping
- Sync history with errorType categorization
- Welcome overlay + logo splash
- Store listing prep (STORE_LISTING.md, manifest v1.0.1, `<all_urls>` removed)
- Frontend type check clean (tsc --noEmit, zero errors)
- F-6: Tab-switch state persistence (scan data lost on popup close) — upcoming
