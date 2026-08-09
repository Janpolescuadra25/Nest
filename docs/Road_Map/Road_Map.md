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

---

## 🗺️ Qyra Roadmap — Cypra v5 (Complete)

### Repo State (`955af6d`, clean, pushed)

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

#### E-1: Cheque Excel Scoping Audit

**Outcome:** Completed audit. The existing pipeline already supports CHEQUE transactionType, Excel parsing via `columnMappings`, payee+checkNo+date grouping in `ScanView`, multi-line cheque preview rendering, and backend QB cheque payload building.

- **Remaining work:** None — E-3 complete.

**Why E-4 is removed:** Cheque preview is already implemented in the current code, so it is no longer a separate scope item.

---

#### E-3: Customer Mapping Refinement + Same-Category Merge Option (1 prompt)

**Outcome:** Completed. Customer values extracted from scan line items before numeric filtering, resolved against QBCustomer list, passed as CustomerRef on QB Cheque header payload through full stack.

---

### Execution Order

| # | Phase | Prompt | Depends On | Can Parallel With |
|---|---|---|---|---|
| 1 | R-4 | Domain Migration (partial — GitHub renamed, Render URL updated, DNS configured. Remaining: Resend verification, Intuit redirect URI, Vercel, Chrome Web Store) | R-1, R-2, R-3 (done) | — |
| 2 | F-1 | Default Memo Auto-Fill | — | F-2 |
| 3 | F-2 | Row Selection | — | F-1 |
