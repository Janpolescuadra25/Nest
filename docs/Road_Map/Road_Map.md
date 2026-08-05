## ✅ Completed Phases

- **R-1: Rebrand Backend** — Commit `c392366`. 20 files rebranded (Nest → AutoBooks, nestsync.fyi → autobooks.cloud, NEST- → AB-). All 7 sync-batch tests pass.
- **R-2: Rebrand Frontend** — Commit `54cbe87`. 25 files + 1 new icon file rebranded. 78 frontend tests pass, `tsc --noEmit` clean, `npm run build` succeeds. localStorage migration added for `nest_je_col_vis` → `autobooks_je_col_vis`.
- **R-3: Rebrand Web + Root Configs** — Commit `c93a8ff`. Root and web files rebranded. `render.yaml` now uses `autobooks-backend` and `noreply@autobooks.cloud`. All web pages now use AutoBooks branding.
- **L-1: Remove Partner Section** — Commit `0626652`. Removed "Become a Partner" CTA, nav links, partner section, and partner form JS from `web/index.html`. Signup form and `setMessage` helper preserved.

## 🗺️ AutoBooks Roadmap — Cypra v3 (Complete)

### Repo State (`0626652`, clean, pushed)

| Area | Status |
|---|---|
| Frontend tests | 78/78 ✅ |
| Backend tests | 30/40 (10 pre-existing failures in 4 suites) |
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
1. **Porkbun DNS:** Point `autobooks.cloud` A/CNAME records to Render's hostname
2. **Render env vars:** `RESEND_FROM_ADDRESS`, `QB_REDIRECT_URI`, `APP_URL`, `FRONTEND_URL`, `LANDING_PAGE_URL`
3. **Resend:** Add `autobooks.cloud` as verified sending domain. Configure SPF/DKIM/DMARC DNS records on Porkbun per Resend's instructions
4. **Intuit Developer Portal:** Update OAuth redirect URI if domain changes
5. **Vercel:** Update custom domain from `nestsync.fyi` to `autobooks.cloud` for `web/` directory
6. **Chrome Web Store:** Update listing name, description, support URL
7. **Test:** Signup, email verification, password reset, OAuth — all with new domain

**Expected output:** `autobooks.cloud` resolves. Emails send from `noreply@autobooks.cloud`. OAuth works. Landing page loads.

---

### Phase T-be-fix: Fix Pre-Existing Backend Test Failures

**What:** Fix 4 broken test suites unmasked by the ts-jest config fix.

#### T-be-fix-1a: `stripe-plans.test.ts` (1 scoping + 1 fix prompt)

**Scoping:** Hydra reads `stripe-plans` source + test. Documents current `PLANS` shape vs test expectations.
**Fix:** Update test assertions to match current `PLANS` type (remove `features` reference).

#### T-be-fix-1b: `webhooks.test.ts` (1 scoping + 1-2 fix prompts)

**Scoping:** Hydra reads `webhooks.ts` route + test. Documents each failing test's mock vs actual Prisma call shapes.
**Fix:** Update 7 failing tests' mock return values and assertion fields.

#### T-be-fix-1c: `capacity-middleware.test.ts` (1 scoping + 1 fix prompt)

**Scoping:** Hydra reads `capacity.middleware.ts` + test. Documents `permissions` JSON structure vs old boolean fields.
**Fix:** Update 2 tests to use `permissions: { scan: true, ... }` instead of `canScan: true`.

#### T-be-fix-1d: `team-status.test.ts` (1 scoping + 1 fix prompt)

**Scoping:** Hydra reads `team-status.ts` + test. Documents what test expects vs current behavior.
**Fix:** Remove assertions on deprecated field writes.

**Expected output:** `npx jest` passes 40/40. Backend test suite is fully green.

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

### Phase W: Workflow Restructure (For Review / Approved / Sync Tabs)

**What:** Split the current single SyncView into three tabs with a role-based draft/approve/sync workflow.

**This is the largest feature.** It changes the fundamental user flow from "scan → sync" to "scan → draft → review → approve → sync."

#### W-1: Scoping Audit (1 Hydra audit)

