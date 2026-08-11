## ✅ Completed Phases

- **Rebrand (9 commits)**: Nest → AutoBooks → Solyra → Qyra — text/metadata only across ~42 files. `c392366` `54cbe87` `c93a8ff` `d5f399d` `2df16b6` `eacf637` `ece5767` `9c3f524` `05f7a82`
- **Workflow Restructure (2 commits)**: scoping audit, role permissions, tab restructure, bulk endpoints. W-2 (schema) skipped. `b1a7170` `6b490d9`
- **Backend Test Fixes (4 commits)**: fixed stripe-plans, webhooks, capacity-middleware, team-status. `3f44041` `9f482fc` `a008cab` `95e6cca`
- **L-1**: Partner Section Removal. `0626652`
- **A-1**: Admin Distribution Scoping — audited 4 gaps. `56b9a43`
- **A-2**: Admin Resource Distribution — closed 4 gaps. `472bf7f`
- **E-1**: Cheque Excel Scoping Audit — 11/11 pipeline stages built, reduced Phase E scope. `bcbac30`
- **E-2**: Cheque Fixed-Column Excel Parser — 11-col header validation, 6 new tests (50/50). `b02a173`
- **E-3: Customer Data Flow** — Extract customer from line items, pass as CustomerRef on Cheque header. 5 new tests (80/80 + 53/53). `955af6d`
- **F-2: Row Selection in SyncView** — Row-level checkboxes, "Sync Selected" and "Delete Selected" with role/permission checks. `80d96f3`
- **F-1: Default Memo Auto-Fill** — Cheque defaults section gains QB Memo + Private Note input fields and save logic. JE gains `defaults.privateNote` support with `prev ||` priority chain. `e899e8c`
- **UI Cleanup** — Removed redundant "Qyra" text below login logo, removed partner section from landing page (HTML + JS), restricted status filter dropdown per tab (For Review hides "Approved", Approved hides filter entirely). `e9d9ce6`
- **H: Fixed Cheque Excel Format** — Cheque-specific MappingView UI (hide Column Roles, show fixed 11-column format). CheckPreviewForm reads fixed columns directly. batch-payload-builder preserves string fields. 1 new test (81/81 + 53/53). `9cfca33` `8b09240`
- **I: Admin Resource Distribution** — Already fully implemented via A-1/A-2. Owner sets admin pools (PUT /api/owner/admins/:id/pool). Admin distributes scans/locations/templates to members (PATCH /api/admin/team/:id/allocation). Pool validation enforces limits. Frontend: AdminsTab (owner) + MyTeamTab (admin). Capacity middleware enforces at request time.
- **R-4: Domain Migration** — `qyra.space` live: Render Starter plan, custom domain connected, Resend verified (DKIM/SPF/DMARC), Intuit redirect URI updated, env vars updated. Chrome Web Store pending.
- **J: Tab UI Polish** — Mode-specific filters, cards, and banners. Review tab shows For Review + Rejected cards. Approved tab shows Approved card. Sync tab shows Total + Synced + Failed + Pending. Sync button + banner only on Sync tab. `4e09eed`

---

## 🗺️ Qyra Roadmap — Cypra v5 (Complete)

### Repo State (`91bad8a`, pushed)

| Area | Status |
|---|---|
| Frontend tests | 81/81 ✅ |
| Backend tests | 53/53 ✅ |
| Invite system | ✅ Fully built (InviteLink model, 7 endpoints) |
| Resource allocation fields | ✅ `allocatedScans/Locations/Templates`, `poolScans/Locations/Templates`, `maxMembers`, `timeBombAt` on User model |
| Capacity/permissions | ✅ Feature-based (`scan:write`, `sync:execute`, etc.) |
| Subscription system | ✅ Stripe (`currentPlan`, `currentPeriodEnd`, free tier) |
| H-memo2 (memo + privateNote) | ✅ Implemented + tested (frontend 78 tests, backend 7 tests) |
| Bulk cheque multi-line sync | ✅ Implemented (backend) |
| Rebrand scope | ~42 source files + 8 domain files + Render env vars |

---

### Phase R: Domain Migration

#### R-4: Domain Migration

**Outcome:** Completed. `qyra.space` is live — Render upgraded to Starter plan, custom domain connected, Resend domain verified (DKIM/SPF/DMARC), Intuit redirect URI updated to `https://qyra.space/api/quickbooks/callback`, all env vars updated. Chrome Web Store listing update pending (separate JP task).


---

### Phase F: Feature Foundation (Smaller Features)

#### F-1: Default Memo Auto-Fill (1-2 prompts)

**Outcome:** Completed. Cheque defaults section now includes configurable QB Memo and Private Note fields matching Bill and Vendor Credit patterns. JournalEntryPreview reads `defaults.privateNote` with proper `prev ||` priority chain — defaults → memoTemplate → scan header → fallback.

---

#### F-2: Row Selection in SyncView (W-fe-row-select)

**Outcome:** Completed. Users can select specific scan records via checkboxes, sync only selected scans, and delete selected scans with confirmation. Role/permission checks prevent unauthorized access.

---

