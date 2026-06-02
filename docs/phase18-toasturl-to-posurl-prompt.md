# Phase 18 — `toastUrl → posUrl` Field Rename

**Context:** The `Location` model has a field called `toastUrl` which stores the POS system URL for a location. This name is too specific — the app now supports multiple POS platforms (Toast, Salido, Oracle). The field should be renamed to `posUrl` to be platform-agnostic. This is a pure rename — no logic changes, no new features, no new routes.

**Rules:**
1. Read ALL relevant files fully before making changes.
2. After ALL changes, run `cd Backend && npx tsc --noEmit` to verify zero errors.
3. Do NOT use `as any` to bypass type errors.
4. This phase modifies BOTH backend and frontend files.
5. Do NOT modify any existing route handlers' logic — only rename the field.
6. Do NOT change any URL patterns or route paths.
7. Do NOT rename anything related to the Toast POS *platform* — only the `toastUrl` field on the Location model. The content scanner files (`scanner.ts`, `salido-scanner.ts`, `oracle-scanner.ts`), the manifest `host_permissions`, and the `content_scripts` matches are about the Toast POS platform domain (`*.toasttab.com`) and must NOT be changed.
8. Do NOT modify `permissions.ts`, `audit.ts`, `timebomb.ts`, `auth.middleware.ts`, or `effective-role.ts`.
9. Commit message: `refactor: rename toastUrl to posUrl on Location model`

**Prerequisite reads — read ALL of these before writing any code:**
- `Backend/prisma/schema.prisma` — find the `Location` model and the `toastUrl` field
- `Backend/prisma/migrations/` — understand the migration naming convention (timestamp_prefix format)
- `Backend/prisma/seed.ts` — find `toastUrl` references in seed data
- `Backend/src/routes/locations.ts` — find all `toastUrl` references in POST and PUT handlers
- `Frontend/src/types/index.ts` — find `toastUrl` in the `Location` interface
- `Frontend/src/popup/lib/api.ts` — find `toastUrl` in `createLocation` function
- `Frontend/src/popup/components/SettingsView.tsx` — find `toastUrl` in form state, input, and display

---

## Key Repo Facts (verified against current codebase — READ THESE)

| Fact | Detail |
|------|--------|
| **Migration naming** | `YYYYMMDDHHMMSS_description` format — e.g., `20260527000118_add_user_hierarchy` |
| **Prisma import** | `import { prisma } from '../lib/prisma'` |
| **Location model** | `id`, `userId`, `adminId`, `name`, `toastUrl`, `isActive`, `memoTemplate`, `docNumberTemplate`, `createdAt`, `updatedAt` |
| **DB column name** | Prisma maps `toastUrl` to `"toastUrl"` in SQL (camelCase, no `@@map` on the field) |
| **Backend references** | `schema.prisma` (1), `seed.ts` (2), `locations.ts` (5) = 8 total |
| **Frontend references** | `types/index.ts` (1), `api.ts` (2), `SettingsView.tsx` (5) = 8 total |
| **DO NOT rename** | Content scanner `scanner.ts` (references Toast POS platform), manifest `host_permissions` (`*.toasttab.com`), manifest `content_scripts` matches, manifest description ("Toast POS") |
| **Toast is a platform name** | "Toast" in scanner.ts, manifest.json, and description refers to the Toast POS product. Only the `toastUrl` *field* on the Location model is being renamed. |

---

## The Change

Rename the `toastUrl` field to `posUrl` on the `Location` model, across the entire stack:

### Backend changes:

1. **`prisma/schema.prisma`** — Change `toastUrl String` to `posUrl String` on the Location model

2. **Create a new migration** — Run `cd Backend && npx prisma migrate dev --name rename_toast_url_to_pos_url --create-only` to generate the migration SQL. The generated SQL should be:
   ```sql
   ALTER TABLE "locations" RENAME COLUMN "toastUrl" TO "posUrl";
   ```
   Verify the generated SQL is correct (it should be a simple `RENAME COLUMN`). If Prisma generates a drop+add instead, manually edit the migration SQL to use `RENAME COLUMN` to preserve existing data.

3. **`prisma/seed.ts`** — Change `toastUrl:` to `posUrl:` in both location upserts (L70, L83)

4. **`src/routes/locations.ts`** — Change all `toastUrl` references to `posUrl`:
   - L36: `const { name, toastUrl }` → `const { name, posUrl }`
   - L38: `if (!name || !toastUrl)` → `if (!name || !posUrl)`
   - L39: `'name and toastUrl are required'` → `'name and posUrl are required'`
   - L50: `data: { userId: user.userId, adminId, name, toastUrl }` → `... name, posUrl }`
   - L94-95: type annotation `toastUrl?: string` → `posUrl?: string`
   - L103: `...(toastUrl !== undefined && { toastUrl })` → `...(posUrl !== undefined && { posUrl })`

