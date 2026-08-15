## 🗺️ Qyra Roadmap — Cypra v5

### Repo State (`87c55d4`, pushed)

| Area | Status |
|---|---|
| Frontend tests | 108/108 ✅ |
| Backend tests | 108/110 ✅ (1 pre-existing suite failure: owner.test.ts RESEND_API_KEY) |
| Invite system | ✅ Fully built (InviteLink model, 7 endpoints) |
| Resource allocation fields | ✅ `allocatedScans/Locations/Templates`, `poolScans/Locations/Templates`, `maxMembers`, `timeBombAt` on User model |
| Capacity/permissions | ✅ Feature-based (`scan:write`, `sync:execute`, etc.) |
| Subscription system | ✅ Stripe (`currentPlan`, `currentPeriodEnd`, free tier) |
| Bulk cheque multi-line sync | ✅ Implemented (backend) |
| Rebrand scope | ~42 source files + 8 domain files + Render env vars |

### Completed History

| Phase | Commits | Summary |
|-------|---------|---------|
| O-1 | `df459bb` | Dashboard analytics: monthly scan volume bar chart, sync health pie chart, top 5 mapped accounts table, storage usage gauge, date range selector, GET /api/analytics/dashboard endpoint. |
| O-2 | `b76f62f` | CSV export: scans, sync logs, and audit logs export endpoints, downloadCSV helper, export buttons in ScanHistory and ActivityTab. |
| O-3 | `9526c27` | Audit log enhancements: actor/user dropdown filter populated from team members, URL query param sync (dateFrom, dateTo, action, actorId) for shareable filtered views in ActivityTab. No backend changes. |
| O-4 | `711ca8e` | API rate limiting: added 100 req/min apiLimiter with tiered stacking (globalLimiter 200/15min + apiLimiter 100/min), Retry-After headers on all rate limiters, rate limit test file with 2 tests. |
| O-5 | `5fa3e26` | Input sanitization: added Zod validation to 6 route files (notifications, payee-mappings, product-mappings, products, rules, value-mappings) with 13 new schemas, 3 validation tests. |
| O-5 Hotfix | `87c55d4` | Fixed TypeScript compilation errors from O-5: removed duplicate imports in notifications.ts, added missing validate/schema imports in value-mappings.ts, fixed named→default export mismatches (analytics, exports, notifications), added adminId to admin.ts select, corrected valueMapping schemas to match route fields. |
| Phase N | (feature: `42f1d09`, docs: `010e9ca`) | Sync reliability & activity logging: retry with exponential backoff (N-1), AuditLog model + logAction helper (N-2, pre-built), ActivityTab UI (N-3, pre-built), sync status badges + filtering (N-4), NotificationPreference model + email alerts + settings toggles (N-5). |
| N-5 | `01cf0fa` | Email notification preferences: NotificationPreference model, GET/PUT /api/notifications/preferences, quota warning cron, team change alerts in invite/admin/admin owner routes, SettingsView toggles, ToggleRow component. |
| UX Fix | (feature: `42f1d09`, docs: `010e9ca`) | Approved/Review tab workflow fix — REJECTED scans hidden from Approved tab, filter counts include syncStatus. |
| Rebrand | c392366 … 05f7a82 | Nest → Qyra across ~42 files |
| Workflow Restructure | b1a7170 6b490d9 | Role permissions, tab restructure, bulk endpoints |
| Phase M | 2cffaad | Owner Capacity Management & Account Deletion — M-1 through M-6, including admin invite links, capacity distribution, storage limits, and silent 50 GB abuse prevention. |
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
