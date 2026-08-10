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

---

## 🗺️ Qyra Roadmap — Cypra v5 (Complete)

### Repo State (`91b8d65`, clean, pushed)

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

**What:** A new scan type for uploading Excel files containing cheque data. Each row = one cheque in QuickBooks (unless payee + check no. + payment date match, then merge into one cheque with multiple line items).

#### E-1: Cheque Excel Scoping Audit

**Outcome:** Completed audit. The existing pipeline already supports CHEQUE transactionType, Excel parsing via `columnMappings`, payee+checkNo+date grouping in `ScanView`, multi-line cheque preview rendering, and backend QB cheque payload building.

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

### Execution Order

All phases complete. No pending work.
