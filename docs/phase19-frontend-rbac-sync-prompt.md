# Phase 19 — Frontend Sync: Wire Chrome Extension UI to RBAC Backend

**Context:** Phases 13–18 built a complete RBAC backend — owner account management, admin invite links, time bomb enforcement, role changes, and effective access. The Chrome extension frontend is **blind** to most of it. An admin using the extension today cannot set/clear time bombs, create shareable invite links, change user roles, or see that a team member is time-bombed. They get a mysterious 403 with no explanation. This phase closes that gap.

**Rules:**
1. Read ALL relevant files fully before making changes.
2. After ALL changes, run `cd Backend && npx tsc --noEmit` AND `cd Frontend && npx tsc --noEmit` to verify zero errors.
3. Do NOT use `as any` to bypass type errors.
4. This phase is primarily frontend, with ONE small backend change: adding `timeBombAt` and `gracePeriodHours` to the `GET /admin/team` Prisma select (see Change 0 below).
5. Do NOT remove any existing functionality — only add new features and extend existing types.
6. Follow the existing UI patterns — dark theme, Tailwind classes, same component structure as `MyTeamTab.tsx`.
7. Commit message: `feat: wire frontend to RBAC backend (time bombs, invite links, role changes, 403 surfacing)`

**Prerequisite reads — read ALL of these before writing any code:**
- `Frontend/src/types/index.ts` — current `TeamMember` type (missing `effectiveAccess`, `timeBombAt`, `gracePeriodHours`)
- `Frontend/src/popup/lib/api.ts` — current API calls (missing invite link + time bomb + role change endpoints)
- `Frontend/src/popup/components/MyTeamTab.tsx` — current team management UI (missing time bomb + invite link + role change UI)
- `Frontend/src/popup/components/AdminDashboard.tsx` — admin dashboard (may need effective access indicators)
- `Frontend/src/popup/App.tsx` — tab routing, role-based visibility, status banners
- `Frontend/src/popup/hooks/useAuth.ts` — auth state, session data shape
- `Backend/src/routes/admin.ts` — source of truth for all admin API endpoints and response shapes
- `Backend/src/middleware/effective-role.ts` — `EffectiveAccess` interface and `getEffectiveAccess` logic

---

## Key Repo Facts (verified against current codebase — READ THESE)

| Fact | Detail |
|------|--------|
| **Existing team invite** | `api.inviteTeamMember()` — direct email + temp password invite. Already wired in MyTeamTab. NOT being replaced. |
| **Missing: invite links** | Backend has `POST /api/admin/invite`, `GET /api/admin/invites`, `DELETE /api/admin/invites/:id`. Frontend has zero awareness. |
| **Missing: time bombs** | Backend has `PATCH /api/admin/users/:id/timebomb`, `PATCH /api/admin/users/:id/timebomb/clear`. Frontend has zero awareness. |
| **Missing: role change** | Backend has `PATCH /api/admin/users/:id/role` (STAFF/ACCOUNTANT/VIEWER only for admin). Frontend has zero awareness. |
| **`EffectiveAccess` shape** | `{ role: UserRole; status: UserStatus; isBlocked: boolean; isInGracePeriod: boolean; gracePeriodEndsAt: Date | null }` |
| **Time bomb set response** | `{ user: { ...userFields, effectiveAccess: EffectiveAccess } }` |
| **Time bomb clear response** | Same shape as set |
| **Role change response** | Same shape — `{ user: { ...userFields, effectiveAccess: EffectiveAccess } }` |
| **Invite link create response** | `{ invite: { id, token, roleHint, expiresAt, maxUses, createdAt } }` |
| **Invite link list response** | `{ invites: [{ id, roleHint, expiresAt, usedAt, maxUses, useCount, createdAt, isActive }], pagination }` |
| **Invite link delete response** | `{ message: 'Invite revoked' }` |
| **GET /admin/team response** | Returns `id`, `email`, `name`, `role`, `status`, `canScan`, `canMap`, `canSync`, `canManageLocs`, `trialExpiresAt`, `customExpiryMessage`, `mustChangePassword`, `createdAt`. Does NOT return `timeBombAt`, `gracePeriodHours`, or `effectiveAccess` — **Change 0 adds `timeBombAt` and `gracePeriodHours` to this response.** |
| **Session endpoint** | `GET /api/auth/session` returns `status` field (confirmed). Frontend can use `user.status === 'GRACE_PERIOD'` and `user.status === 'TIME_BOMBED'` for banners without any backend changes. |
| **Owner invite endpoints** | `GET /api/owner/invites`, `DELETE /api/owner/invites/:id` — Owner sees all invites with creator info. |
| **Admin can only set bombs on** | STAFF, ACCOUNTANT, VIEWER (not OWNER, not ADMIN, not self) |
| **Admin can only assign roles** | STAFF, ACCOUNTANT, VIEWER |
| **Grace period** | After time bomb fires, user gets `gracePeriodHours` of full access, then downgraded to VIEWER |
| **TIME_BOMBED status** | User is NOT blocked — just downgraded to VIEWER. Still has read access. |
| **Existing UI patterns** | Dark theme, Tailwind, slate/gray/cyan palette, `useToast()` for notifications, `actionLoading` pattern for async buttons |

