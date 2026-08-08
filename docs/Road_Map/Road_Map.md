## ✅ Completed Phases

- **R-1: Rebrand Backend** — Commit `c392366`. 20 files rebranded (Nest → AutoBooks, nestsync.fyi → autobooks.cloud, NEST- → AB-). All 7 sync-batch tests pass.
- **R-2: Rebrand Frontend** — Commit `54cbe87`. 25 files + 1 new icon file rebranded. 78 frontend tests pass, `tsc --noEmit` clean, `npm run build` succeeds. localStorage migration added for `nest_je_col_vis` → `autobooks_je_col_vis`.
- **R-3: Rebrand Web + Root Configs** — Commit `c93a8ff`. Root and web files rebranded. `render.yaml` now uses `qyra-backend` and `noreply@qyra.space`. All web pages now use Qyra branding.
- **S-1a: Rebrand Backend** — `d5f399d`. AutoBooks → Solyra across Backend/ (~65 references, 16 files). DocNumber prefix `AB-` → `S-`.
- **S-1b: Rebrand Frontend** — `2df16b6`. AutoBooks → Solyra across Frontend/ (~75 references, 16 files). Legacy migration chains updated (nest → autobooks → solyra). New Solyra icons integrated.
- **S-1c: Rebrand Web + Root Configs** — `eacf637`. AutoBooks → Solyra across web/ and root configs (~55 references, 7 files). Case-sensitive `-creplace` used throughout.
- **S-2a: Backend Qyra Rebrand** — `ece5767`.
- **S-2b: Frontend Qyra Rebrand** — `9c3f524`.
- **S-2c: Web + Configs Qyra Rebrand** — `05f7a82`.
- **L-1: Remove Partner Section** — Commit `0626652`. Removed "Become a Partner" CTA, nav links, partner section, and partner form JS from `web/index.html`. Signup form and `setMessage` helper preserved.
- **W-2: Database Schema** — SKIPPED. `PENDING_APPROVAL` already serves as "For Review", `PENDING` serves as "Drafted". No schema change needed.
- **W-3: Role-Based Permissions Update** — Commit `b1a7170`. Removed `sync:execute` from ACCOUNTANT role (kept `sync:read`).
- **W-5: Backend Workflow API Endpoints** — Commit `b1a7170`. Added `POST /bulk-approve`, `DELETE /:id`, `POST /bulk-delete` to `scans.ts`.
- **W-1: Workflow Scoping Audit** — Scoping audit completed. Output drove W-2 (skipped), W-3, W-4, W-5.
- **W-4: Frontend Tab Restructure** — Commit `6b490d9`. Split Sync tab into Review / Approved / Sync-History. Added `mode` prop to SyncView + 3 API methods (`bulkApproveScans`, `deleteScan`, `bulkDeleteScans`). 78 tests pass.
- **T-be-fix-1a: Fix stripe-plans.test.ts** — Commit `3f44041`. Full rewrite — updated PLANS shape assertions (tier existence, numeric limits, pricing, priority support).
- **T-be-fix-1b: Fix webhooks.test.ts** — Commit `9f482fc`. Added Prisma `stripeEvent` mocks, `PLANS`/`getPlanLimits`/`getScanPack` to stripe mock, fixed `MockPrisma` type, corrected env vars + assertions. 44/44 pass.
- **T-be-fix-1c: Fix capacity-middleware.test.ts** — Commit `a008cab`. Corrected plan key (`solo` → `starter`), fixed error code assertions to match current middleware output (`USER_LIMIT_REACHED`, `LOCATION_LIMIT_REACHED`).
- **T-be-fix-1d: Fix team-status.test.ts** — Commit `95e6cca`. Added missing `auditLog.createMany` mock method.
- **A-1: Admin Distribution Scoping** — Repo state `fdb3315`. Hydra audit confirmed ~80% of owner→admin→member distribution is built. Identified 5 gaps (4 to fix, 1 optional): `poolTemplates` missing from 2 write paths + 2 GET endpoints, `maxMembers` unenforced, `managedById` not set in direct invite, frontend missing `poolTemplates`/`allocatedTemplates` inputs, `MANAGER` role excluded from allocation UI (deferred).
- **A-2: Admin Resource Distribution** — Closed 4 gaps in owner→admin→member resource system: added `poolTemplates` to 2 backend write paths + 2 GET endpoints (which also expose `allocatedTemplates` per member and compute `remainingTemplates`), enforced `maxMembers` in capacity middleware (with null guard), set `managedById` in direct invite creation (enables direct-invite members to appear in allocation management endpoints), added `poolTemplates`/`allocatedTemplates`/`remainingTemplates` to frontend types, state, and UI. Commit `472bf7f`. All tests green (44/44 backend, 78/78 frontend, tsc clean).
- **E-1: Cheque Excel Scoping Audit** — Audited 6 areas (parser, ScanView, MappingView, preview, scans routes, Prisma schema). Found 11/11 pipeline stages already built: Excel parsing via exceljs with template-driven columnMappings, CHEQUE as valid transactionType, payee+checkNo+date merge grouping in ScanView, CheckPreviewForm with multi-line items, PayeeMapping + ValueMapping (account/class/tax), frontend+backend buildChequePayload, QB Purchase API sync, ScanRecord with transactionType:CHEQUE. JP confirmed fixed 11-column format (replacing flexible mappings for CHEQUE). Remaining: E-2 fixed format implementation, E-3 customer mapping refinement + merge-same-category option, E-4 already implemented. Repo state `76f1f53` at audit time.

