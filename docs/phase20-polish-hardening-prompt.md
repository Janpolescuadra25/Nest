# Phase 20 — Polish & Hardening: Sync Pipeline, Status Badges, Manifest Update

**Context:** Phases 13–19 built a complete RBAC system and wired the frontend to it. The product now has end-to-end role enforcement, time bombs, invite links, and effective access. But the **core sync pipeline** — the reason users pay for this product — has accumulated rough edges from 20 phases of rapid development. Status badges are inconsistent, the SyncView is read-only with no retry capability, the manifest description is outdated, and several small UX issues need fixing. This phase is a **polish pass** that makes the product feel production-ready.

**Rules:**
1. Read ALL relevant files fully before making changes.
2. After ALL changes, run `cd Backend && npx tsc --noEmit` AND `cd Frontend && npx tsc --noEmit` to verify zero errors.
3. Do NOT use `as any` to bypass type errors.
4. Do NOT remove any existing functionality — only fix, improve, and extend.
5. Follow the existing UI patterns — dark theme, Tailwind, same component structure.
6. Commit message: `feat: polish sync pipeline, fix status badges, update manifest`

**Prerequisite reads — read ALL of these before writing any code:**
- `Frontend/src/popup/components/MyTeamTab.tsx` — status badge ternary (search for `member.status === 'ACTIVE' ? 'bg-green-900`) needs GRACE_PERIOD fix
- `Frontend/src/popup/components/SyncView.tsx` — read-only sync history, no retry, no pagination
- `Frontend/src/popup/components/JournalEntryPreview.tsx` — sync flow, error handling, result display
- `Frontend/src/popup/components/ScanView.tsx` — scan → save pipeline
- `Frontend/src/popup/components/DashboardView.tsx` — owner dashboard stats
- `Frontend/src/popup/components/AdminDashboard.tsx` — admin dashboard stats
- `Frontend/src/popup/App.tsx` — status banners (EXPIRED, GRACE_PERIOD, TIME_BOMBED)
- `Frontend/src/popup/lib/api.ts` — existing API methods
- `Frontend/manifest.json` — current description
- `Backend/src/routes/quickbooks.ts` — journal entry sync endpoint
- `Backend/src/routes/scans.ts` — scan record endpoints

---

## Key Repo Facts (verified against current codebase — READ THESE)

| Fact | Detail |
|------|--------|
| **Status badge ternary** | MyTeamTab member card: `member.status === 'ACTIVE' ? green : member.status === 'EXPIRED' ? yellow : red`. GRACE_PERIOD falls into the red fallback — should be yellow since user still has full access. |
| **SyncView is read-only** | Shows scan history in a table but has no "Retry" button for FAILED syncs. Users must go back to Preview tab and re-sync manually. |
| **No pagination in SyncView** | Loads ALL scans for a location at once via `api.getScans()`. No pagination support. |
| **JournalEntryPreview sync result** | After successful sync, shows a green result card with `journalEntryId` and `txnDate`. No link to the QB journal entry. No way to copy the JE ID. |
| **Manifest description** | Says "Bridge between Toast POS and QuickBooks" but the product now supports Toast, SALIDO, and Oracle POS. Also mentions "Scan sales reports, map fields to journal entries, and sync to QuickBooks seamlessly" — missing rules, RBAC, and multi-POS support. |
| **Version mismatch** | manifest.json says `0.1.0`, SettingsView says "Version 1.0.0". Inconsistent. |
| **Scan pipeline** | ScanView scans a POS page → saves to backend → user goes to Mappings → maps fields → goes to Rules → configures rules → goes to Preview → reviews journal entry → clicks Sync to QB. This is 5+ tabs. No indication of progress through the pipeline. |
| **Failed sync error display** | SyncView shows `FAILED` status badge but doesn't show the error message. The `SyncLog` type has `errorMessage` field but it's not displayed. |
| **Dashboard stats** | Owner dashboard shows `totalSynced` and `totalFailed` counts. Admin dashboard shows similar. Neither shows "pending" (MAPPED but not yet synced) count. |
| **QB JE link format** | QuickBooks Online journal entries can be linked via: `https://app.sandbox.qbo.intuit.com/app/journal?txnId={jeId}` (sandbox) or `https://app.qbo.intuit.com/app/journal?txnId={jeId}` (production). The backend has `QB_ENVIRONMENT` env var (see `render.yaml` and `README.md`). |

---

## The Changes

### 1. Fix Status Badge Colors — `Frontend/src/popup/components/MyTeamTab.tsx`