### Phase E: Bulk Cheque Excel Scan

**What:** A new scan type for uploading Excel files containing cheque data. Each row = one cheque in QuickBooks (unless payee + check no. + payment date match, then merge into one cheque with multiple line items). Phase K supersedes cheque row merging — each Excel row will become one independent QuickBooks cheque.

#### E-1: Cheque Excel Scoping Audit

**Outcome:** Completed audit. The existing pipeline already supports CHEQUE transactionType, Excel parsing via `columnMappings`, payee+checkNo+date grouping in `ScanView`, multi-line cheque preview rendering, and backend QB cheque payload building. Phase K supersedes cheque row merging — each Excel row will become one independent QuickBooks cheque.

- **Remaining work:** None — E-3 complete.

**Why E-4 is removed:** Cheque preview is already implemented in the current code, so it is no longer a separate scope item.

---

#### E-3: Customer Mapping Refinement + Same-Category Merge Option (1 prompt)

**Outcome:** Completed. Customer values extracted from scan line items before numeric filtering, resolved against QBCustomer list, passed as CustomerRef on QB Cheque header payload through full stack.

---

**Outcome:** Completed. MappingView shows cheque-specific columns and hides Column Roles/Line Item Fields for CHEQUE templates. CheckPreviewForm extracts fixed columns directly (category, amount, description, tax, customer, memo, taxType) instead of requiring columnMappings. batch-payload-builder reads fixed columns without parseNumericValue destroying strings. L366 useEffect updated with E-2 key name fallbacks (paymentDate, checkNo, bankAccount).

---

**Outcome:** Already implemented via A-1 (scoping) and A-2 (implementation). Owner → Admin → Member distribution chain is complete: data model (poolScans/poolLocations/poolTemplates → allocatedScans/allocatedLocations/allocatedTemplates), API endpoints with pool validation, capacity middleware enforcement, and frontend UI (AdminsTab + MyTeamTab).

---

#### J: Tab UI Polish

**Outcome:** Completed. Each tab shows context-specific filters, summary cards, and action banners. Review: PENDING_APPROVAL/REJECTED filter, 2 cards. Approved: APPROVED/REJECTED filter, 1 card. Sync: PENDING/SYNCED/FAILED filter, 4 cards + sync button + attention banner. `4e09eed`

### Phase K: Cheque Value Mapping + Per-Row Preview

**Goal:** Enable value mapping for cheque Excel templates and show each Excel row as a separate cheque entry in the preview, allowing bulk sync of individual cheques to QuickBooks.

**Files:**
- `Backend/prisma/schema.prisma` — add `sourceField` column to ValueMapping model, update unique key
- `Backend/prisma/migrations/` — new migration for `sourceField` column
- `Backend/src/routes/value-mappings.ts` L43-56 — accept and persist `sourceField`, update queries/filters
- `Backend/src/lib/validators.ts` L100 — validate and preserve line-level `taxCodeRef` (currently stripped)
- `Frontend/src/types/index.ts` L180 — add `sourceField` to value mapping types
- `Frontend/src/types/index.ts` L210 — add optional `scanRecordId` to `ScanEntry` type
- `Frontend/src/popup/lib/resolve-value-mapping.ts` — match on both `fieldType` AND `sourceField` with null-safe backward compatibility
- `Frontend/src/popup/lib/api.ts` L676 — accept and send `customerRef` in `createCheque`
- `Frontend/src/popup/components/MappingView/index.tsx` — render cheque mapping section with vendor/bank filtering
- `Frontend/src/popup/components/MappingView/ValueMappingSection.tsx` — accept column-specific mapping config
- `Frontend/src/popup/components/CheckPreviewForm.tsx` — per-row autofill, customer state, multi-check preview
- `Frontend/src/popup/App.tsx` L586 — multi-entry preview with scan-record ID association
- `Frontend/src/popup/components/ScanView.tsx` L1119 — capture each returned `{ id }` from `api.saveScanEntry` and populate `ScanEntry.scanRecordId`
- `Frontend/src/popup/lib/batch-payload-builder.ts` L194 — per-row payee, memo, customer, tax type in payload

**Mapping Data Model:**
The current `ValueMapping` schema stores `templateId`, `fieldType` (account/name/class/taxCode), `scannedText`, and `entityId`. This works for journal entries because each `fieldType` maps to one entity type. But for cheques, the same `fieldType` (e.g., `account`) is used by multiple columns (category → account, bank account → account). Without a `sourceField` column, "BofA" in the bank account column and "BofA" in the category column would share the same mapping.

**Required schema change:** Add a `sourceField String?` to `ValueMapping` in `schema.prisma`. Update the unique key to `@@unique([templateId, fieldType, sourceField, scannedText])`. Update all API routes to accept, persist, and filter by `sourceField`. Existing mappings without `sourceField` (journal entries) continue to work — `sourceField` is nullable.

**Mapping contract per cheque column:**
- `payee` → `fieldType: 'name'` (targets a Vendor in QuickBooks)
- `bankAccount` → `fieldType: 'account'` (targets a Bank-type Account)
- `category` → `fieldType: 'account'` (targets an Account)
- `taxType` → `fieldType: 'taxCode'` (targets a Tax Code)