## 🗺️ Qyra Roadmap — Cypra v5 (Complete)

### Repo State (`76f1f53`, clean, pushed)

| Area | Status |
|---|---|
| Frontend tests | 78/78 ✅ |
| Backend tests | 44/44 ✅ |
| Invite system | ✅ Fully built (InviteLink model, 7 endpoints) |
| Resource allocation fields | ✅ `allocatedScans/Locations/Templates`, `poolScans/Locations/Templates`, `maxMembers`, `timeBombAt` on User model |
| Capacity/permissions | ✅ Feature-based (`scan:write`, `sync:execute`, etc.) |
| Subscription system | ✅ Stripe (`currentPlan`, `currentPeriodEnd`, free tier) |
| H-memo2 (memo + privateNote) | ✅ Implemented + tested (frontend 78 tests, backend 7 tests) |
| Bulk cheque multi-line sync | ✅ Implemented (backend) |
| Rebrand scope | ~42 source files + 8 domain files + Render env vars |

---

### Phase R: Rebrand (Nest → AutoBooks)

Pure text/metadata changes. No logic changes. ~42 files.

---


#### R-4: Domain Migration (Manual — JP only)

**JP's steps:**
1. **Porkbun DNS:** Point `qyra.space` A/CNAME records to Render's hostname
2. **Render env vars:** `RESEND_FROM_ADDRESS`, `QB_REDIRECT_URI`, `APP_URL`, `FRONTEND_URL`, `LANDING_PAGE_URL`
3. **Resend:** Add `qyra.space` as verified sending domain. Configure SPF/DKIM/DMARC DNS records on Porkbun per Resend's instructions
4. **Intuit Developer Portal:** Update OAuth redirect URI if domain changes
5. **Vercel:** Update custom domain from `nestsync.fyi` to `qyra.space` for `web/` directory
6. **Chrome Web Store:** Update listing name, description, support URL
7. **Test:** Signup, email verification, password reset, OAuth — all with new domain

**Expected output:** `qyra.space` resolves. Emails send from `noreply@qyra.space`. OAuth works. Landing page loads.

---

### Phase F: Feature Foundation (Smaller Features)

#### F-1: Default Memo Auto-Fill (1-2 prompts)

**What:** Every form type (JE, Bill, Cheque, Vendor Credit) has a "Memo" field in QuickBooks. Users should be able to set a customizable default memo that auto-fills when creating entries.

**Scoping needed:** Hydra audits:
1. `Frontend/src/popup/components/BillPreviewForm.tsx` — how is the memo field currently rendered? Is there already a default?
2. Same for `JournalEntryPreview.tsx`, `VendorCreditPreviewForm.tsx`, and the Cheque preview form
3. `Frontend/src/popup/components/MappingView/index.tsx` — is there a settings section where default memo could be configured?
4. Does the User model or a settings model store per-form-type defaults?

**Expected behavior:**
- In MappingView (or SettingsView), user can set a default memo for each form type: JE, Bill, Cheque, Vendor Credit
- Default memo persists (localStorage or backend)
- When creating a new entry in the preview form, the memo field pre-fills with the default
- User can still edit the memo before syncing — default is just a starting point
- QB Memo (visible in QuickBooks) and Private Memo (internal only) each have their own default

**Expected output:** Each preview form auto-fills its memo field with the user's configured default. Defaults are saved and persist across sessions.

---

#### F-2: Row Selection in SyncView (W-fe-row-select) (1-2 prompts)