**Problem:** The status badge ternary in the member card renders GRACE_PERIOD as red. GRACE_PERIOD means the user still has full access — it should be yellow (warning), not red (error).

**Fix:** Update the ternary to handle GRACE_PERIOD explicitly:

```tsx
<span className={`text-xs px-1 py-0.5 rounded ${
  member.status === 'ACTIVE' ? 'bg-green-900 text-green-400' :
  member.status === 'EXPIRED' ? 'bg-yellow-900 text-yellow-400' :
  member.status === 'GRACE_PERIOD' ? 'bg-yellow-900 text-yellow-400' :
  member.status === 'PENDING_APPROVAL' ? 'bg-orange-900 text-orange-400' :
  'bg-red-900 text-red-400'
}`}>
  {member.status}
</span>
```

This makes the status badge consistent with the `effectiveBadge()` function which already uses the correct colors.

### 2. Add Retry Sync — `Frontend/src/popup/components/SyncView.tsx`

**Problem:** When a sync fails, the user sees `FAILED` in the table but has no way to retry. They must navigate to the Preview tab, find the right scan, regenerate the journal entry, and sync again. This is a poor UX for what should be a one-click operation.

**Fix:** Add a "Retry" button on each FAILED scan row. When clicked:
1. Navigate to the Preview tab (set `currentTab` to `'preview'`) — this requires adding an `onTabChange` prop
2. Pass the `scanRecordId` so the Preview tab can load the scan data

**Implementation:**
- Add `onTabChange: (tab: string) => void` and `onScanRecordId: (id: string) => void` props to SyncView
- Add a "↻ Retry" button on FAILED rows that calls both callbacks
- Show the error message for FAILED rows (from `scan.syncLogs?.[0]?.errorMessage`)

Also add these improvements:
- Show error messages for FAILED syncs in a collapsible row or tooltip
- Add a "View in QB" link for SYNCED rows (construct URL from `qbJournalEntryId`)
- Add empty state for when no location is selected vs when no scans exist (already done, but verify)

### 3. Add Copy JE ID + QB Link — `Frontend/src/popup/components/JournalEntryPreview.tsx`