**Tax column note:** The Excel `tax` column (a dollar amount) has no independent QuickBooks target field — QuickBooks calculates tax from the `TaxCodeRef`. The `tax` value should be displayed in the preview form for user reference only (not sent to QuickBooks). Only `taxType` (mapped to `taxCodeRef`) is sent.

**Changes:**

**K-1: Schema + API for sourceField**
- Add `sourceField String?` to the `ValueMapping` model in `schema.prisma`. Create a Prisma migration.
- Update the unique constraint: `@@unique([templateId, fieldType, sourceField, scannedText])`.
- Update `value-mappings.ts` API routes to accept `sourceField` in request bodies, persist it, and filter by it when querying. Existing mappings without `sourceField` continue to work.
- Update frontend types in `types/index.ts` to include `sourceField` in the value mapping interface.
- Update `resolve-value-mapping.ts` to accept an optional `sourceField` and use null-safe matching: when `sourceField` is omitted (journal entries), match only mappings whose `sourceField` is `null`/unset; when supplied (cheques), match that exact `sourceField` value. This prevents a column-specific cheque mapping from accidentally applying to journal entries or to other cheque columns.

**K-2: Cheque Value Mapping Section**
- In MappingView, show a value mapping UI for CHEQUE templates (currently only shown for JOURNAL_ENTRY). Present columns: payee, bank account, category, tax type.
- Restrict the entity picker targets per column: for `payee`, show only active Vendors; for `bankAccount`, show only active QuickBooks accounts where `AccountType === 'Bank'`. The existing template defaults already filter by these types at MappingView L461 — apply the same filters in the mapping UI.
- Each column lets users map raw Excel values to QuickBooks values (e.g., "JP" → "JPEscuadra" for payee, "BofA" → "Bank of America Checking" for bank account).
- Store and load mappings per template with `sourceField` set to the cheque column name.

**K-3: Per-Row Autofill in Preview**
- In CheckPreviewForm, when source is 'excel', autofill all fields per row:
  - Cheque-level: payee, bank account, payment date, check no., customer, qb memo
  - Line-level: category (→ account), description, amount, tax type (→ taxCodeRef)
- Apply value mappings to payee, bank account, category, and tax type using `resolveValueMapping` with the appropriate `sourceField`.
- Display the raw `tax` amount in the preview for reference only (not sent to QuickBooks).
- Add customer state and UI to CheckPreviewForm. Pass `customerRef` during direct sync via `api.ts` L676.
- Each row's data populates its own cheque entry form independently.

**K-4: Multi-Check Preview with Scan-Record Association**
- The preview should show one cheque form per Excel row (e.g., 5 rows = 5 separate cheque forms).
- Currently `ScanView.tsx` L1119 creates per-row scan records by calling `api.saveScanEntry` in a loop but **discards the returned `{ id }` values**. Fix: add an optional `scanRecordId` field to the `ScanEntry` type (`types/index.ts` L210) and populate it from each save response so the preview knows which scan record belongs to which cheque.
- Currently `App.tsx` L586 passes only one `scanRecordId` for a single active entry. Change to support an array or map of scan record IDs, one per row.
- Each cheque form should be independently reviewable and editable before sync.

**K-5: Per-Row Batch Payload**
- In `batch-payload-builder.ts`, use per-row payee, qb memo, customer, and tax type values instead of defaults.
- Preserve each row's `scanRecordId` and pass it to its corresponding sync/approval action.
- Do not group rows by matching header fields; generate exactly one QuickBooks cheque payload per source row.
- Fix `Backend/src/lib/validators.ts` L100 to validate and preserve line-level `taxCodeRef` (currently stripped even though `qb.service.ts` L575 supports it).
- Bulk sync sends N separate cheques for N rows.

**Tests Required:**
- Backend: test value-mappings API accepts and persists `sourceField`, filters by it correctly
- Backend: test nullable `sourceField` backward compatibility (journal entry queries still work)
- Backend: test cheque validator preserves line-level `taxCodeRef`
- Frontend: test cheque value mapping UI renders for CHEQUE templates with vendor/bank filtering
- Frontend: test `resolveValueMapping` null-safe matching (omitted sourceField matches null, supplied matches exact)
- Frontend: test per-row autofill applies all fields with value mappings
- Frontend: test multi-check preview renders N forms for N rows
- Frontend: test `customerRef` is passed through to `api.createCheque`
- All existing tests (81 frontend, 53 backend) must continue to pass.

**Expected output:** Cheque Excel templates have a value mapping section with per-column mapping support via `sourceField`. Each Excel row auto-fills into its own cheque entry with all fields in correct QuickBooks locations. Customer and tax code data flow end-to-end (frontend → API → QuickBooks). Bulk sync creates one QuickBooks cheque per row, each linked to its correct scan record.

---

### Execution Order

| # | Phase | Description | Dependencies | Can Parallel With |
|---|---|---|---|---|
| 1 | K | Cheque Value Mapping + Per-Row Preview | None | — |