**What:** Add row-level checkboxes to the pending sync table. "Sync Selected" and "Delete Selected" bulk action buttons.

**Scoping needed:** Hydra reads `Frontend/src/popup/components/SyncView.tsx` — documents current table column structure, how scan data is passed, how `api.syncBatch` is called, existing state patterns.

**Expected behavior:**
- Checkbox column (first column) on each scan row
- "Select All" checkbox in table header
- When 1+ rows checked: "Sync Selected (N)" button appears + "Delete Selected (N)" button appears
- "Sync Selected" calls `api.syncBatch` with only checked scans
- "Delete Selected" hard-deletes checked scans (with confirmation dialog)
- "Sync All Pending" button still works unchanged for syncing everything

**Expected output:** Users can selectively sync or delete individual scans. No backend changes needed.

---

### Phase E: Bulk Cheque Excel Scan

**What:** A new scan type for uploading Excel files containing cheque data. Each row = one cheque in QuickBooks (unless payee + check no. + payment date match, then merge into one cheque with multiple line items).

#### E-1: Cheque Excel Scoping Audit (done)

**Outcome:** Completed audit. The existing pipeline already supports CHEQUE transactionType, Excel parsing via `columnMappings`, payee+checkNo+date grouping in `ScanView`, multi-line cheque preview rendering, and backend QB cheque payload building.

**Remaining work:**
- E-2: enforce a fixed 11-column CHEQUE Excel format in the parser
- E-3: refine customer mapping and add an optional same-category merge path before preview

**Why E-4 is removed:** Cheque preview is already implemented in the current code, so it is no longer a separate scope item.

---

#### E-2: Cheque Fixed-Column Excel Parser (1-2 prompts)

**What:** Enforce a fixed 11-column format for CHEQUE Excel files.

**Required columns (Row 1 = headers):**

| Column | Header | Required | Notes |
|---|---|---|---|
| 1 | Payee | ✅ | Used for grouping and vendor mapping |
| 2 | Bank Account | ✅ | Maps to QB bank account |
| 3 | Payment Date | ✅ | Format: MM/DD/YYYY or YYYY-MM-DD |
| 4 | Check No. | ✅ | Used for grouping |
| 5 | Category | ✅ | Maps to QB expense account |
| 6 | Description | ✅ | Cheque line description |
| 7 | Amount | ✅ | Decimal amount |
| 8 | Tax | ❌ | Exclusive / Inclusive / Out of Scope |
| 9 | Customer | ❌ | Maps to QB customer |
| 10 | QB Memo | ❌ | Cheque-level memo |
| 11 | Tax Type | ❌ | Maps to tax type when present |

**Expected behavior:**
- Validate exact header names and order for CHEQUE files
- Reject files that do not match the fixed schema with a clear header error
- Parse row 2+ as cheque rows where columns 1-4 + 10 are header-level fields and columns 5-9 + 11 are line-item fields
- Preserve existing downstream grouping and preview behavior

---

#### E-3: Customer Mapping Refinement + Same-Category Merge Option (1 prompt)

**What:** Close the remaining cheque mapping gaps.

**Scope:**
- Add a dedicated `customer` mapping field type so users can map cheque row `Customer` values directly to QuickBooks customers
- Keep existing `name` mapping for generic vendor/employee/name resolution
- Optionally allow multiple cheque line items with the same mapped category to merge into a single line item with a summed amount before preview

**Expected behavior:**
- Mapping UI exposes `Customer` as a first-class field type for cheque scans
- Preview shows accurate mapped customers and categories
- Optional same-category merge produces a cleaner cheque payload when enabled

---

### Execution Order

| # | Phase | Prompt | Depends On | Can Parallel With |
|---|---|---|---|---|
| 1 | R-4 | Domain Migration (manual) | R-1, R-2, R-3 | — |
| 2 | T-be-fix (done) | Fix 4 broken test suites | — | R-1 |
| 3 | F-1 | Default Memo Auto-Fill | — | F-2 |
| 4 | F-2 | Row Selection | — | F-1 |
| 5 | E-1 (done) | Cheque Excel Scoping Audit | — | R-1 |
| 6 | E-2 | Cheque Fixed-Column Excel Parser | E-1 | — |
| 7 | E-3 | Customer Mapping + Merge Option | E-2 | — |
| 8 | A-1 (done) | Admin Distribution Scoping | — | R-1 |
| 9 | A-2 (done) | Admin Resource Distribution Logic | A-1 | — |