**Problem:** After a successful sync, the result card shows `journalEntryId` and `txnDate` but:
- The JE ID is not copyable (it's a long Intuit UUID)
- There's no link to open the journal entry in QuickBooks

**Fix:**
- Add a "Copy ID" button next to the journalEntryId in the sync result
- Add a "View in QuickBooks" link that opens the QB journal entry in a new tab
- The QB URL format depends on the environment. Check if `QB_ENV` is accessible from the frontend. If not, add a backend endpoint or config value.

For the QB link, the simplest approach is to add a `qbEnv` field to the QB status response. Check `Backend/src/routes/quickbooks.ts` — the `GET /api/quickbooks/status` endpoint. Add the environment (sandbox vs production) to the response so the frontend can construct the correct URL.

**Backend change (small):** In `GET /api/quickbooks/status`, add `environment: process.env.QB_ENVIRONMENT ?? 'production'` to the response JSON.

**Frontend change:** In `QBStatus` type, add `environment?: string`. In the sync result card, construct the URL:
```tsx
const qbBaseUrl = status.environment === 'sandbox'
  ? 'https://app.sandbox.qbo.intuit.com'
  : 'https://app.qbo.intuit.com';
const jeUrl = `${qbBaseUrl}/app/journal?txnId=${syncResult.id}`;
```

### 4. Update Manifest — `Frontend/manifest.json`

**Problem:** The description says "Bridge between Toast POS and QuickBooks" but the product now supports multiple POS systems (Toast, SALIDO, Oracle) and has RBAC features.

**Fix:** Update the description:
```json
"description": "Nest — Bridge between POS systems (Toast, SALIDO, Oracle) and QuickBooks Online. Scan sales reports, map fields to journal entries, apply rules, and sync to QuickBooks. Supports team management with role-based access control."
```

Also fix the version to `1.0.0` to match SettingsView.

### 5. Fix Version in SettingsView — `Frontend/src/popup/components/SettingsView.tsx`

**Problem:** SettingsView hardcodes "Version 1.0.0" while manifest says `0.1.0`.

**Fix:** Read the version from `manifest.json` at build time, or just update both to `1.0.0`. The simplest approach: update manifest to `1.0.0` (done in Change 4), and SettingsView already says `1.0.0`. Verify they match.

### 6. Add Sync Pipeline Progress Indicator — `Frontend/src/popup/App.tsx`

**Problem:** The sync pipeline spans 5+ tabs (Scan → Mappings → Rules → Preview → Sync). Users have no visual indication of where they are in the pipeline or what steps remain.

**Fix:** When the user has scan data loaded (i.e., `scanData !== null`), show a small pipeline progress indicator in the header area or below the tab nav. This should be a horizontal stepper showing:

```
① Scan → ② Map → ③ Rules → ④ Preview → ⑤ Sync
```

With the current step highlighted in cyan and completed steps in green. This is purely visual — no navigation (the tab nav already handles that).

**Implementation notes:**
- Only show when `scanData !== null` (there's active scan data to process)
- Determine the current step based on `currentTab`
- Use the existing Tailwind color palette
- Keep it minimal — a single row of small text with colored dots, not a full wizard UI

---

## Implementation Notes

1. **Retry sync is navigation, not API call.** The "Retry" button on SyncView doesn't call a sync API directly — it navigates the user to the Preview tab with the scan record loaded. The Preview tab handles the actual re-sync. This keeps the sync logic in one place.

2. **QB environment detection.** The backend has `QB_ENVIRONMENT` env var (set to 'sandbox' or 'production' — see `render.yaml` and `README.md`). Adding it to the `/api/quickbooks/status` response is a one-line change. The frontend's `useQuickBooks` hook already fetches this endpoint — just add `environment` to the `QBStatus` type.

3. **Pipeline progress indicator.** This should be lightweight. Don't build a full stepper component — just a row of 5 small text items with colored dots. Show it conditionally when scan data exists. It can go right below the TabNav in App.tsx.

4. **Error message display in SyncView.** The `ScanRecord` type already has `syncLogs?: SyncLog[]` and `SyncLog` has `errorMessage?: string`. Just display it. Use a small collapsible section or a tooltip on the FAILED badge.

5. **Copy to clipboard.** Use `navigator.clipboard.writeText()` — same pattern as the invite link copy in MyTeamTab.

6. **The GRACE_PERIOD badge fix is the most important change.** Right now admins see GRACE_PERIOD members with a red status badge, which implies they're blocked. But GRACE_PERIOD users have full access — they're just on borrowed time. Yellow is the correct semantic.

7. **No new API endpoints needed** except the tiny `environment` field addition to the QB status response.

---

## VERIFY

1. `cd Backend && npx tsc --noEmit` — zero errors
2. `cd Frontend && npx tsc --noEmit` — zero errors
3. GRACE_PERIOD status badge is yellow (not red) in MyTeamTab
4. PENDING_APPROVAL status badge is orange in MyTeamTab
5. SyncView has "Retry" button on FAILED rows
6. SyncView shows error messages for FAILED syncs
7. SyncView has "View in QB" link for SYNCED rows
8. JournalEntryPreview sync result has "Copy ID" button
9. JournalEntryPreview sync result has "View in QuickBooks" link
10. `GET /api/quickbooks/status` response includes `environment` field
11. `QBStatus` type includes `environment` field
12. manifest.json description mentions multiple POS systems and RBAC
13. manifest.json version is `1.0.0`
14. SettingsView version matches manifest version
15. Pipeline progress indicator shows when scan data exists
16. Pipeline progress indicator highlights current step
17. Only `Backend/src/routes/quickbooks.ts` was modified in the backend (one-line addition)
18. Commit: `feat: polish sync pipeline, fix status badges, update manifest`

---

## File Change Summary

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `Frontend/src/popup/components/MyTeamTab.tsx` | **MODIFY** | Fix status badge colors (GRACE_PERIOD → yellow, PENDING_APPROVAL → orange) |
| 2 | `Frontend/src/popup/components/SyncView.tsx` | **MODIFY** | Add retry button, error messages, QB links for synced rows |
| 3 | `Frontend/src/popup/components/JournalEntryPreview.tsx` | **MODIFY** | Add Copy ID button, View in QB link for sync results |
| 4 | `Frontend/manifest.json` | **MODIFY** | Update description (multi-POS + RBAC), version to 1.0.0 |
| 5 | `Frontend/src/types/index.ts` | **MODIFY** | Add `environment` to QBStatus type |
| 6 | `Frontend/src/popup/components/SettingsView.tsx` | **VERIFY** | Confirm version matches manifest (already says 1.0.0 — may need no change) |
| 7 | `Frontend/src/popup/App.tsx` | **MODIFY** | Add pipeline progress indicator below TabNav |
| 8 | `Backend/src/routes/quickbooks.ts` | **MODIFY** | Add `environment` field to QB status response (1 line) |

**Deferred to future phases:** Dashboard "pending" count, SyncView pagination — identified in Key Repo Facts but not in scope for this polish pass.