**What Hydra needs to read:**
1. `Frontend/src/popup/components/SyncView.tsx` — full component structure, how scans are fetched, filtered, and displayed
2. `Frontend/src/popup/components/ScanView.tsx` — how scans transition from scanning to the sync queue
3. `Frontend/src/popup/components/BillPreviewForm.tsx` — the preview/edit flow
4. `Frontend/src/popup/App.tsx` — how views/tabs are routed
5. `Backend/src/routes/scans.ts` — scan status transitions, what status values exist
6. `Backend/src/middleware/permissions.ts` — current role permissions (especially `sync:execute`, `approveUsers`, `setPermissions`)
7. `Backend/src/middleware/capacity.ts` — how capacity is checked per role
8. Search for `DRAFTED`, `FOR_REVIEW`, `APPROVED` status values — do they already exist?

**Purpose:** Map the current flow end-to-end and determine what schema changes, API changes, and UI changes are needed.

---

#### W-2: Database Schema — Add New Statuses (1 prompt)

**What:** Add `DRAFTED` and `FOR_REVIEW` status values to the scan record lifecycle.

**Current flow:** `PENDING` → `MAPPED` → `PENDING_APPROVAL` → `APPROVED` → `SYNCED` / `FAILED` / `REJECTED`

**New flow:**
```
Scan created → DRAFTED
  Staff: can only draft (scan → DRAFTED, cannot modify mapping)
  Accountant: can draft + modify mapping (DRAFTED → DRAFTED with changes)
  Accountant/Staff: submit for review → FOR_REVIEW
  Manager: can view FOR_REVIEW, modify mapping/entry, approve → APPROVED
  Admin: same power as Manager (modify + approve)
  Manager/Admin: direct sync from APPROVED → SYNCED
  All APPROVED entries appear in Sync tab as "pending sync"
  After sync → status becomes SYNCED
```

**Scoping note:** `PENDING_APPROVAL` may already serve as `FOR_REVIEW`. W-1 audit will confirm. If so, no schema change needed — just rename/repurpose.

**Expected output:** Prisma migration adding/updating status enum. All existing statuses preserved.

---

#### W-3: Role-Based Permissions Update (1 prompt)

**What:** Update the permission system to enforce the draft/approve/sync workflow.

**Role permissions:**

| Action | Staff | Accountant | Manager | Admin | Owner |
|---|---|---|---|---|---|
| Scan (create) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Draft entry | ✅ | ✅ | ✅ | ✅ | ✅ |
| Modify mapping | ❌ | ✅ | ✅ | ✅ | ✅ |
| Submit for review | ✅ | ✅ | ✅ | ✅ | ✅ |
| View "For Review" tab | Own only | Own only | All | All | All |
| Modify entry in review | ❌ | Own only | All | All | All |
| Approve entry | ❌ | ❌ | ✅ | ✅ | ✅ |
| Direct sync to QB | ❌ | ❌ | ✅ | ✅ | ✅ |
| View "Approved" tab | ❌ | ❌ | ✅ | ✅ | ✅ |
| View "Sync" tab | ❌ | ❌ | ✅ | ✅ | ✅ |
| Hard delete scans | ❌ | ❌ | ✅ | ✅ | ✅ |

**Scoping needed:** W-1 audit determines what permission checks already exist and what needs to be added.

**Expected output:** Backend enforces role-based workflow. Staff cannot modify mapping. Accountant cannot sync. Only Manager+ can approve and sync.

---

#### W-4: Frontend — Tab Restructure (2-3 prompts)

**What:** Replace the current single SyncView with three tabs: "For Review", "Approved", "Sync".

**Scoping needed:** W-1 audit determines the current component structure.

**Expected UI:**

**Tab 1: "For Review"**
- Shows all entries with status `DRAFTED` or `FOR_REVIEW` (filtered by role: staff/accountant see own; manager/admin see all)
- Accountant can edit their own entries (modify mapping, change fields)
- Manager/Admin can edit any entry
- "Submit for Review" button (moves entry to `FOR_REVIEW` status)
- "Approve" button (Manager/Admin only — moves to `APPROVED`)

**Tab 2: "Approved"**
- Shows all entries with status `APPROVED`
- Manager/Admin can still modify before syncing
- "Sync to QuickBooks" button (Manager/Admin only)
- "Sync All Approved" bulk action
- After sync, entry moves to Sync tab with `SYNCED` status

**Tab 3: "Sync"**
- Shows all entries with status `SYNCED`, `FAILED`, and `PENDING` (approved but not yet synced)
- This is the current sync queue
- Only shows entries that have been approved and are awaiting sync or already synced
- "Sync All Pending" button (for approved entries not yet synced)
- Row selection + "Sync Selected" (from F-2)

