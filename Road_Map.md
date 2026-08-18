# Qyra — Product Roadmap
Last Updated: 2026-08-19

## Current Verified State
- **Backend Test Suite**: 117/117 passing, 20/20 suites
- **Backend Compilation**: Clean (`tsc --noEmit` exits with 0)
- **Backend Logging**: Pino structured logging with request IDs. Temporary `console.log` debug calls present in `templates.ts` and `ScanView.tsx` for cheque parse diagnostics (commit `9356e5a`) — to be removed after issue resolution.
- **Backend Error Shape**: Flat — `{ error: "message string" }` with optional `fields` object. 100% of route error responses use AppError/asyncHandler pipeline.
- **Backend Validation**: All 22 routes have Zod schema validation.
- **Backend Health Checks**: Liveness (`/health/live`) and readiness (`/health/ready`) with DB and S3 connectivity checks.
- **Landing Page**: Updated hero copy ("From Any Document to QuickBooks — Automatically"), all "reconciliation" wording removed, 3-slide auto-play intro overlay with skip button, CSS animations (fade-in-up keyframes, Intersection Observer scroll reveal on feature cards).
- **Extension Welcome Overlay**: Logo + tagline fade-in-up animation. First-install logo splash screen (one-time, fullscreen, chrome.storage.local tracked). All original functionality preserved.
- **Frontend Type Check**: Clean (`tsc --noEmit` exits with 0, zero errors). All 6 type errors across 5 files resolved.
- **Extension Store Prep**: STORE_LISTING.md created, manifest description aligned, version 1.0.1, `<all_urls>` removed.
- **Deployment Infrastructure**: Backend on Render.com, PostgreSQL on Neon.
- **Scan Section — Cheque Auto-Mapping**: Fixed 11-column default mappings applied automatically for CHEQUE Excel; no manual column mapping required.
- **Scan Section — JE Preview**: Variable-column padding (`maxCols`) ensures all JE Excel columns render in the preview table.
- **Scan Section — AI Suggest for Excel**: `disableAutoDetect` gate removed; AI Suggest and Auto-Detect both functional in Excel mode.
- **Known Issue — Cheque Line Item Count**: Map tab "Scanned Line Items" shows 1 line item instead of N. Debug console.logs deployed at 3 pipeline points (commit 9356e5a). Awaiting diagnosis.

## Active Phases

### F-5A: User QA & Cheque Bug Diagnosis
- **Goal**: Complete browser-based QA of all scan and landing page workflows, and diagnose the cheque line item count bug on the Map tab.
- **What needs to be achieved**:
  1. Verify cheque Excel flow end-to-end (parse → mapping → review → sync navigation)
  2. Verify JE Excel preview displays metadata and full transaction rows
  3. Verify AI Suggest for Excel templates is available and functional
  4. Verify landing page animations and extension intro interact correctly
  5. Verify all health endpoints and browser compatibility
  6. **Diagnose cheque bug**: Open DevTools, scan a multi-row cheque Excel, navigate to Map tab, and report the `[CHEQUE DEBUG]`, `[SCAN DEBUG]`, and `[MAP DEBUG]` console output
- **Acceptance Criteria**:
  - All 5 verification items pass in Chrome (latest), Firefox (latest), and Edge (latest)
  - Console debug output from the 3 checkpoint logs is reported for the cheque bug
  - Bug diagnosis narrows the root cause to either backend grouping, frontend mapping, or `activeScanEntry` derivation

## Upcoming Phases

### F-6: Cheque Bug Fix & Scan Data Flow Hardening
- **Goal**: Fix the Map tab "1 line item" bug for cheque Excel and harden the scan-to-map data pipeline against state loss on tab switch.
- **Deliverables**:
  - Root cause identified and fixed (backend grouping, frontend mapping, or `activeScanEntry` derivation)
  - All 5 debug `console.log` lines removed from `templates.ts` and `ScanView.tsx`
  - Cheque Excel with N rows shows N line items on the Map tab
  - Scan state (`scanEntries`, `uploadedExcelFile`) persists when switching tabs
  - Unit test added to `Backend/tests/cheque-parser.test.ts` asserting N rows → 1 transaction with N lineItems