### Frontend changes:

5. **`Frontend/src/types/index.ts`** — Change `toastUrl: string` to `posUrl: string` in the `Location` interface (L7)

6. **`Frontend/src/popup/lib/api.ts`** — Change `createLocation` function:
   - L175: `(jwt: string, name: string, toastUrl: string)` → `(jwt: string, name: string, posUrl: string)`
   - L176: `{ name, toastUrl }` → `{ name, posUrl }`

7. **`Frontend/src/popup/components/SettingsView.tsx`** — Change all `toastUrl` references:
   - L15: `{ name: '', toastUrl: '' }` → `{ name: '', posUrl: '' }`
   - L23: `api.createLocation(jwt, locForm.name, locForm.toastUrl)` → `...locForm.posUrl)`
   - L24: `{ name: '', toastUrl: '' }` → `{ name: '', posUrl: '' }`
   - L108: `value={locForm.toastUrl}` → `value={locForm.posUrl}`
   - L109: `setLocForm({ ...locForm, toastUrl: e.target.value })` → `...locForm, posUrl: e.target.value })`
   - L110: `"Toast URL (optional)"` → `"POS URL (optional)"`
   - L128: `l.toastUrl` → `l.posUrl` (appears twice on this line)

---

## Implementation Notes

1. **Migration must preserve data** — The SQL must be `ALTER TABLE "locations" RENAME COLUMN "toastUrl" TO "posUrl"`. Do NOT drop and recreate the column. If Prisma generates a drop+add migration, manually edit the migration file.

2. **Run the migration after creating it** — After verifying the SQL, run `cd Backend && npx prisma migrate dev` to apply it.

3. **Regenerate Prisma client** — `npx prisma generate` after schema change (this is usually done automatically by `migrate dev`).

4. **The `dist/` directories contain compiled JS** — These will be regenerated on next build. Do NOT manually edit `dist/` files.

5. **The placeholder text changes** — `"Toast URL (optional)"` becomes `"POS URL (optional)"` in the frontend form input. This is the only UI text change.

6. **No API contract breakage concern** — The API accepts/returns `posUrl` instead of `toastUrl`. Since the Chrome extension is the only consumer and we're updating it in the same phase, there's no versioning concern.

7. **The `updateLocation` route uses `Partial<Location>`** — Since we're renaming the field in the `Location` type, the PUT route automatically accepts `posUrl` instead of `toastUrl`. No separate change needed there.

---

## VERIFY

1. `cd Backend && npx tsc --noEmit` — zero errors
2. Verify `prisma/schema.prisma` has `posUrl String` (not `toastUrl`) on the Location model
3. Verify the migration SQL uses `RENAME COLUMN` (not drop+add)
4. Verify the migration has been applied (`npx prisma migrate dev`)
5. Verify `prisma/seed.ts` uses `posUrl` (not `toastUrl`)
6. Verify `locations.ts` has zero `toastUrl` references
7. Verify `Frontend/src/types/index.ts` has `posUrl` in Location interface
8. Verify `api.ts` createLocation uses `posUrl` parameter name and body key
9. Verify `SettingsView.tsx` has zero `toastUrl` references
10. Verify the form placeholder says "POS URL" not "Toast URL"
11. Verify NO changes to content scanner files, manifest host_permissions, or content_scripts
12. Verify NO changes to `permissions.ts`, `audit.ts`, `timebomb.ts`, `auth.middleware.ts`, `effective-role.ts`
13. Search the entire repo for remaining `toastUrl` references — there should be none in source files (only in `dist/` compiled output and old migration SQL, which are expected)
14. Search for `posUrl` in `Backend/src/` and `Frontend/src/` — confirm references exist in all expected locations (schema, seed, locations route, types, api, SettingsView)
15. Commit: `refactor: rename toastUrl to posUrl on Location model`

---

## File Change Summary

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `prisma/schema.prisma` | **MODIFY** | Rename `toastUrl` → `posUrl` on Location model |
| 2 | `prisma/migrations/..._rename_toast_url_to_pos_url/migration.sql` | **CREATE** | Auto-generated migration (verify it uses RENAME COLUMN) |
| 3 | `prisma/seed.ts` | **MODIFY** | Rename `toastUrl` → `posUrl` in seed data |
| 4 | `src/routes/locations.ts` | **MODIFY** | Rename all `toastUrl` → `posUrl` references |
| 5 | `Frontend/src/types/index.ts` | **MODIFY** | Rename `toastUrl` → `posUrl` in Location interface |
| 6 | `Frontend/src/popup/lib/api.ts` | **MODIFY** | Rename `toastUrl` → `posUrl` in createLocation |
| 7 | `Frontend/src/popup/components/SettingsView.tsx` | **MODIFY** | Rename all `toastUrl` → `posUrl` + update placeholder text |
