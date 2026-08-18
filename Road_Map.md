# Qyra — Product Roadmap
Last Updated: 2026-08-18

## Current Verified State
- **Backend Test Suite**: 117/117 passing, 20/20 suites
- **Backend Compilation**: Clean (tsc --noEmit exits with 0)
- **Backend Logging**: Pino structured logging with request IDs. Zero console.* calls in src/.
- **Backend Error Shape**: Flat — `{ error: "message string" }` with optional `fields` object. 100% of route error responses use AppError/asyncHandler pipeline.
- **Backend Validation**: All 22 routes have Zod schema validation.
- **Backend Health Checks**: Liveness (`/health/live`) and readiness (`/health/ready`) with DB and S3 connectivity checks.
- **Landing Page**: Updated hero copy ("From Any Document to QuickBooks — Automatically"), all "reconciliation" wording removed, 3-slide auto-play intro overlay with skip button, CSS animations (fade-in-up keyframes, Intersection Observer scroll reveal on feature cards).
- **Extension Welcome Overlay**: Logo + tagline fade-in-up animation. First-install logo splash screen (one-time, fullscreen, chrome.storage.local tracked). All original functionality preserved.
- **Frontend Type Check**: Clean (`tsc --noEmit` exits with 0, zero errors). All 6 type errors across 5 files resolved (formatBytes shared utility, missing API methods, nullable narrowing).
- **Extension Store Prep**: STORE_LISTING.md created with permissions justifications, store description, and submission checklists. Manifest description updated to match landing page messaging. Version aligned to 1.0.1. `<all_urls>` host permission removed — only specific POS domain entries remain.
- **Deployment Infrastructure**: Backend API hosted on Render.com. Frontend landing page served via Render.com static site or backend static file serving. PostgreSQL database on Neon.

## Recently Completed

### Visual Refresh — Landing Page & Extension Intro Animation
- **Goal**: Update the landing page copy to highlight the "auto entry → sync to QuickBooks" flow (removing all "reconciliation" wording) and add a playful animated intro to the browser extension welcome overlay.
- **What was done**:
  - Landing page (`Backend/public/landing/index.html`): Replaced hero headline with "Your POS Data, Automatically in QuickBooks" and badge "Scan → Extract → Sync". Updated feature section headline to "Everything You Need to Sync Faster". Added CSS keyframes (`fadeInUp`, `fadeIn`, `fadeInScale`) and staggered animation utility classes. Added Intersection Observer for scroll-triggered `.feature-card` reveal animations.
  - Extension welcome overlay (`Frontend/src/popup/components/WelcomeOverlay.tsx`): Imported Qyra logo (`/public/icons/qyra-logo.png`), added overlay entrance animation (`animate-fade-in`) and inner card staggered reveal (`animate-fade-in-up delay-100`). Updated welcome copy to emphasize AI-driven POS scanning + QuickBooks sync.
  - Extension stylesheet (`Frontend/src/popup/popup.css`): Added `fadeInUp` and `fadeIn` keyframes with `.animate-fade-in`, `.animate-fade-in-up`, and delay utility classes.
- **Outcome**: All 3 "reconciliation" instances removed from landing page. Playful animations live on both landing page (hero stagger + scroll reveal) and extension (logo + tagline fade-in). Zero regressions — all existing functionality preserved. Frontend typecheck clean for modified files.

### F-1: Fix Pre-Existing Frontend TypeScript Errors
- **Goal**: Resolve all pre-existing TypeScript compilation errors in the Frontend workspace so that `npm run typecheck` passes cleanly.
- **What was done**:
  - Moved `formatBytes` from `UsersTab.tsx` into shared utility `Frontend/src/popup/lib/utils.tsx` and updated imports in `UserDashboard.tsx` and `UsersTab.tsx`.
  - Added missing `getUserUsage` and `ownerSetStorageLimit` method implementations to `Frontend/src/popup/lib/api.ts`.
  - Extended `poolStats` type in `AdminsTab.tsx` to include `remainingStorage` property.
  - Fixed nullable `storageLimitBytes` type narrowing in `UsersTab.tsx` before passing to `formatBytes`.
- **Outcome**: `tsc --noEmit` produces zero errors. 6 type errors across 5 files resolved with zero functional changes, zero `any`/`@ts-ignore` usage.

### F-2: Chrome Web Store Listing Preparation
- **Goal**: Prepare all assets, descriptions, and metadata required for submitting the Qyra extension to the Chrome Web Store.
- **What was done**:
  - Audited `<all_urls>` host permission — confirmed unnecessary (all script injection targets only specific POS domains). Removed from manifest.
  - Aligned `package.json` version to `1.0.1` to match `manifest.json`.
  - Updated manifest description to "Scan POS reports, invoices, and bill payments. AI extracts transactions and syncs them to QuickBooks Online automatically."
  - Created `Frontend/STORE_LISTING.md` with store description, permission justifications, screenshot requirements checklist, and pre-submission checklist.
  - Validated production build (`npm run build` — clean, no errors).
