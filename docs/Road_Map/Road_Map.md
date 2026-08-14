## 🗺️ Qyra Roadmap — Cypra v5 (K-5 Complete)

### Repo State (`544b8c8`, pushed)

| Area | Status |
|---|---|
| Frontend tests | 108/108 ✅ |
| Backend tests | 96/96 ✅ |
| Invite system | ✅ Fully built (InviteLink model, 7 endpoints) |
| Resource allocation fields | ✅ `allocatedScans/Locations/Templates`, `poolScans/Locations/Templates`, `maxMembers`, `timeBombAt` on User model |
| Capacity/permissions | ✅ Feature-based (`scan:write`, `sync:execute`, etc.) |
| Subscription system | ✅ Stripe (`currentPlan`, `currentPeriodEnd`, free tier) |
| Bulk cheque multi-line sync | ✅ Implemented (backend) |
| Rebrand scope | ~42 source files + 8 domain files + Render env vars |

---

### Phase N: Sync Reliability & Activity Logging
**Goal**: Eliminate silent sync failures and add full audit logging for all system actions, making the financial data pipeline trustworthy and production-ready.

- N-1: Sync Error Recovery — Add retry logic with exponential backoff for failed QuickBooks API calls in the batch sync endpoints. Store the QuickBooks error response on each failed item. Add a `POST /api/quickbooks/retry/:scanRecordId` endpoint to replay a single failed sync. Update SyncView to show a "Retry" button on failed items. Users should never lose data from a transient API failure.

- N-2: Activity Log Model — Create a Prisma `ActivityLog` model with fields: `id`, `actorId` (who performed the action), `action` (string — e.g. `SYNC_ATTEMPT`, `SYNC_SUCCESS`, `SYNC_FAIL`, `USER_DELETED`, `LIMIT_CHANGED`), `targetUserId` (nullable, for owner actions on others), `metadata` (JSON — for error details, item counts, etc.), `createdAt`. Add a helper to insert activity logs. Seed logging calls at all key mutation points: sync endpoints, owner actions, auth events.

- N-3: Activity Log UI — Add an "Activity" tab to the popup. Owners see org-wide activity; admins see their team's; members see their own. Display a chronological feed with action type, actor name, timestamp, and expandable metadata (e.g. error details for failed syncs). Add filtering by action type and date range. Lazy-load with pagination.

- N-4: Sync Status Tracking — Add `syncStatus` enum field to the `ScanRecord` Prisma model: `PENDING`, `SYNCED`, `FAILED`. Add `lastSyncError` string field (nullable). Update sync endpoints to set these fields on success/failure. Show status badges in SyncView (green for SYNCED, red for FAILED, gray for PENDING). Allow filtering ScanRecords by sync status.

- N-5: Email Notifications — Create a `NotificationPreference` Prisma model: `userId`, `syncFailureAlerts` (boolean), `quotaWarningAlerts` (boolean), `teamChangeAlerts` (boolean). Add a "Notifications" section in user settings. Integrate with Resend (already in the stack) to send emails when: a sync fails after all retries, storage usage exceeds 80% of limit, a new member joins or is removed. Queue emails asynchronously to avoid blocking request handlers.

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