## 🗺️ Qyra Roadmap — Cypra v5 (K-5 Complete)

### Repo State (`1f3f065`, pushed)

| Area | Status |
|---|---|
| Frontend tests | 108/108 ✅ |
| Backend tests | 93/93 ✅ |
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

### Phase M: Owner Capacity Management & Account Deletion (M-6 pending)
**Goal:** Enable owners to manage client account lifecycles (permanent deletion with full data cascade), monitor and limit per-user data usage (DB records + attachment storage), and implement a capacity distribution system where owners set resource limits on invite links, admins distribute from their allocated pool to team members, and subscription plans enforce fixed capacities.

**Mapping contract** (permanent reference):
- Owner invite links create ADMIN accounts only — role is fixed, not selectable
- Admin invite links can assign STAFF, VIEWER, ACCOUNTANT, or MANAGER roles
- Capacity fields: maxScans, maxTemplates, maxLocations, maxMembers, maxStorageBytes
- When an admin distributes capacity to a member, the admin's available capacity decreases by the distributed amount
- Members (non-admin roles) cannot invite or distribute capacity further
- Subscription plans define fixed capacities — owner cannot modify plan-based limits
- When a subscription expires, the admin account drops to free tier with default free limits
- All file attachments have `fileSize` stored in DB — storage usage is the sum of all attachment fileSizes for a user's organization
- Prisma schema already has `onDelete: Cascade` on all user-related models — DB cleanup is automatic
- Deletion permission hierarchy: only owners can delete admin accounts, only admins can delete their own team members

#### ~~M-1: Permanent Account Deletion~~ ✅
**Goal:** Owner can permanently delete an admin account; all related data (locations, scans, templates, attachments, invite links, audit logs) is cascade-deleted from the database, and all attachment files are deleted from cloud storage. Permission hierarchy: owners delete admins, admins delete their own team members (STAFF, VIEWER, ACCOUNTANT, MANAGER).
**Expected outcome:**
- Backend endpoint `DELETE /api/owner/users/:id` that deletes the user record (Prisma cascade handles DB cleanup)
- Before deletion: query all `Attachment` and `LocationAttachment` records for the user's locations/scans, collect all `storageKey` values, call `storage.deleteFile()` for each
- Frontend: "Delete Account" button in `Clients` tab (or `UsersTab`) with confirmation dialog showing the user's email and a warning that all data will be permanently deleted
- Owner cannot delete their own account
- Only owners can delete admin accounts; admins can delete their own team members (STAFF, VIEWER, ACCOUNTANT, MANAGER)
- Backend tests for the deletion endpoint

#### ~~M-2: Data Usage Calculation & Owner Monitoring~~ ✅
**Goal:** Backend calculates per-organization storage usage (sum of all attachment fileSizes), and the owner can view each client's usage in the Clients tab.
**Expected outcome:**
- Backend endpoint `GET /api/owner/users/:id/usage` that returns:
  - `totalStorageBytes`: sum of `fileSize` from `Attachment` + `LocationAttachment` for all scans/locations belonging to the user's organization
  - `scanCount`: total number of ScanRecords
  - `templateCount`: total number of Templates
  - `locationCount`: total number of Locations
  - `memberCount`: total number of Users in the organization
- Frontend: Usage column/section in the Clients tab showing storage (formatted as MB/GB), scan count, member count for each client
- Backend tests for the usage calculation

#### ~~M-3: Storage Limits & User-Visible Quota~~ ✅
**Goal:** Owner can set a storage limit per client (maxStorageBytes), and users can see their own usage and limit in their dashboard.
**Expected outcome:**
- Add `maxStorageBytes` field to User model (nullable — null means unlimited)
- Owner can set this field when creating invite links or editing a client in the Clients tab
- Backend enforces the limit on file upload: check current usage + new file size against `maxStorageBytes`, reject with 413 if exceeded
- Frontend: User dashboard shows storage usage bar (e.g., "350 MB / 1 GB") with visual indicator when approaching limit
- Error message on upload when limit is exceeded: "Storage limit reached. Contact your administrator."
- Backend tests for limit enforcement

#### ~~M-4: Owner Invite Link Capacity Customization~~ ✅
**Goal:** Owner invite links have customizable capacity fields (maxScans, maxTemplates, maxLocations, maxMembers, maxStorageBytes) instead of just expiry and max uses. Role selection is removed — owner invite links always create ADMIN accounts.
**Expected outcome:**
- Extend InviteLink model or create a new model for capacity fields on invite links
- Frontend: Owner invite link form in Clients tab adds fields: Max Scans, Max Templates, Max Locations, Max Members, Max Storage (MB/GB)
- Remove role selection buttons (STAFF, VIEWER, ACCOUNTANT, MANAGER) from owner invite links — role is fixed to ADMIN
- When a user registers via the invite link, their User record is created with the specified capacity limits
- Backend validates that capacities are non-negative integers
- Backend tests for capacity enforcement on registration

#### M-5: Admin Invite Links & Capacity Distribution
**Goal:** Admin accounts can create invite links for their team members (STAFF, VIEWER, ACCOUNTANT, MANAGER roles), distributing capacity from their own allocated pool. Members cannot further invite or distribute.
**Expected outcome:**
- Admin invite link form has role selection (STAFF, VIEWER, ACCOUNTANT, MANAGER) and capacity fields (scans, templates, locations, storage)
- When admin creates an invite link, the specified capacities are subtracted from the admin's available capacity
- Admin's remaining capacity = owner-assigned capacity minus sum of all distributed capacities to team members
- Backend validates: admin cannot distribute more than their available capacity (return 400 if exceeded)
- Members (non-admin roles) do not see invite link creation UI
- Admin dashboard shows: Total Capacity | Distributed | Remaining for each resource type
- Backend tests for distribution math and overflow prevention

#### M-6: Storage Abuse Prevention
**Goal:** Subscription plans define fixed capacities. When an admin subscribes to a plan, their capacities are set to the plan's limits (owner cannot modify). When the plan expires, the admin drops to free tier.
**Expected outcome:**
- M-6: Storage Abuse Prevention — Add a silent 50 GB safety net to all subscription plans via Stripe webhooks. Invisible to users (not displayed in pricing). Owners can override per-admin via the existing panel.

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