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

## 🗺️ Qyra Roadmap — Cypra v5 (Complete)

### Repo State (`fdb3315`, clean, pushed)

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

#### A-2: Admin Resource Distribution — Close 4 Gaps (1 prompt)

**What:** Fix 4 gaps identified by A-1 scoping audit. All gaps are small, pattern-repeatable fixes in existing code.

**Gap 1: Add `poolTemplates` to 2 backend write paths**
- `Backend/src/routes/adminRequests.ts` — admin approval (`POST /:id/approve`): add `poolTemplates` to the body destructuring alongside existing `poolScans`/`poolLocations`/`maxMembers`, add `poolTemplates: poolTemplates ?? 25` to the `prisma.user.create` call
- `Backend/src/routes/owner.ts` — `PUT /admins/:id/pool`: add `poolTemplates` to body destructuring and `prisma.user.update` call, add `poolTemplates` and `previousPoolTemplates` to the `logAction` details for audit consistency

**Gap 2: Enforce `maxMembers` in capacity middleware**
- `Backend/src/middleware/capacity.ts` — in the admin pool branch (the `if (team.poolScans != null || team.poolLocations != null)` block): before the final `return next()`, add a member count check when `requireCapacity` is called with `'user'` action. Guard with `if (team.maxMembers != null)` — only enforce when the field is explicitly set (it can be null if the admin's pool was updated without specifying `maxMembers`). When enforced, query `prisma.user.count({ where: { adminId: team.id, status: { not: 'DISABLED' } } })` and compare against `team.maxMembers`. Return a 403 response with `{ error: 'USER_LIMIT_REACHED', currentUsage: memberCount, limit: team.maxMembers, message: '...' }` matching the existing plan-based `user` action response shape at capacity.ts. Match the existing plan-based `user` action pattern exactly (same query shape, same status filter, same error code, same response format).

**Gap 3: Set `managedById` in direct invite creation**
- `Backend/src/routes/admin.ts` — in the `prisma.user.create` call inside `POST /team/invite`: add `managedById: req.user!.userId` alongside existing `adminId: req.user!.userId`. This ensures direct-invite members appear in allocation management endpoints (`PATCH /team/:id/allocation`, `GET /admins/:id/members`, `PUT /admins/:id/members/:userId/allocation`), which all query by `managedById` to find members. No capacity middleware changes needed — the middleware resolves `teamId` from `req.user!.adminId` (the admin's ID), so setting `managedById` on the member record has no effect on enforcement behavior.

**Gap 4: Add `poolTemplates` + `allocatedTemplates` to 2 backend GET endpoints + frontend**
- `Backend/src/routes/owner.ts` — `GET /admins/pools`: add `poolTemplates: true` to the admin `select`
- `Backend/src/routes/owner.ts` — `GET /admins/:id/members`: add `allocatedTemplates: true` to the member `select`, add `poolTemplates: admin.poolTemplates` to the admin response object, add `remainingTemplates` calculation (poolTemplates minus sum of all members' allocatedTemplates) alongside existing `remainingScans`/`remainingLocations`
- `Frontend/src/popup/components/AdminsTab.tsx` — add `poolTemplates` input to pool editor and approval form, add `allocatedTemplates` input to member allocation editor, add `remainingTemplates` to pool stats display
- `Frontend/src/popup/lib/api.ts` — add `poolTemplates` to `updateOwnerAdminPool` and `approveAdminRequest` payload types, add `allocatedTemplates` to `updateOwnerMemberAllocation` payload type. Update `OwnerAdminPool` response interface to include `poolTemplates: number | null`. Update `OwnerAdminMember` response interface to include `allocatedTemplates: number | null`.

**Expected output:** All 4 gaps closed. `poolTemplates` flows end-to-end (owner sets → admin pool → member allocation → capacity enforcement → frontend display). `maxMembers` blocks invites when limit reached (with null guard for admins without `maxMembers` set). Direct-invite members get `managedById` set and appear in allocation management endpoints. Frontend shows all 3 resource types in pool/member editors. Backend tests: 44/44 still pass. Frontend tests: 78/78 still pass.

---

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
| 1 | R-4 | Domain Migration (manual) | R-1, R-2, R-3 | — |
| 2 | T-be-fix (done) | Fix 4 broken test suites | — | R-1 |
| 3 | F-1 | Default Memo Auto-Fill | — | F-2 |
| 4 | F-2 | Row Selection | — | F-1 |
| 5 | E-1 | Cheque Excel Scoping | — | R-1 |
| 6 | E-2 | Cheque Excel Format + Parser | E-1 | — |
| 7 | E-3 | Cheque Mapping | E-2 | — |
| 8 | E-4 | Cheque Preview | E-2, E-3 | — |
| 9 | A-1 (done) | Admin Distribution Scoping | — | R-1 |
| 10 | A-2 | Admin Resource Distribution Logic | A-1 | — |