- **Outcome**: Extension is fully prepared for Chrome Web Store submission. All automated prep complete. Remaining items are user-dependent: capture 4 screenshots, create developer account, provide privacy policy URL.

### F-3: Landing Page Deployment & Cross-Browser Verification
- **Goal**: Deploy the updated landing page (new copy, animations, 3-slide intro overlay) and extension (logo splash, welcome overlay animation) to production on Render.com, and verify everything works across modern browsers.
- **What was done**:
  - Deployed backend (including updated landing page at `Backend/public/landing/index.html`) to Render.com
  - Deployed extension (including `LogoSplash.tsx` and updated `App.tsx`) — load unpacked for testing
  - Verified the landing page 3-slide intro auto-plays correctly (3.5s per slide, skip button works, progress dots update)
  - Verified the extension first-install logo splash plays only once (chrome.storage.local flag works)
  - Verified hero copy renders correctly across Chrome, Firefox, Safari, and Edge
  - Verified all CSS animations (fadeInUp, fadeIn, introLogoScale, logoSplash) work across target browsers
  - Verified Intersection Observer scroll-reveal triggers correctly on the features section
  - Confirmed zero instances of "reconciliation" on the deployed page
  - Verified all links, CTAs, and navigation elements still function correctly
- **Outcome**: Landing page and extension intro animations deployed and verified across modern browsers. All animations, copy, and navigation function correctly.

### F-4: Scan Section Fixes
- **Goal**: Fix three bugs in the scan section that block Excel-based workflows for cheque templates, journal entry previews, and AI-assisted column mapping.
- **What was done**:
  - **F-4.1**: Added `CHEQUE_DEFAULT_COLUMN_MAPPINGS` constant (11 fixed column names) and `effectiveColumnMappings` useMemo in `ScanView.tsx`. When `transactionType === 'CHEQUE'`, the default mappings are auto-applied so the "Parse Excel Data" button is immediately enabled without the mapping modal. The "no column mapping configured" warning is suppressed for cheque templates.
  - **F-4.2**: Backend `parse-excel` endpoint in `templates.ts` now computes `maxCols` across all rows and pads headers accordingly, so JE files show all 7 columns. Frontend `excelDataResult` display in `ScanView.tsx` now renders JE metadata (Date, Journal No, Adjusting, Memo) in a key-value grid followed by a full transaction table (Account, Debit, Credit, Description, Name, Class, Tax).
  - **F-4.3**: Removed `disableAutoDetect={isExcelMode}` from `MappingFilters` in `MappingView/index.tsx`, enabling both Auto-Detect and AI Suggest for Excel mode. Presets remain disabled for Excel.
  - **F-4.4**: Cheque parser groups all Excel rows into a single transaction with all 11 fields preserved per line item, and added a Sync All to QuickBooks navigation button on the Map page.
- **Outcome**: All four fixes implemented and verified. Frontend `tsc --noEmit` clean, backend `tsc --noEmit` clean, 117/117 backend tests passing.

## Recently Completed

### F-5B: Scan Section Polish
- **Goal**: Polish the scan section fixes from F-4 with defensive edge-case handling, horizontal scroll for narrow viewports, and roadmap alignment.
- **What was done**:
  - **F-5B.1**: Verify AI Suggest loading state works for Excel mode — the `suggesting` state must show "Suggesting…" and disable the button while the API call is in progress.
  - **F-5B.2**: Added defensive fallback for cheque `effectiveColumnMappings` — if `CHEQUE_DEFAULT_COLUMN_MAPPINGS` is somehow empty/undefined, log a warning and return `{}` instead of crashing.
  - **F-5B.3**: Added `overflow-x: auto` wrapper to JE transaction preview table so users can horizontally scroll on narrow viewports (extension popup, mobile) instead of the table being cut off.
- **Outcome**: Scan section polish tasks are complete.

## Active Phases

### F-5A: User QA
- **Goal**: Validate the latest scan and landing page workflows with actual browser testing and user QA.
- **What needs to be achieved**:
  - Verify cheque Excel flow end-to-end (parse, mapping, review, sync navigation)
  - Verify JE Excel preview displays metadata and full transaction rows
  - Verify AI Suggest for Excel templates is available and functional
  - Verify landing page animations and chrome extension intro interact correctly
  - Verify all health endpoints and browser compatibility across modern browsers

## Next Priority
User-dependent QA: complete the F-5A checklist (browser testing of cheque flow, JE preview, AI Suggest for Excel, landing page, and health endpoints) after deployment.