**Expected output:** Three-tab workflow. Role-based visibility and actions. Clear separation between drafting, reviewing, and syncing.

---

#### W-5: Backend — Workflow API Endpoints (1-2 prompts)

**What:** Add/modify endpoints to support the workflow.

**Likely endpoints needed:**
- `PATCH /scans/:id/status` — transition status (DRAFTED → FOR_REVIEW → APPROVED)
- `POST /scans/bulk-approve` — approve multiple entries at once
- `POST /scans/bulk-sync` — sync multiple approved entries (may already exist as sync-batch)
- `DELETE /scans/bulk` — hard delete selected scans (with role check)

**Scoping:** W-1 audit confirms which endpoints already exist and which are new.

**Expected output:** Backend supports all status transitions. Role-based access control enforced.

---

### Phase E: Bulk Cheque Excel Scan

**What:** A new scan type for uploading Excel files containing cheque data. Each row = one cheque in QuickBooks (unless payee + check no. + payment date match, then merge into one cheque with multiple line items).

#### E-1: Scoping Audit (1 Hydra audit)

**What Hydra needs to read:**
1. Current Excel scan implementation — how are Excel files parsed? What scan types exist? Where is the Excel parser?
2. `Frontend/src/popup/components/ScanView.tsx` — how are different scan types selected and processed?
3. Current mapping system — how does `MappingView` handle column mapping for different scan types?
4. Preview system — how does `BillPreviewForm` render line items? Is there already a ChequePreviewForm?
5. `Backend/src/routes/scans.ts` — how are different scan types stored and processed?
6. Prisma schema — what fields exist on ScanRecord for storing parsed cheque data?

**Purpose:** Understand the current Excel scan pipeline to determine how to add the cheque scan type.

---

#### E-2: Excel Cheque Format — Fixed Columns (1-2 prompts)

**What:** Define the fixed column format for cheque Excel files.

**Required columns (Row 1 = headers):**

| Column | Header | Type | Required | Mapping |
|---|---|---|---|---|
| 1 | Payee | String | ✅ | User maps values (e.g., "Kevin" → "Kevin Durant") |
| 2 | Bank Account | String | ✅ | User maps to QB bank account |
| 3 | Payment Date | Date | ✅ | Format: MM/DD/YYYY or YYYY-MM-DD |
| 4 | Check No. | String | ✅ | Used for merge logic |
| 5 | Category | String | ✅ | User maps values (e.g., "Maynilad" → "Utilities Expense") |
| 6 | Description | String | ✅ | Auto-fills from Excel |
| 7 | Amount | Number | ✅ | Decimal |
| 8 | Tax | String | ❌ | "Exclusive", "Inclusive", or "Out of Scope" |
| 9 | Customer | String | ❌ | User maps values |
| 10 | QB Memo | String | ❌ | Auto-fills from Excel |
| 11 | Tax Type | String | ❌ | Maps to Exclusive/Inclusive/Out of Scope |

**Merge logic:** If rows share the same Payee + Check No. + Payment Date → merge into 1 cheque with multiple line items (Category, Description, Amount, Tax per line item).

**Format enforcement:** Users CANNOT customize column order. The format is fixed. If the Excel doesn't match, show a clear error: "Column 1 must be 'Payee'. Found: [actual header]."

**Expected output:** Parser validates column headers. Parses data rows. Merges rows with matching payee+checkno+date. Returns structured cheque data for mapping.

---

#### E-3: Cheque Mapping (Payee, Category, Tax, Customer) (1-2 prompts)

**What:** Extend the mapping system to support cheque-specific fields.

**Mapping behavior:**
- **Payee mapping:** User maps detected payee names to QB vendor names. E.g., all rows where Payee contains "Kevin" → vendor "Kevin Durant"
- **Category mapping:** User maps detected category text to QB expense accounts. E.g., "Maynilad" → "Utilities Expense"
- **Tax mapping:** User maps tax column values to QB tax codes
- **Customer mapping:** User maps customer names to QB customers
- **"Merge same category" option:** When enabled, multiple line items with the same mapped category are merged into one line item with summed amounts

**Expected output:** Mapping section shows detected unique values for Payee, Category, Tax, Customer. User maps each to a QB entity. Mapped values appear correctly in preview.

---

#### E-4: Cheque Preview (1-2 prompts)

**What:** Render cheque previews — one cheque form per unique payee+checkno+date combination, with line items for each data row.

