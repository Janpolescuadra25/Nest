## 🗺️ Qyra Roadmap — Cypra v5 (K-4 Complete; K-5 Pending)

### Repo State (`b3132c7`, local only)

| Area | Status |
|---|---|
| Frontend tests | 102/102 ✅ |
| Backend tests | 67/67 ✅ |
| Invite system | ✅ Fully built (InviteLink model, 7 endpoints) |
| Resource allocation fields | ✅ `allocatedScans/Locations/Templates`, `poolScans/Locations/Templates`, `maxMembers`, `timeBombAt` on User model |
| Capacity/permissions | ✅ Feature-based (`scan:write`, `sync:execute`, etc.) |
| Subscription system | ✅ Stripe (`currentPlan`, `currentPeriodEnd`, free tier) |
| Bulk cheque multi-line sync | ✅ Implemented (backend) |
| Rebrand scope | ~42 source files + 8 domain files + Render env vars |

---

### Completed History

| Phase | Commits | Summary |
|-------|---------|---------|
| Rebrand | c392366 … 05f7a82 | Nest → Qyra across ~42 files |
| Workflow Restructure | b1a7170 6b490d9 | Role permissions, tab restructure, bulk endpoints |
| Backend Test Fixes | 3f44041 9f482fc a008cab 95e6cca | stripe-plans, webhooks, capacity, team-status |
| A-1/A-2 | 56b9a43 472bf7f | Admin resource scoping + distribution (owner → admin → member) |
| E-1/E-2/E-3 | bcbac30 b02a173 955af6d | Cheque Excel parsing, 11-col format, customer data flow |
| F-1/F-2 | e899e8c 80d96f3 | Default memo auto-fill, row selection in SyncView |
| H | 9cfca33 8b09240 | Fixed cheque Excel format in MappingView + CheckPreviewForm |
| J | 4e09eed | Tab-specific filters, cards, and banners |
| R-4 | (no code commit) | qyra.space live, Render, Resend, Intuit URI |

---

### Phase K: Cheque Value Mapping + Per-Row Preview

**Goal:** Enable value mapping for cheque Excel templates and show each Excel row as a separate cheque entry in the preview, allowing bulk sync of individual cheques to QuickBooks.

**Mapping contract per cheque column:**
- `payee` → `fieldType: 'name'` (targets a Vendor in QuickBooks)
- `bankAccount` → `fieldType: 'account'` (targets a Bank-type Account)
- `category` → `fieldType: 'account'` (targets an Account)
- `taxType` → `fieldType: 'taxCode'` (targets a Tax Code)

**Tax column note:** The Excel `tax` column (a dollar amount) has no independent QuickBooks target field — QuickBooks calculates tax from the `TaxCodeRef`. The `tax` value should be displayed in the preview form for user reference only (not sent to QuickBooks). Only `taxType` (mapped to `taxCodeRef`) is sent.

#### K-1: Schema + API for sourceField
**Outcome:** Completed. `49af089` — Added `sourceField String?` to ValueMapping in `schema.prisma`, migration, API routes accept/persist/filter by sourceField, resolver null-safe matching (omitted matches null/undefined, supplied matches exact), frontend types updated.

#### K-2: Cheque Value Mapping Section
**Outcome:** Completed. `002608c` — Per-column mapping UI (payee/bankAccount/category/taxType) in MappingView for CHEQUE templates, per-column target filtering (vendors for payee, Bank-type accounts for bankAccount), tested helper utilities in `value-mapping-column-utils.ts`.

#### K-3: Per-Row Autofill in Preview
**Outcome:** Completed. `7a8a211` — sourceField value mapping for all 4 cheque columns (payee, bankAccount, category, taxType), customer state/SearchableSelect in CheckPreviewForm, customerRef added to `api.createCheque`, raw tax amount displayed as read-only. 102/102 frontend, 67/67 backend tests pass.

#### K-4: Multi-Check Preview with Scan-Record Association
**Outcome:** Completed. `COMMIT_HASH` — Multi-check preview renders N independent CheckPreviewForm instances for N Excel rows, scanRecordId captured from api.saveScanEntry and passed per-entry, each form independently editable. 102/102 frontend, 67/67 backend tests pass.

#### K-5: Per-Row Batch Payload
- In `batch-payload-builder.ts`, use per-row payee, qb memo, customer, and tax type values instead of defaults.
- Preserve each row's `scanRecordId` and pass it to its corresponding sync/approval action.
- Do not group rows by matching header fields; generate exactly one QuickBooks cheque payload per source row.
- Fix `Backend/src/lib/validators.ts` L100 to validate and preserve line-level `taxCodeRef` (currently stripped even though `qb.service.ts` L575 supports it).
- Bulk sync sends N separate cheques for N rows.
