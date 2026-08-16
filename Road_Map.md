# Qyra — Product Roadmap
Last Updated: 2026-08-17

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

## Active Phases

### F-3: Landing Page Deployment & Cross-Browser Verification
- **Goal**: Deploy the updated landing page (new copy, animations, 3-slide intro overlay) and extension (logo splash, welcome overlay animation) to production on Render.com, and verify everything works across modern browsers.
- **What needs to be achieved**:
  - Deploy the backend (including the updated landing page at `Backend/public/landing/index.html`) to Render.com
  - Deploy the extension (including new `LogoSplash.tsx` and updated `App.tsx`) to the Chrome Web Store or load unpacked for testing
  - Verify the landing page 3-slide intro auto-plays correctly (3.5s per slide, skip button works, progress dots update)
  - Verify the extension first-install logo splash plays only once (chrome.storage.local flag works)
  - Verify hero copy "From Any Document to QuickBooks — Automatically" renders correctly in Chrome, Firefox, Safari, and Edge
  - Verify all CSS animations (fadeInUp, fadeIn, introLogoScale, logoSplash) work across target browsers
  - Verify Intersection Observer scroll-reveal triggers correctly on the features section
  - Confirm zero instances of "reconciliation" on the deployed page
  - Verify all links, CTAs, and navigation elements still function correctly

## Next Priority
Deploy the updated landing page to production and verify all animations and copy render correctly across modern browsers (F-3).
