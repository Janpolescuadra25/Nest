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

---

## 🗺️ Qyra Roadmap — Cypra v5 (Complete)

### Repo State (`e9d9ce6`, clean, pushed)

| Area | Status |
|---|---|
| Frontend tests | 80/80 ✅ |
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

### Phase H: Fixed Cheque Excel Format

**What:** Cheques use a fixed 10-column Excel format, unlike Bills and Vendor Credits which use flexible user-configurable column mapping. When a CHEQUE template is selected, the MappingView must enforce this fixed format instead of showing the generic invoice-style column roles.

**Goal:** Users scanning cheque Excel files see a cheque-specific mapping experience — fixed column headers, cheque-specific preview showing individual cheque forms, and each row syncing as a separate cheque to QuickBooks.

**Scoping needed:**
- `MappingView/index.tsx` — conditionally hide "Column Roles" section and "Line Item Fields" section when `transactionType === 'CHEQUE'`
- `MappingView/index.tsx` — "Scanned Line Items" table must show cheque-specific columns instead of invoice columns (Description, Qty, Unit Price, Total)
- Cheque Excel parser — fixed 10-column format: Payee (col 1), Bank Account (col 2), Payment Date (col 3), Check No. (col 4), Category (col 5), Description (col 6), Amount (col 7), Tax (col 8), Customer (col 9), QB Memo (col 10)
- Row merging logic — if payee + check no. + payment date match across rows, merge into one cheque with multiple line items; otherwise each row = one separate cheque
- Mapping section still works for Payee → QB Vendor, Category → QB Account, Customer → QB Customer, Tax → tax code
- Description auto-fills from Excel description column
- Tax column maps to Exclusive/Inclusive/Out of scope tax treatment

**Expected behavior:**
1. User selects CHEQUE template in MappingView → "Column Roles" and "Line Item Fields" sections are hidden
2. "Scanned Line Items" table shows cheque columns: #, Payee, Bank Account, Date, Check No., Category, Description, Amount, Tax, Customer, Memo
3. Helper text says "cheque items" not "invoice items"
4. Mapping section allows mapping Payee, Category, Tax, Customer values to QB names
5. Preview section shows individual cheque forms (one per row, or merged if matching payee/check#/date)
6. Sync creates one QB Cheque per row (or one merged cheque with multiple line items)

**Expected output:** MappingView enforces fixed cheque format, preview shows correct cheque forms, sync creates correct QB Cheques.

---

### Phase I: Admin Resource Distribution

**What:** Admin users (registered via owner's invite link) can distribute their allocated scans, locations, and templates to their team members. The owner sets limits per admin; admins sub-distribute from their pool, reducing their own available count.

**Goal:** Owners can allocate capacity to admins, admins can manage their team's capacity through a distribution UI, and non-invited users use Stripe subscription plans.

**Scoping needed:**
- Current allocation model (`allocatedScans`, `allocatedLocations`, `allocatedTemplates` on User model)
- Current invite link system (`InviteLink` model with `roleHint`)
- Admin team management UI — list members, show current allocations, distribute form
- API endpoints for admin to distribute capacity to members
- Distribution reduces admin's available count
- Free tier and Stripe subscription plans for non-invited users

**Expected behavior:**
1. Owner creates invite link with role ADMIN, sets limits (scans, locations, templates, max members)
2. Admin registers via link, receives those limits
3. Admin can invite members under them (up to max members)
4. Admin distributes portions of their allocation to each member (scans, locations, templates)
5. Distributed amounts reduce admin's available count
6. Non-invited users register normally and use Stripe subscription plans with fixed capacities

**Expected output:** Full capacity distribution chain — Owner → Admin → Members, with Stripe plans for non-invited users.

---

### Execution Order

| # | Phase | Description | Dependencies | Can Parallel With |
|---|---|---|---|---|
| 1 | H | Fixed Cheque Excel Format | None | I |
| 2 | I | Admin Resource Distribution | None | H |
| — | R-4 | Domain Migration (manual — JP only) | None | — |