- **Acceptance Criteria**:
  - Cheque Excel with 7 rows → Map tab shows "7 line items detected"
  - Tab switching (scan → map → scan) preserves the parsed file and entries
  - Zero `console.log` debug lines remain in production code
  - Backend tests still pass (117+)

### F-7: Multi-Document Batch Scanning
- **Goal**: Allow users to upload and scan multiple documents in a single session, with a queue-based workflow and batch sync capability.
- **Deliverables**:
  - Multi-file upload UI (drag-and-drop zone accepts multiple files)
  - Scan queue panel showing processing status per document
  - Batch review table consolidating all parsed transactions
  - "Sync All" bulk action across all documents in the queue
  - Per-document error handling and retry
- **Acceptance Criteria**:
  - User can upload 3+ documents simultaneously
  - Failed individual scans don't block the rest of the batch
  - Sync All pushes all valid transactions across all documents

### F-8: Advanced Mapping Presets & User Custom Mappings
- **Goal**: Enable users to save, load, and share column mapping presets beyond the built-in template defaults.
- **Deliverables**:
  - "Save as Preset" button in mapping configuration
  - Preset management panel (list, rename, delete, export/import as JSON)
  - Apply saved preset to new scans of the same template type
  - Share preset via clipboard (copy JSON to clipboard)
- **Acceptance Criteria**:
  - User can save a custom mapping and reapply it in under 3 clicks
  - Exported preset JSON can be imported on another device
  - Built-in defaults are never overwritten by user presets

### F-9: Sync Analytics, Auto-Retry & Webhook Status
- **Goal**: Add intelligent sync observability and automated recovery on top of the existing sync history infrastructure.
- **Deliverables**:
  - Aggregated error analytics dashboard built on existing `errorType` categories (AUTH, TRANSIENT, VALIDATION, FATAL) — adds filterable views, counts per type, and trend visualization
  - Sync success rate trends over time (daily/weekly charts)
  - Auto-retry with exponential backoff for transient QuickBooks API failures (429, 502, 503, 504)
  - Webhook-based real-time sync status updates (push notification when a background sync completes or fails)
  - Sync summary email/notification digest (daily or per-session)
- **Acceptance Criteria**:
  - Dashboard displays per-category error counts and trends, leveraging the existing 4 errorType categories
  - Auto-retry attempts up to 3 times with backoff before marking as permanently failed
  - Webhook status pushes update the sync history view without manual refresh
  - Success rate chart renders with at least 7 days of data

### F-10: Chrome Web Store Submission & Launch
- **Goal**: Submit Qyra to the Chrome Web Store and launch publicly.
- **Prerequisites (user-dependent)**:
  - Capture 4 Chrome Web Store screenshots (scan flow, map flow, sync history, settings) at 1280×800 or 1920×1080
  - Open Chrome Web Store developer account (one-time $5 fee)
  - Provide live privacy policy URL (landing page `/privacy` or external)
- **Deliverables**:
  - Final production build (frontend + backend) deployed to Render.com
  - Chrome Web Store listing published (description from STORE_LISTING.md, screenshots, category, privacy policy)
  - Store review process monitored and any rejections addressed
  - Public announcement (landing page live, social links if applicable)
  - Post-launch monitoring (error tracking, user feedback channel)
- **Acceptance Criteria**:
  - Extension is live and installable from the Chrome Web Store
  - All store assets (4+ screenshots, description, privacy policy) are approved by Chrome Web Store review
  - Production backend health endpoints respond within SLA
  - Zero critical errors in the first 48 hours post-launch

## Next Priority
1. **Immediate (F-5A)**: Complete the user QA checklist and diagnose the cheque line item bug. These are prerequisites for both F-6 (bug fix) and store submission.
2. **Short-term (F-6)**: Fix the cheque bug and harden scan data flow. This unblocks reliable cheque workflows.
3. **Medium-term (F-7 → F-10)**: Batch scanning, custom presets, sync analytics, and Chrome Web Store launch — in that order. Each phase builds on the previous.
