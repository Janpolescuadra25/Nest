# Qyra — Product Roadmap
Last Updated: 2026-08-21

## Current Verified State
- **Backend Test Suite**: 117/117 passing, 20/20 suites
- **Backend Compilation**: Clean (`tsc --noEmit` exits with 0)
- **Backend Logging**: Pino structured logging with request IDs. Zero console.* calls in src/.
- **Backend Error Shape**: Flat — `{ error: "message string" }` with optional `fields` object. 20/22 route files use the AppError/asyncHandler pipeline; 2 routes (exports, notifications) use asyncHandler without explicit AppError throws.
- **Backend Validation**: 18/22 route files have explicit Zod schema validation; 4 routes (email-verification, exports, webhooks, mappings) use alternative handling.
- **Backend Health Checks**: Liveness (`/health/live`) and readiness (`/health/ready`) with DB and S3 connectivity checks.
- **Landing Page**: Updated hero copy ("From Any Document to QuickBooks — Automatically"), all "reconciliation" wording removed, 3-slide auto-play intro overlay with skip button, CSS animations (fade-in-up keyframes, Intersection Observer scroll reveal on feature cards), particle + line constellation canvas animation (commit `1b2e061`).
- **Extension Welcome Overlay**: Logo + tagline fade-in-up animation. First-install logo splash screen (one-time, fullscreen, chrome.storage.local tracked). All original functionality preserved.
- **Frontend Type Check**: Clean (`tsc --noEmit` exits with 0, zero errors). All 6 type errors across 5 files resolved.
- **Extension Store Prep**: STORE_LISTING.md created, manifest description aligned, version 1.0.1, `<all_urls>` fully removed from host_permissions, content_scripts, and web_accessible_resources.
- **Deployment Infrastructure**: Backend on Render.com, PostgreSQL on Neon.
- **Scan Section — Cheque Auto-Mapping**: Fixed 11-column default mappings applied automatically for CHEQUE Excel; no manual column mapping required.
- **Scan Section — JE Preview**: Column visibility toggles (`colVis` state persisted to localStorage via `qyra_je_col_vis`) allow users to show/hide JE columns in the preview table.
- **Scan Section — AI Suggest for Excel**: `disableAutoDetect` prop is never passed from MappingView call site, so AI Suggest and Auto-Detect buttons are always enabled in Excel mode. The prop remains as dead code in MappingFilters.tsx.
- CHEQUE preview: each Excel row produces a separate cheque form in the Preview tab (individual sync + Sync All button). Backend CHEQUE parser creates one transaction per row. CheckPreviewForm auto-populates date, check number, bank account, and payee from Excel data via existing header auto-resolution.
- **Known Issue — Cheque Line Item Count**: RESOLVED. Fixed at commit `5e2b5be` (CHEQUE parser creates one transaction per row) and `110a33e` (CHEQUE preview UX redesign + debug log cleanup). Debug logs removed. Cheque preview redesigned as individual cards per row.

## Active Phases

### F-5A: User QA & Verification
- **Goal**: Complete browser-based QA of all scan and landing page workflows.
- **What needs to be achieved**:
  1. Verify cheque Excel flow end-to-end (parse → mapping → review → sync navigation)
  2. Verify JE Excel preview displays metadata and full transaction rows
  3. Verify AI Suggest for Excel templates is available and functional
  4. Verify landing page animations and extension intro interact correctly
  5. Verify all health endpoints and browser compatibility
- **Acceptance Criteria**:
  - All 5 verification items pass in Chrome (latest), Firefox (latest), and Edge (latest)

## Upcoming Phases

### F-6: Scan Data Flow Hardening
- **Goal**: Harden the scan-to-map data pipeline against state loss on tab switch.
- **Deliverables**:
  - Tab-switch state persistence fix to prevent component unmount data loss
- **Acceptance Criteria**:
  - Tab switching (scan → map → scan) preserves the parsed file and entries
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

### F-11: AI-Powered Value Mapping Suggestions

**Goal:** Extend AI Suggest to automatically recommend value-to-entity mappings (payee→vendor, bank account→QB account, category→QB account, tax type→QB tax code) by matching scanned data against QuickBooks reference data, with fuzzy matching and confidence levels.

**Context:** Current AI Suggest (`Backend/src/lib/gemini.ts` L576-670, endpoint at `Backend/src/routes/mappings.ts` L120-180) only suggests column-to-account field mappings for Journal Entry POS scans. Value mapping UI exists for Cheque/Bill/JE in EXCEL mode (`Frontend/src/popup/components/MappingView/ValueMappingSection.tsx`) but has zero AI assistance — all value mappings are manual dropdown selection. The `disableAutoDetect` prop in `MappingFilters.tsx` is dead code (defined but never passed from MappingView, defaults to undefined/falsy) — the AI Suggest button is already technically enabled for all templates but the backend only supports account mapping suggestions.

