## 🗺️ Qyra Roadmap — Cypra v5

### Repo State (`b76f62f`, pushed)

| Area | Status |
|---|---|
| Frontend tests | 108/108 ✅ |
| Backend tests | 103/103 ✅ |
| Invite system | ✅ Fully built (InviteLink model, 7 endpoints) |
| Resource allocation fields | ✅ `allocatedScans/Locations/Templates`, `poolScans/Locations/Templates`, `maxMembers`, `timeBombAt` on User model |
| Capacity/permissions | ✅ Feature-based (`scan:write`, `sync:execute`, etc.) |
| Subscription system | ✅ Stripe (`currentPlan`, `currentPeriodEnd`, free tier) |
| Bulk cheque multi-line sync | ✅ Implemented (backend) |
| Rebrand scope | ~42 source files + 8 domain files + Render env vars |

### Phase O: Observability, Export & Security Hardening
**Goal**: Give users full visibility into their account activity, enable data portability, and harden the API against abuse — making Qyra production-ready for real-world teams.

- ~~O-1: **Dashboard Analytics**~~ ✅ — Enhance `DashboardView.tsx` with: monthly scan volume bar chart, sync success/failure donut chart, top 5 mapped accounts table, and a storage usage gauge. New backend endpoint `GET /api/analytics/dashboard` returning aggregated stats from `ScanRecord`, `SyncLog`, and `AuditLog` models. No new Prisma models required — use existing `prisma.scanRecord.groupBy()` and count queries. Frontend charts rendered with a lightweight library (e.g., recharts or a simple CSS-based approach). Include a date range selector (last 7/30/90 days, this month, custom).

- ~~O-2: **Data Export (CSV)**~~ ✅ — Add CSV export for scan history and sync logs. Backend: new file `Backend/src/routes/exports.ts` with `GET /api/exports/scans?format=csv&dateFrom=&dateTo=&status=` and `GET /api/exports/sync-logs?format=csv&dateFrom=&dateTo=&syncType=`. Use existing Prisma queries with streaming CSV generation (no in-memory buffering for large datasets). Set `Content-Disposition: attachment` header. Frontend: add "Export CSV" button in `ScanHistory.tsx` and `ActivityTab.tsx` that triggers a file download via `window.open()` or a blob URL. No new Prisma models required.

- O-3: **Audit Log Enhancements** — Add date-range filtering and user filtering to the existing `ActivityTab.tsx`. Backend: first, locate the existing route that serves audit log data to the frontend (search `Backend/src/routes/` for any endpoint that queries the `AuditLog` model — likely in `admin.ts` or a similar file). If no dedicated endpoint exists, create `GET /api/activity-logs` in the appropriate route file. Then update that endpoint to accept optional query params: `dateFrom` (ISO string), `dateTo` (ISO string), and `userId` (string). Apply as `where` clause filters on the existing `AuditLog` query. Frontend: add a date range picker (reuse or extend `SmartDatePicker.tsx`) and a user dropdown (populated from team members list) above the existing activity log table in `ActivityTab.tsx`. Both filters should work together and update the URL query params for shareable filtered views.

- O-4: **API Rate Limiting** — Install `express-rate-limit` and add tiered rate limits to all `/api/` routes. New file `Backend/src/middleware/rate-limiter.ts` exporting three limiters: `authLimiter` (10 req/min for login/register/password-reset endpoints), `apiLimiter` (100 req/min for all other authenticated endpoints), and `webhookLimiter` (exempt/skip for Stripe/Intuit webhook endpoints). Apply in `Backend/src/index.ts` via `app.use()` ordering (webhook routes registered before limiters, or webhook limiter set to unlimited). Include `X-RateLimit-Remaining` and `Retry-After` headers in responses. Add a test in `Backend/tests/` verifying that rate-limited endpoints return 429 after exceeding the limit.

- O-5: **Input Sanitization Layer** — Audit all 20 route files under `Backend/src/routes/`. For any endpoint that reads `req.body`, `req.query`, or `req.params` and does NOT already use a Zod schema (or similar validation), add `z.object({ ... }).parse(req.body)` validation at the top of the handler. Use the existing pattern from `scans.ts` and `quickbooks.ts` as the template. Focus on: `admin.ts`, `adminRequests.ts`, `invite.ts`, `locations.ts`, `mappings.ts`, `notifications.ts`, `owner.ts`, `payee-mappings.ts`, `product-mappings.ts`, `products.ts`, `rules.ts`, `templates.ts`, `value-mappings.ts`. Endpoints that already have Zod schemas (auth, checkout, scans, quickbooks, webhooks) can be skipped. Add tests for at least 3 of the newly-validated endpoints confirming that invalid input returns 400.

---

### Completed History

| Phase | Commits | Summary |
|-------|---------|---------|
| O-1 | `df459bb` | Dashboard analytics: monthly scan volume bar chart, sync health pie chart, top 5 mapped accounts table, storage usage gauge, date range selector, GET /api/analytics/dashboard endpoint. |
| O-2 | `b76f62f` | CSV export: scans, sync logs, and audit logs export endpoints, downloadCSV helper, export buttons in ScanHistory and ActivityTab. |
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
