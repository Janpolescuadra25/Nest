## 🗺️ Qyra Roadmap — Cypra v5 (K-5 Complete)

### Repo State (`983848c`, pushed)

| Area | Status |
|---|---|
| Frontend tests | 108/108 ✅ |
| Backend tests | 69/69 ✅ |
| Invite system | ✅ Fully built (InviteLink model, 7 endpoints) |
| Resource allocation fields | ✅ `allocatedScans/Locations/Templates`, `poolScans/Locations/Templates`, `maxMembers`, `timeBombAt` on User model |
| Capacity/permissions | ✅ Feature-based (`scan:write`, `sync:execute`, etc.) |
| Subscription system | ✅ Stripe (`currentPlan`, `currentPeriodEnd`, free tier) |
| Bulk cheque multi-line sync | ✅ Implemented (backend) |
| Rebrand scope | ~42 source files + 8 domain files + Render env vars |

---

### Phase L: Bill Excel Sync (Phase L complete)
**Goal:** Enable users to import vendor bills from Excel into QuickBooks, mirroring the cheque flow with bill-specific fields (due dates, payment terms), value mapping, per-row preview, and batch sync.

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
| L-2 | 7bb9f25 | Bill value mapping for header fields, MappingView bill column configs, SyncView vendor/terms passthrough |
| L-4 | (pre-built) | Direct bill sync — BillPreviewForm handleSync calls api.createBill, backend POST /api/quickbooks/bill validates with billSchema |
| L-5 | 983848c | taxCodeRef resolution in bill batch payload line items, taxCodes passthrough in SyncView |
| R-4 | (no code commit) | qyra.space live, Render, Resend, Intuit URI |

---