**Deliverables:**
- ✅ **Clean up `disableAutoDetect` dead code**: Remove the prop and all its references from `MappingFilters.tsx` only. This is pure cleanup — removing it changes no behavior since it was never passed.
- ✅ **Backend value suggestion endpoint**: New `POST /api/mappings/suggest-values` endpoint that accepts scan data (extracted row values) + template type + mapping field type (payee/bank/category/tax), queries QB reference data via existing `qb.service.ts` methods (vendors, accounts, tax codes), and returns ranked suggestions with match type (exact/fuzzy/none) and confidence score.
- **AI-powered fuzzy matching**: Use Gemini to compare scanned values against QB reference data. Exact string match = auto-apply. Substring/abbreviation match (e.g., "Jp" → "Jeypee Enterprises") = suggest with note explaining the match. No match = suggest creating a new QB entity or leaving unmapped. **Fuzzy matches must NEVER be auto-applied** — user must explicitly accept to prevent data integrity issues.
- ✅ **Frontend value suggestion UI**: Add an "AI Suggest Values" button to each `ValueMappingSection` (or a single button above all value mapping accordions). Display suggestions as inline recommendation chips/badges with accept/reject actions. Show confidence level and match reasoning (e.g., "Jeypee Enterprises in QuickBooks may match Jp in your spreadsheet").
- **Support all EXCEL-mode templates**: Cheque (payee, bank account, category, tax type), Bill (vendor, account, tax type), Journal Entry (payee, account, category). Each template type has different value mapping fields — the endpoint and UI must handle all permutations.
- ✅ **Batch apply**: Allow user to "Accept All" suggestions for a single mapping category (e.g., accept all payee suggestions at once) or individually accept/reject.
- **Rate limiting and caching**: Add rate limiting to the new endpoint to prevent Gemini API cost abuse. Cache QB reference data (vendors, accounts, tax codes) to reduce QuickBooks API calls — invalidate cache on sync events or after a configurable TTL.
- **Maintain test suite**: All new code must pass existing tests (currently 117/117 passing) plus new tests for the endpoint.

**Acceptance Criteria:**
- `disableAutoDetect` prop and all references removed from `MappingFilters.tsx`
- `POST /api/mappings/suggest-values` returns ranked suggestions for any template type + field type
- Exact matches auto-applied, fuzzy matches shown with explanation (never auto-applied), no matches flagged
- AI Suggest Values button functional in Cheque, Bill, and Journal Entry EXCEL modes
- Suggestions include match type, confidence score, and human-readable reasoning
- User can accept/reject individual suggestions or batch-accept per category
- Rate limiting active on the new endpoint
- QB reference data cached to reduce API calls
- Backend test suite remains 117/117+ passing

### F-9: Sync Analytics, Auto-Retry & Webhook Status

**Goal:** Strengthen sync reliability and observability through auto-retry, error categorization, alerting, and dashboard metrics.

**Deliverables:**
- ✅ **Auto-retry with exponential backoff**: 4 attempts in `callQB()` with exponential backoff (1s/2s/4s) — `Backend/src/services/qb.service.ts` L835-861.
- ✅ **Error categorization & logging**: `QBApiError.category` getter returns `AUTH | TRANSIENT | VALIDATION | FATAL` — `Backend/src/lib/qb-errors.ts` L14-18.
- ✅ **Manual retry endpoint**: `POST /api/quickbooks/retry/:scanRecordId`, max 3 attempts — `Backend/src/routes/quickbooks.ts` L1747-1813.
- ✅ **Sync failure alerting**: `startSyncFailureAlertCron()` runs scheduled failure checks — `Backend/src/cron/sync-failure-alerts.ts` L11.
- ✅ **Error dashboard metrics**: `GET /api/analytics/dashboard` returns `syncStatusBreakdown: { synced, failed, pending }` — `Backend/src/routes/analytics.ts` L98-102.
- **Aggregated error analytics dashboard UI**: Filterable views, per-category counts, and trend visualization (API endpoint exists, frontend dashboard not yet built).
- **Sync success rate trends**: Daily/weekly charts over time.
- **Webhook-based real-time sync status**: Push notification when a background sync completes or fails.
- **Sync summary email/notification digest**: Daily or per-session summary.
- **Retry queue persistence**: Persist retry attempts to the database to survive server restarts.
- **Circuit breaker pattern**: Implement a circuit breaker that temporarily stops retrying after repeated failures to a specific endpoint.
- **Error archive**: Archive resolved errors after a retention period for audit and compliance purposes.

**Acceptance Criteria:**
- 4 attempts in `callQB()` with exponential backoff, 3 in manual retry endpoint
- Errors categorized into 4 types (AUTH, TRANSIENT, VALIDATION, FATAL) with structured logging
- Failure alerts cron active and notifying on threshold breach
- Analytics endpoint returns sync status breakdown (synced, failed, pending)

*5 of 12 deliverables completed. 7 remaining.*

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
1. **Immediate (F-5A)**: Complete the user QA checklist. This is a prerequisite for both F-6 and store submission.
2. **Short-term (F-6)**: Harden scan data flow. This unblocks reliable cheque workflows.
3. **Medium-term (F-7 → F-8 → F-11 → F-9 → F-10)**: Batch scanning, custom presets, AI-powered value mapping suggestions, sync analytics, and Chrome Web Store launch — in that order. Each phase builds on the previous.
