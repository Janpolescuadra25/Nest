## 🗺️ Qyra Roadmap — Cypra v5 (K-5 Complete)

### Repo State (`1680c4b`, pushed)

| Area | Status |
|---|---|
| Frontend tests | 108/108 ✅ |
| Backend tests | 98/98 ✅ |
| Invite system | ✅ Fully built (InviteLink model, 7 endpoints) |
| Resource allocation fields | ✅ `allocatedScans/Locations/Templates`, `poolScans/Locations/Templates`, `maxMembers`, `timeBombAt` on User model |
| Capacity/permissions | ✅ Feature-based (`scan:write`, `sync:execute`, etc.) |
| Subscription system | ✅ Stripe (`currentPlan`, `currentPeriodEnd`, free tier) |
| Bulk cheque multi-line sync | ✅ Implemented (backend) |
| Rebrand scope | ~42 source files + 8 domain files + Render env vars |

---

### Phase N: Sync Reliability & Activity Logging
**Goal**: Eliminate silent sync failures and add full audit logging for all system actions, making the financial data pipeline trustworthy and production-ready.

- ~~N-1: Sync Error Recovery~~ ✅
- ~~N-2: Activity Log Model~~ ✅ (built as `AuditLog` model + `logAction()` helper in earlier work)
- ~~N-3: Activity Log UI~~ ✅ (built as `ActivityTab.tsx` in earlier work — filtering, pagination, role-based visibility)
- N-4: Sync Status UI — Show sync status badges in SyncView (green for SYNCED, red for FAILED, gray for PENDING). Add filtering ScanRecords by sync status. (Schema fields `syncStatus` and `lastSyncError` already added to ScanRecord in N-1; backend already sets them on success/failure. Only the frontend badges and filter dropdown remain.)
- N-5: Email Notification Preferences — Create `NotificationPreference` Prisma model (`userId`, `syncFailureAlerts`, `quotaWarningAlerts`, `teamChangeAlerts`). Add a "Notifications" section in user settings UI. Add email alerts for storage usage exceeding 80% of limit and team member join/remove. (Sync failure email alerts already exist via `sync-failure-alerts.ts` cron job + Resend integration — do NOT rebuild those. Only the preference model, settings UI, and quota/team alerts are missing.)

### Standalone UX Fixes

- **Approved/Review Tab Workflow Fix**: Remove the "Rejected" filter from the Approved tab — rejected entries don't belong there. When an approved entry is rejected, it should move back to the Review tab. Add a "Rejected" filter to the Review tab so users can see entries they've rejected. This ensures the tab workflow is logically consistent: Review (pending + rejected) → Approved (approved only) → Synced.

---

### Completed History

| Phase | Commits | Summary |
|-------|---------|---------|
| Rebrand | c392366 … 05f7a82 | Nest → Qyra across ~42 files |
| Workflow Restructure | b1a7170 6b490d9 | Role permissions, tab restructure, bulk endpoints |
| Phase M | 2cffaad | ~~Phase M: Owner Capacity Management & Account Deletion~~ ✅ — Completed M-1 through M-6, including admin invite links, capacity distribution, storage limits, and silent 50 GB abuse prevention. |
| Phase L | 9dc6412, 7bb9f25, 983848c | Bill Excel sync complete: bill import parsing, bill-specific value mapping, and taxCodeRef resolution for QuickBooks bill sync. |
| Backend Test Fixes | 3f44041 9f482fc a008cab 95e6cca | stripe-plans, webhooks, capacity, team-status |
| A-1/A-2 | 56b9a43 472bf7f | Admin resource scoping + distribution (owner → admin → member) |
| E-1/E-2/E-3 | bcbac30 b02a173 955af6d | Cheque Excel parsing, 11-col format, customer data flow |
| F-1/F-2 | e899e8c 80d96f3 | Default memo auto-fill, row selection in SyncView |
| H | 9cfca33 8b09240 | Fixed cheque Excel format in MappingView + CheckPreviewForm |
| J | 4e09eed | Tab-specific filters, cards, and banners |
| K | b83853a | Per-row cheque batch payload generation, line-level taxCodeRef validation, sourceField-based value mapping for all cheque columns, multi-check preview with independent scanRecordId, row-grouping removal |
| L-4 | (pre-built) | Direct bill sync — BillPreviewForm handleSync calls api.createBill, backend POST /api/quickbooks/bill validates with billSchema |
| L-5 | 983848c | taxCodeRef resolution in bill batch payload line items, taxCodes passthrough in SyncView |
| R-4 | (no code commit) | qyra.space live, Render, Resend, Intuit URI |

---