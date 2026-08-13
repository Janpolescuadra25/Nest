## 🗺️ Qyra Roadmap — Cypra v5 (K-5 Complete)

### Repo State (`9dc6412`, pushed)

| Area | Status |
|---|---|
| Frontend tests | 105/105 ✅ |
| Backend tests | 69/69 ✅ |
| Invite system | ✅ Fully built (InviteLink model, 7 endpoints) |
| Resource allocation fields | ✅ `allocatedScans/Locations/Templates`, `poolScans/Locations/Templates`, `maxMembers`, `timeBombAt` on User model |
| Capacity/permissions | ✅ Feature-based (`scan:write`, `sync:execute`, etc.) |
| Subscription system | ✅ Stripe (`currentPlan`, `currentPeriodEnd`, free tier) |
| Bulk cheque multi-line sync | ✅ Implemented (backend) |
| Rebrand scope | ~42 source files + 8 domain files + Render env vars |

---

### Phase L: Bill Excel Sync (L-2 pending)
**Goal:** Enable users to import vendor bills from Excel into QuickBooks, mirroring the cheque flow with bill-specific fields (due dates, payment terms), value mapping, per-row preview, and batch sync.

#### L-2: Bill Value Mapping
**Goal:** Extend MappingView and the value mapping system to support bill-specific fields so users can map Excel columns to QBO bill fields.
**Expected outcome:**
- MappingView supports a bill mapping mode with fields: vendor, account, taxType, dueDate, terms, poNumber, memo
- Value mapping table entries created for bill field types with sourceField disambiguation (matching K-3/K-5 pattern: `sourceField` parameter distinguishes same fieldType across columns)
- `resolveValueMapping` handles bill field types without conflicts
- `batch-payload-builder.ts` extended with `buildBillPayload` function (mirrors `buildChequePayload`)
- `buildBillPayload` resolves vendor via value mapping (not customer lookup — bills always reference vendors), resolves account and taxType via mapping, and includes dueDate/terms/poNumber when present
- Frontend tests added for bill value mapping and payload building

#### L-3: Bill Preview (Per-Row)
**Goal:** Show each parsed bill row as an independent, editable preview form with bill-specific fields, rendered as stacked instances for multi-bill Excel files.
**Expected outcome:**
- `BillPreviewForm` component created (or CheckPreviewForm extended with bill mode) with fields: vendor (SearchableSelect), billNo, date, dueDate (date picker), account, taxType, amount, memo, terms (SearchableSelect or dropdown), poNumber
- Vendor resolved by direct name match against QBVendors (no customer lookup — bills are always vendor-facing)
- Line-level taxCodeRef preserved in preview (matching K-5 pattern)
- App.tsx routes `BILL`-type scanEntries to render N BillPreviewForm instances stacked vertically with `Bill {index + 1} (Row {rowNumber})` headings
- Each form has independent scanRecordId tracking
- Editable fields with manual override capability
- Frontend tests added for BillPreviewForm rendering and data flow

#### L-4: Direct Bill Sync (Per-Row)
**Goal:** Enable per-row bill submission from the preview form directly to QuickBooks, with validation against billSchema.
**Expected outcome:**
- `api.createBill` (or equivalent) endpoint called from BillPreviewForm submit handler
- Payload includes: vendorRef, docNumber (billNo), txnDate, dueDate, line items (account, amount, taxCodeRef), memo, termsRef, poNumber
- Backend validates against `billSchema` in validators.ts (schema already exists)
- Per-row success/failure feedback displayed on the form
- Frontend tests added for direct bill sync

#### L-5: Batch Bill Sync
**Goal:** Enable bulk sync of all bill rows from SyncView using the batch payload builder, matching the per-row pattern established in K-5.
**Expected outcome:**
- SyncView bulk handler loops over `scan.scanEntries` for `BILL`-type entries
- Each entry passes through `buildBillPayload` with vendors, taxCodes, and accounts from `useQBContext()`
- `buildBillPayload` produces one payload per entry with all value mapping resolved and scanRecordId attached
- Batch sync API call submits all bill payloads
- Per-entry success/failure tracked and displayed in SyncView
- `taxCodeRef` included in line items when taxType is resolved
- Frontend tests added for batch bill payload building

**Mapping contract** (same as cheque — permanent reference):
- `resolveValueMapping(scannedText, fieldType, mappings, entityLookup, sourceField)` — sourceField disambiguates same fieldType across bill columns (e.g., vendor column vs account column)
- Customer lookup does NOT apply to bills — bills use vendor value mapping only

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
| K | b83853a | Per-row cheque batch payload generation, line-level taxCodeRef validation, sourceField-based value mapping for all cheque columns, multi-check preview with independent scanRecordId, row-grouping removal |
| L-1 | 9dc6412 | Bill Excel format definition and parsing, ScanEntry type tagging, backend bill column detection |
| R-4 | (no code commit) | qyra.space live, Render, Resend, Intuit URI |

---