---

## The Changes

### 0. Backend Fix — Add `timeBombAt` and `gracePeriodHours` to `GET /admin/team` response

**Problem:** The `GET /api/admin/team` endpoint (in `Backend/src/routes/admin.ts`, L54-68) does NOT return `timeBombAt` or `gracePeriodHours` in its Prisma select. This means time bomb data vanishes on page refresh — the admin sets a bomb, comes back tomorrow, and sees nothing. This is a UX bug.

**Fix:** Add `timeBombAt: true` and `gracePeriodHours: true` to the Prisma select on L54-68 of `admin.ts`. This is a two-line addition — no logic change, no migration, no new route.

```typescript
// In GET /api/admin/team, add to the existing select object:
          timeBombAt: true,
          gracePeriodHours: true,
```

After this change, the team list response will include `timeBombAt` and `gracePeriodHours` for each member, so the frontend can display time bomb status persistently (not just after mutations).

### 1. Update Types — `Frontend/src/types/index.ts`

Add the `EffectiveAccess` interface and extend `TeamMember`:

```typescript
export interface EffectiveAccess {
  role: string;
  status: string;
  isBlocked: boolean;
  isInGracePeriod: boolean;
  gracePeriodEndsAt: string | null;
}

export interface InviteLink {
  id: string;
  token?: string;           // only present on create response
  roleHint: string;
  expiresAt: string;
  usedAt?: string | null;
  maxUses: number;
  useCount: number;
  createdAt: string;
  isActive: boolean;
  creatorName?: string | null;
  creatorEmail?: string;
}
```

Extend `TeamMember` with these new optional fields:

```typescript
export interface TeamMember {
  // ... existing fields stay exactly as-is ...
  timeBombAt?: string | null;        // NEW
  gracePeriodHours?: number;         // NEW
  effectiveAccess?: EffectiveAccess;  // NEW
}
```

### 2. Add API Calls — `Frontend/src/popup/lib/api.ts`

Add these new methods to the `api` object:

```typescript
// ── Invite Links ──────────────────────────────────────────────────────────
createInviteLink: (jwt: string, data: { roleHint?: string; expiresInHours?: number; maxUses?: number }) =>
  post<{ invite: InviteLink }>('/api/admin/invite', data, jwt),

listInviteLinks: (jwt: string, page = 1) =>
  get<{ invites: InviteLink[]; pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean } }>(`/api/admin/invites?page=${page}`, jwt),

revokeInviteLink: (jwt: string, id: string) =>
  del(`/api/admin/invites/${id}`, jwt),

// ── Time Bombs ────────────────────────────────────────────────────────────
setTimeBomb: (jwt: string, userId: string, timeBombAt: string, gracePeriodHours?: number) =>
  patch<{ user: TeamMember }>(`/api/admin/users/${userId}/timebomb`, { timeBombAt, gracePeriodHours }, jwt),

clearTimeBomb: (jwt: string, userId: string) =>
  patch<{ user: TeamMember }>(`/api/admin/users/${userId}/timebomb/clear`, {}, jwt),

// ── Role Change ───────────────────────────────────────────────────────────
changeUserRole: (jwt: string, userId: string, role: string) =>
  patch<{ user: TeamMember }>(`/api/admin/users/${userId}/role`, { role }, jwt),
```

Import `InviteLink` from `../../types` alongside the existing imports.

### 3. Extend MyTeamTab — `Frontend/src/popup/components/MyTeamTab.tsx`

This is the biggest change. Add these UI features to the existing team management view:

#### 3a. Time Bomb UI
- In the expanded member detail area, show time bomb status:
  - If `member.timeBombAt` is set: show "💣 Time bomb: {date}" with a countdown
  - If `member.effectiveAccess?.isInGracePeriod`: show "⏳ Grace period — ends {gracePeriodEndsAt}" in yellow
  - If `member.effectiveAccess?.status === 'TIME_BOMBED'`: show "🚫 Access restricted (downgraded to VIEWER)" in red
- Add a "Set Time Bomb" button that shows a date input + optional grace period hours input
- Add a "Clear Time Bomb" button (only shown when `member.timeBombAt` is set)
- Use the existing `actionLoading` pattern for async operations
- Call `api.setTimeBomb()` and `api.clearTimeBomb()`, then `fetchTeam()` to refresh

#### 3b. Role Change UI
- In the expanded member detail area, add a role dropdown (STAFF, ACCOUNTANT, VIEWER)
- Only show for members whose role is not OWNER or ADMIN
- On change, call `api.changeUserRole()`, then `fetchTeam()` to refresh
- Show a confirmation toast on success

#### 3c. Invite Links UI
- Add a new section below the invite form: "Invite Links"
- Add a "Create Link" button that shows a form with:
  - Role hint dropdown (VIEWER, STAFF, ACCOUNTANT)
  - Expires in hours input (default 72, max 720)
  - Max uses input (default 1, max 100)
- On create, show the invite URL: `${BACKEND_URL}/api/invite/${token}` — with a copy button
- List existing invite links with: role hint, expiry, uses (useCount/maxUses), active status
- Each link has a "Revoke" button that calls `api.revokeInviteLink()`
- Fetch invite links on mount and after create/revoke using `api.listInviteLinks()`

#### 3d. Effective Access Display
- In the member card, show effective access indicators:
  - `GRACE_PERIOD` → yellow "⏳ Grace" badge
  - `TIME_BOMBED` → red "🚫 Restricted" badge
  - `PENDING_APPROVAL` → orange "⏳ Pending" badge
  - Normal `ACTIVE` → existing green badge (already shown)

### 4. Surface 403 Errors Meaningfully — `Frontend/src/popup/App.tsx` + `Frontend/src/popup/hooks/useAuth.ts`

When the backend returns a 403 from `enforceEffectiveRole`, the frontend currently shows a generic error. Add detection:

- In `api.ts`, the `get`/`post`/`put`/`patch`/`del` functions already throw `Error` with the backend error message. The backend returns specific messages like `"Your write access has been restricted"`. These are already surfaced via `err.message` in the catch blocks.
- In `App.tsx`, add a banner for `GRACE_PERIOD` status (similar to the existing `EXPIRED` banner):
  ```
  ⚠ Your write access expires soon. Contact your administrator.
  ```
- In `App.tsx`, add a banner for `TIME_BOMBED` status:
  ```
  🚫 Your write access has been restricted. You have view-only access. Contact your administrator.
  ```

To detect these states, the `/api/auth/session` response needs to include `effectiveAccess`. Check if the backend already returns it — if not, the frontend can infer the state from `user.status` (GRACE_PERIOD, TIME_BOMBED) which IS returned by the session endpoint.

**Check the session endpoint response** in `Backend/src/routes/auth.ts` to see what fields are returned. If `status` is already returned (it should be — `UserInfo` has `status`), then the frontend can use `user.status === 'GRACE_PERIOD'` and `user.status === 'TIME_BOMBED'` for the banners without any backend changes.

---

## Implementation Notes

1. **After Change 0, `GET /admin/team` WILL return `timeBombAt` and `gracePeriodHours`.** This means time bomb status persists across page refreshes. The `effectiveAccess` object is still NOT in the team list response — it's only in the mutation responses (setTimeBomb, clearTimeBomb, changeUserRole). For effective access badges, use `member.status` (which IS returned) to detect GRACE_PERIOD and TIME_BOMBED states, and `member.timeBombAt` to show the bomb date/countdown. After a mutation, you can also use the `effectiveAccess` from the response to update local state for immediate feedback.

2. **Invite link URL construction.** Use `BACKEND_URL` from `Frontend/src/lib/config.ts` (currently `https://nest-backend-mddn.onrender.com`). The invite URL format is: `${BACKEND_URL}/api/invite/${token}` — note the `/api/` prefix (the invite router is mounted at `/api/invite`). The `token` is only returned on CREATE — the list endpoint strips it for security. Import `BACKEND_URL` from `../../lib/config` in MyTeamTab to construct the URL.