**Preview behavior:**
- Each merged cheque shows as one cheque form
- Cheque header: Payee, Bank Account, Payment Date, Check No.
- Line items: Category, Description, Amount, Tax, Customer, QB Memo per row
- User can review and edit before syncing
- "Sync to QuickBooks" creates one `Cheque` in QB per cheque form (with multiple `Line` items)

**Expected output:** Users see cheque previews with correct merge logic. Each cheque form has the right line items. Syncing creates correct QB Cheque records.

---

### Phase A: Owner Invite Link + Admin Resource Distribution

#### A-1: Scoping Audit (1 Hydra audit)

**What Hydra needs to audit:**
1. `Backend/src/routes/admin.ts` — does invite creation set `allocatedScans/Locations/Templates` and `maxMembers`?
2. `Backend/src/routes/owner.ts` — does the owner have endpoints to set resource limits on admins?
3. `Backend/src/middleware/capacity.ts` — how does it enforce `maxScans`? Does it check `allocatedScans` vs `poolScans`?
4. Search for `poolScans`, `allocatedScans`, `poolLocations`, `poolTemplates`, `maxMembers` — are they currently READ or WRITTEN in any route?
5. Frontend admin settings UI — is there a place where admins manage their members?

**Purpose:** Determine what distribution logic exists vs. what needs to be built.

---

#### A-2: Admin Resource Distribution Logic (1-3 prompts, scope depends on A-1)

**What:** Implement the owner→admin→member resource distribution.

**Flow:**
1. Owner invites admin with limits: `allocatedScans: 100`, `allocatedLocations: 10`, `allocatedTemplates: 20`, `maxMembers: 3`, `timeBombAt: <date>`
2. Admin registers → User record gets these values. `poolScans = allocatedScans` (initially full).
3. Admin invites member and assigns: `allocatedScans: 20`, `allocatedLocations: 3`, `allocatedTemplates: 5`
4. Admin's pools reduce: `poolScans = 100 - 20 = 80`, `poolLocations = 10 - 3 = 7`, `poolTemplates = 20 - 5 = 15`
5. Admin invites 2 more members (each 20 scans) → `poolScans = 80 - 20 - 20 = 40`
6. Capacity enforcement: member's scans count against their `allocatedScans`. Admin's remaining scans count against `poolScans`.

**Two registration paths:**
- Via owner's invite link → Admin role, resource-limited, no subscription plan
- Direct registration (landing page) → Subscriber role, plan-based limits (Stripe), no owner relationship

**Expected output:** Full distribution system. Owner controls admin limits. Admin distributes to members. Counts reduce correctly. Capacity enforced at every level.

---

### Execution Order

| # | Phase | Prompt | Depends On | Can Parallel With |
|---|---|---|---|---|
| 1 | R-1 | Rebrand Backend | — | R-2, R-3, A-1, T-be-fix |
| 2 | R-2 | Rebrand Frontend | — | R-1, R-3 |
| 3 | R-3 | Rebrand Web + Configs | — | R-1, R-2 |
| 4 | L-1 | Remove Partner Section | — | R-1 |
| 5 | R-4 | Domain Migration (manual) | R-1, R-2, R-3 | — |
| 6 | T-be-fix | Fix 4 broken test suites | — | R-1 |
| 7 | F-1 | Default Memo Auto-Fill | — | F-2 |
| 8 | F-2 | Row Selection | — | F-1 |
| 9 | A-1 | Admin Distribution Scoping | — | R-1 |
| 10 | W-1 | Workflow Scoping Audit | — | R-1, F-2 |
| 11 | E-1 | Cheque Excel Scoping | — | R-1 |
| 12 | W-2 | Schema + Status Updates | W-1 | — |
| 13 | W-3 | Role Permissions Update | W-1, W-2 | — |
| 14 | E-2 | Cheque Excel Format + Parser | E-1 | — |
| 15 | W-4 | Frontend Tab Restructure | W-1, W-2, W-3 | — |
| 16 | E-3 | Cheque Mapping | E-2 | — |
| 17 | W-5 | Workflow API Endpoints | W-2, W-3 | W-4 |
| 18 | E-4 | Cheque Preview | E-2, E-3 | — |
| 19 | A-2 | Admin Distribution Logic | A-1 | — |

**Recommended first moves (parallel-safe):**
- **R-1** (rebrand backend) — start immediately
- **A-1** (admin distribution scoping) — start immediately, determines A-2 scope
- **W-1** (workflow scoping) — start immediately, determines W phases scope