3. **Copy to clipboard.** Use `navigator.clipboard.writeText()` for the copy button on invite links. Add a toast "Link copied!" on success.

4. **Date inputs.** Use `<input type="datetime-local">` for the time bomb date picker. Convert to ISO string before sending to backend.

5. **Grace period hours.** Default to 24 if not specified. Show as a number input with min=1.

6. **Role change restrictions.** The dropdown should only show STAFF, ACCOUNTANT, VIEWER. The backend enforces this — the frontend just needs to not show OWNER/ADMIN as options.

7. **Time bomb restrictions.** Don't show the "Set Time Bomb" button for OWNER or ADMIN members. Don't show it for the user's own entry. The backend enforces this, but the UI should hide it too.

8. **Existing `patchTeamMember` still works.** The existing `api.patchTeamMember()` calls `PATCH /api/admin/team/:id` which handles permissions and trial resets. This is NOT being replaced — it's for permission toggles and trial management. The new `api.changeUserRole()` calls a different endpoint (`PATCH /api/admin/users/:id/role`) which is specifically for role changes with auto-approval of PENDING_APPROVAL users.

9. **Status banners in App.tsx.** The existing `EXPIRED` banner pattern (lines 134-138) should be followed for `GRACE_PERIOD` and `TIME_BOMBED` banners. Check `UserInfo` type — it has a `status` field. The session endpoint returns `status`.

10. **Import `InviteLink` in api.ts.** Add it to the existing import from `../../types`.

---

## VERIFY

1. `cd Backend && npx tsc --noEmit` — zero errors
2. `cd Frontend && npx tsc --noEmit` — zero errors
3. Verify `GET /admin/team` response now includes `timeBombAt` and `gracePeriodHours` (check the Prisma select in `admin.ts`)
4. `TeamMember` type has `timeBombAt`, `gracePeriodHours`, `effectiveAccess` fields
5. `EffectiveAccess` interface exists in `types/index.ts`
6. `InviteLink` interface exists in `types/index.ts`
7. `api.ts` has `createInviteLink`, `listInviteLinks`, `revokeInviteLink`, `setTimeBomb`, `clearTimeBomb`, `changeUserRole`
8. MyTeamTab shows time bomb status for members with `timeBombAt` set
9. MyTeamTab has "Set Time Bomb" and "Clear Time Bomb" buttons
10. MyTeamTab has role change dropdown (STAFF/ACCOUNTANT/VIEWER only)
11. MyTeamTab has invite link creation form with role hint, expiry, max uses
12. MyTeamTab lists existing invite links with revoke buttons
13. MyTeamTab shows effective access badges (GRACE_PERIOD, TIME_BOMBED, PENDING_APPROVAL)
14. App.tsx shows warning banner for GRACE_PERIOD status
15. App.tsx shows restricted banner for TIME_BOMBED status
16. Only `Backend/src/routes/admin.ts` was modified in the backend (2-line Prisma select addition) — no other backend files changed
17. Search `Frontend/src/` for `timeBomb` — confirm references exist in types, api, and MyTeamTab
18. Search `Frontend/src/` for `InviteLink` — confirm references exist in types and api
19. Commit: `feat: wire frontend to RBAC backend (time bombs, invite links, role changes, 403 surfacing)`

---

## File Change Summary

| # | File | Action | Description |
|---|------|--------|-------------|
| 0 | `Backend/src/routes/admin.ts` | **MODIFY** | Add `timeBombAt: true` and `gracePeriodHours: true` to GET /admin/team Prisma select (2 lines) |
| 1 | `Frontend/src/types/index.ts` | **MODIFY** | Add `EffectiveAccess`, `InviteLink` interfaces; extend `TeamMember` with `timeBombAt`, `gracePeriodHours`, `effectiveAccess` |
| 2 | `Frontend/src/popup/lib/api.ts` | **MODIFY** | Add `createInviteLink`, `listInviteLinks`, `revokeInviteLink`, `setTimeBomb`, `clearTimeBomb`, `changeUserRole` |
| 3 | `Frontend/src/popup/components/MyTeamTab.tsx` | **MODIFY** | Add time bomb UI, role change dropdown, invite links section, effective access badges |
| 4 | `Frontend/src/popup/App.tsx` | **MODIFY** | Add GRACE_PERIOD and TIME_BOMBED status banners |
