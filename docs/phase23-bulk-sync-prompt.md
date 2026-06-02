
# Phase 23 — Bulk Sync ("Sync All Pending")

**Phase:** 23
**Scope:** 3 changes — shared JE payload builder, batch sync endpoint, frontend "Sync All" button with progress
**Agent:** Mantra
**Estimated effort:** Medium — frontend utility extraction, backend endpoint, frontend UI
**Depends on:** Phase 22 (QB Sync Hardening — completed)

## Context

Phase 22 hardened the QB sync layer with retry logic, dedup, error classification, and DocNumber tracking. But users still sync scans one at a time via the Preview tab. This phase adds a bulk sync endpoint and a "Sync All Pending" button so users can sync all pending/mapped scans for a location in one action.

## Key Repo Facts

- **JE payload construction is entirely frontend-side.** `JournalEntryPreview.tsx` L234-260 builds `LineItem[]` from three inputs:
  1. `scanData` — raw key-value amounts from `ScanRecord.rawData` (type `Record<string, number>`)
  2. `savedMappings` — `Mapping[]` fetched via `api.getMappings(jwt, locationId)`
  3. `accounts` — live QB account list from `useQBContext()` (for `FullyQualifiedName` on each line)
- The mapping application logic includes: `decodeMapping()` (L134-159) with `targetMemo` JSON parsing, `guessPostingType()` (L75-111) with regex heuristics, negative-amount posting-side flipping (L245-247), and entity ref resolution (L417-427).
- The backend `POST /api/quickbooks/journal-entry` endpoint does NOT construct JE payloads — it validates and posts whatever `lines` the frontend sends.
- `ScanRecord` model: `id`, `locationId`, `scanDate`, `rawData: Json` (key-value amounts), `status` (PENDING/MAPPED/SYNCED/FAILED), `syncLogs: SyncLog[]`.
- `Mapping` model: `sourceField`, `targetAccount`, `postingType`, `keepSeparate`, `targetClass`, `targetName`, `targetDescription`, `targetMemo`.
- `Location` model has `memoTemplate?: String` and `docNumberTemplate?: String` — used to pre-fill `privateNote` and `docNumber` in JE preview.
- `callQB()` wraps all QB API calls with 401/429 retry (Phase 22).
- SyncLog-based dedup prevents duplicate JEs (Phase 22 Change #7).
- `QBApiError` classifies errors as TRANSIENT/AUTH/VALIDATION/FATAL (Phase 22 Change #1).
- DocNumber auto-generation: `NEST-{scanRecordId.substring(0,8)}` or `NEST-{randomBytes(4).toString('hex')}` fallback (Phase 22 Change #6).
- Frontend `SyncView` has `jwt` (L8), `locationId` (L25), `scans` state (L26), and imports `api` (L2), `useQuickBooks` (L4).
- Frontend `api.ts` has `post<T>(path, body, jwt)` helper (L42-57), `get<T>(path, jwt)` helper (L30-57), `del(path, jwt)` (L59-68).
- QB rate limit: 500 requests/minute per realm. Safe processing: ~5/sec = 200ms between calls.
- `api.getScans(jwt, locationId, page, limit)` returns `{ scans: ScanRecord[], hasMore: boolean }` with default limit 20.
- `api.getMappings(jwt, locationId)` returns `Mapping[]`.
- `api.createJournalEntry(jwt, txnDate, lines, scanRecordId?, privateNote?, docNumber?)` — existing single-sync method.

## Key Warnings — Anti-Fabrication

These types and patterns exist in the codebase. Do NOT fabricate alternatives:

- **`QBAccount`** type exists at `Frontend/src/popup/types/qb.ts`. It has `Id: string` and `FullyQualifiedName: string`. There is **NO** `QBAccountRef` type — do NOT create one. Use `QBAccount[]` directly.
- **`useQBContext`** exists at `Frontend/src/popup/contexts/QBContext.tsx`. It provides `accounts: QBAccount[]`, `classes: QBClass[]`, etc. `QBContextProvider` wraps the entire app at `App.tsx` L131, so it is available in `SyncView`.
- **QB route middleware chain** is: `authenticate, enforceEffectiveRole, requirePermission('canSync')`. See `quickbooks.ts` L218 for the existing journal-entry route. The batch route must use the same chain.
- **`api.createJournalEntry()`** at `api.ts` L263-269 uses **positional params**: `(jwt, txnDate, lines, scanRecordId?, privateNote?, docNumber?)`. It does NOT take an options object.
- **`ScanRecord.scanDate`** is a `string` (ISO format from backend). Use `.slice(0, 10)` to extract `YYYY-MM-DD`. Do NOT use `new Date()` or `toYMD()`.
- **`QBJournalLineItem`** is defined in `Backend/src/types/index.ts` L39-48. The frontend `api.createJournalEntry` types `lines` as `unknown[]`, but `buildJEPayload()` should produce properly typed `QBJournalLineItem[]`.

## Architecture Decision: Frontend Constructs Payloads

**Why NOT server-side JE construction (Design A):**
The backend would need to port ~200 lines of frontend logic: `decodeMapping()` with `targetMemo` JSON parsing, `guessPostingType()` with 35 lines of regex heuristics, negative-amount flipping, entity ref resolution (needs QB entity lists), account name resolution (needs QB account list), the `consolidate` toggle, and auto-balancing. This is massive scope creep and creates a second source of truth that will diverge from the frontend.

**Why frontend constructs payloads (Design C):**
The frontend already has all the JE construction logic in `JournalEntryPreview.tsx`. The batch flow reuses this logic by extracting it into a shared utility. The backend just iterates over pre-built payloads — it doesn't need to understand mappings, scan data, or posting types.

---

## Group A — Shared JE Payload Builder

### Change #1: Extract `buildJEPayload()` Utility Function

**Files:**
- `Frontend/src/popup/lib/je-builder.ts` (NEW — shared utility)
- `Frontend/src/popup/components/JournalEntryPreview.tsx` (refactor to use shared utility)

**Problem:** JE line construction logic is embedded in `JournalEntryPreview.tsx`. The batch sync flow needs the same logic but cannot render the preview component. The logic must be extracted into a reusable function.

**Fix:**

Create `Frontend/src/popup/lib/je-builder.ts` with a `buildJEPayload()` function that encapsulates the mapping-application + line-construction logic currently at `JournalEntryPreview.tsx` L234-260 and L412-451.

The file should export:

1. **`decodeMapping(m: Mapping): DecodedMapping`** — Extracted from L134-159. Parses `targetMemo` JSON for overrides, normalizes `postingType` and `classId`.

2. **`guessPostingType(field: string): 'debit' | 'credit'`** — Extracted from L75-111. Regex-based heuristic for determining posting side when no mapping exists.

3. **`buildJEPayload(params): JEPayload`** — The core function. Parameters:

```typescript
export interface JEPayload {
  scanRecordId: string;
  txnDate: string;
  lines: QBJournalLineItem[];
  privateNote?: string;
  docNumber?: string;
}

export function buildJEPayload(params: {
  scanRecordId: string;
  scanData: ScanData;           // Record<string, number> from ScanRecord.rawData
  mappings: Mapping[];           // From api.getMappings()
  accounts: QBAccount[];          // from ../types/qb — has Id + FullyQualifiedName
  txnDate: string;              // YYYY-MM-DD
  privateNote?: string;
  docNumber?: string;
}): JEPayload
```

Logic (mirrors `JournalEntryPreview.tsx` L234-260 + L412-451):
1. Decode mappings: `const decoded = mappings.map(decodeMapping)`
2. Build display lines from `scanData` entries (filter out zero values)
3. For each entry: find matching mapping, determine posting side (mapping or `guessPostingType`), flip side for negative amounts
4. Convert display lines to `QBJournalLineItem[]` — each entry produces a Debit line, Credit line, or both (split entries)
5. Return `{ scanRecordId, txnDate, lines: jeLines, privateNote, docNumber }`

⚠️ **Entity refs are NOT included in `buildJEPayload()`** — entity ref resolution (L417-427) is a manual per-line override in the preview UI, not derived from mappings. For batch sync, entity refs from mappings are handled via the `targetName` field if needed in a future phase.

**Then refactor `JournalEntryPreview.tsx` to use the shared utility:**

1. Import `buildJEPayload`, `decodeMapping`, `guessPostingType` from `'../lib/je-builder'`
2. Remove the local `decodeMapping` function (L134-159) and `guessPostingType` function (L75-111)
3. Replace the scan-data-to-lines effect (L234-261) to use `buildJEPayload()` or the individual functions
4. Replace the `handleSync` line construction (L412-451) to use `buildJEPayload()`

⚠️ The refactoring must be **behavior-preserving** — the JE preview must work exactly as before. The only change is where the logic lives, not what it does. Mantra should test single-sync through the Preview tab after refactoring to confirm identical behavior.

**Verify:**
- `je-builder.ts` exports `buildJEPayload`, `decodeMapping`, `guessPostingType`, `JEPayload`
- `JournalEntryPreview.tsx` imports from `je-builder.ts` instead of defining locally
- Single-sync flow works exactly as before (behavior-preserving refactor)
- `buildJEPayload()` produces the same `QBJournalLineItem[]` as the inline logic
- `tsc --noEmit` passes after refactoring

---

## Group B — Batch Sync Endpoint

### Change #2: `POST /api/quickbooks/sync-batch`

**Files:**
- `Backend/src/routes/quickbooks.ts` (new route + extract `syncSingleScan()`)
- `Frontend/src/types/index.ts` (add `BatchSyncItem`, `BatchSyncResult`, `BatchSyncSummary`)
- `Frontend/src/popup/lib/api.ts` (add `syncBatch` method)

**Problem:** No way to sync multiple scans at once. Users must click through each scan individually.

**Part A — Extract `syncSingleScan()` from journal-entry route:**

The existing journal-entry route (L218-337) contains per-scan logic that the batch endpoint needs: dedup check, DocNumber generation, `callQB()` invocation, SyncLog creation, ScanRecord update. Extract this into a shared internal function.

```typescript
interface SyncSingleResult {
  status: 'SYNCED' | 'SKIPPED' | 'FAILED';
  qbJournalEntryId?: string;
  docNumber?: string;
  reason?: string;        // for SKIPPED: 'already_synced'
  errorType?: string;     // for FAILED: from QBApiError.category
  errorMessage?: string;  // for FAILED
}

async function syncSingleScan(
  userId: string,
  scanRecordId: string,
  txnDate: string,
  lines: QBJournalLineItem[],
  privateNote?: string,
  docNumber?: string,
): Promise<SyncSingleResult>
```

Logic (extracted from journal-entry route L250-336):
1. **Dedup check:** `prisma.syncLog.findFirst({ where: { scanRecordId, status: 'SUCCESS' } })`. If found, return `{ status: 'SKIPPED', reason: 'already_synced', qbJournalEntryId, docNumber }`.
2. **DocNumber generation:** `docNumber || NEST-{scanRecordId.substring(0,8)}` or `NEST-{randomBytes(4).toString('hex')}` fallback.
3. **Create JE via `callQB()`:** `callQB(userId, ({ accessToken, realmId }) => qbService.createJournalEntry({ txnDate, docNumber: finalDocNumber, lines, privateNote, realmId, accessToken }))`.
4. **On success:** Create SyncLog with `docNumber`, update ScanRecord to SYNCED. Return `{ status: 'SYNCED', qbJournalEntryId, docNumber }`.
5. **On failure:** Extract `errorType` from `QBApiError.category`, create FAILED SyncLog with `errorType` + `errorMessage`, update ScanRecord to FAILED. Return `{ status: 'FAILED', errorType, errorMessage }`.

Then update the existing journal-entry route to call `syncSingleScan()` instead of inline logic. This ensures both endpoints use identical sync logic.

**Part B — Add batch endpoint:**

```typescript
router.post('/sync-batch', authenticate, enforceEffectiveRole, requirePermission('canSync'), async (req, res) => { ... })
```

Request body:
```typescript
{
  items: Array<{
    scanRecordId: string;
    txnDate: string;           // YYYY-MM-DD
    lines: QBJournalLineItem[];
    privateNote?: string;
    docNumber?: string;
  }>
}
```

Validation:
1. `items` must be non-empty array, max 100 per batch
2. Each item must have `scanRecordId`, `txnDate`, and `lines` (non-empty array)
3. Each scan must belong to a location accessible by the requesting user — batch-fetch all scans, filter by user's accessible locations
4. Each scan must have status PENDING or MAPPED — skip SYNCED/FAILED scans (they will be caught by dedup anyway, but this avoids unnecessary processing)

Processing — sequential with 200ms delay between scans:
```typescript
const results: BatchSyncResult[] = [];
let authAborted = false;

for (let i = 0; i < items.length; i++) {
  const item = items[i];

  // If AUTH error aborted previous scan, mark all remaining as AUTH failed
  if (authAborted) {
    results.push({
      scanRecordId: item.scanRecordId,
      status: 'FAILED',
      errorType: 'AUTH',
      errorMessage: 'QB connection expired — batch aborted',
    });
    // Also create FAILED SyncLog + update ScanRecord for each remaining scan
    await prisma.syncLog.create({
      data: {
        scanRecordId: item.scanRecordId,
        status: 'FAILED',
        errorType: 'AUTH',
        errorMessage: 'QB connection expired — batch aborted',
      },
    }).catch(console.error);
    await prisma.scanRecord.update({
      where: { id: item.scanRecordId },
      data: { status: 'FAILED' },
    }).catch(console.error);
    continue;
  }

  const result = await syncSingleScan(
    req.user!.userId,
    item.scanRecordId,
    item.txnDate,
    item.lines,
    item.privateNote,
    item.docNumber,
  );

  results.push({ scanRecordId: item.scanRecordId, ...result });

  // If AUTH failure, abort remaining scans
  if (result.status === 'FAILED' && result.errorType === 'AUTH') {
    authAborted = true;
  }

  // 200ms delay between scans (except after last scan)
  if (i < items.length - 1) {
    await sleep(200);
  }
}
```

Response:
```json
{
  "results": [
    { "scanRecordId": "abc", "status": "SYNCED", "qbJournalEntryId": "123", "docNumber": "NEST-abcdef12" },
    { "scanRecordId": "def", "status": "SKIPPED", "reason": "already_synced", "qbJournalEntryId": "456" },
    { "scanRecordId": "ghi", "status": "FAILED", "errorType": "VALIDATION", "errorMessage": "Unbalanced journal entry" },
    { "scanRecordId": "jkl", "status": "FAILED", "errorType": "AUTH", "errorMessage": "QB connection expired — batch aborted" }
  ],
  "summary": { "total": 4, "synced": 1, "skipped": 1, "failed": 2 }
}
```

**Part C — Frontend types and API method:**

Add to `Frontend/src/types/index.ts`:
```typescript
export interface BatchSyncItem {
  scanRecordId: string;
  txnDate: string;
  lines: QBJournalLineItem[];
  privateNote?: string;
  docNumber?: string;
}

export interface BatchSyncResult {
  scanRecordId: string;
  status: 'SYNCED' | 'SKIPPED' | 'FAILED';
  qbJournalEntryId?: string;
  docNumber?: string;
  reason?: string;
  errorType?: string;
  errorMessage?: string;
}

export interface BatchSyncSummary {
  total: number;
  synced: number;
  skipped: number;
  failed: number;
}
```

Add to `Frontend/src/popup/lib/api.ts`:
```typescript
syncBatch: (jwt: string, items: BatchSyncItem[]) =>
  post<{ results: BatchSyncResult[]; summary: BatchSyncSummary }>(
    '/api/quickbooks/sync-batch',
    { items },
    jwt,
  ),
```

⚠️ Import `BatchSyncItem` from `../../types` in api.ts.

**Verify:**
- `syncSingleScan()` extracted and used by both single-sync and batch endpoints
- Single-sync endpoint behavior unchanged after extraction
- Batch endpoint processes scans sequentially with 200ms delay
- Dedup check prevents duplicate JEs
- Per-scan failure does not abort the batch (except AUTH)
- AUTH failure aborts batch — remaining scans get FAILED SyncLog + ScanRecord update
- Response includes per-scan results and summary counts
- Max 100 items per batch enforced
- `BatchSyncItem`, `BatchSyncResult`, `BatchSyncSummary` types defined
- `api.syncBatch` method exists
- `tsc --noEmit` passes

---

## Group C — Frontend "Sync All" Button + Progress

### Change #3: SyncView "Sync All Pending" Button

**Files:**
- `Frontend/src/popup/components/SyncView.tsx` (add button + progress UI)

**Problem:** Users can only sync one scan at a time via the Preview tab. No way to bulk-sync pending scans from the Sync view.

**Fix:**

1. **Add "Sync All Pending" button** in the stats bar area (after the `{totalPending} pending` badge at L90-94). Conditions for showing:
   - `totalPending > 0` (at least one PENDING or MAPPED scan in the current list)
   - Not currently syncing (`!batchSyncing`)
   - QB is connected (`status.connected`)

2. **On click — `handleSyncAll()`:**
   - Set `batchSyncing = true`, `batchProgress = 'Preparing...'`
   - Fetch ALL pending scans for the location (not just current page):
     ```typescript
     const allPending: ScanRecord[] = [];
     let page = 1;
     let hasMore = true;
     while (hasMore) {
       const { scans, hasMore: more } = await api.getScans(jwt, locationId, page, 100);
       allPending.push(...scans.filter(s => s.status === 'PENDING' || s.status === 'MAPPED'));
       hasMore = more;
       page++;
     }
     ```
   - Fetch mappings for the location: `const mappings = await api.getMappings(jwt, locationId)`
   - Get QB accounts from context (already available via `useQBContext` — SyncView needs to import this)
   - Build payloads for each scan using `buildJEPayload()`:
     ```typescript
     const items: BatchSyncItem[] = allPending
       .map(scan => buildJEPayload({
         scanRecordId: scan.id,
         scanData: scan.rawData,
         mappings,
         accounts,  // QBAccount[] from useQBContext()
         txnDate: scan.scanDate.slice(0, 10),  // scanDate is ISO string, extract YYYY-MM-DD
       }))
       .filter(item => item.lines.length > 0);  // skip scans with no mapped lines
     ```
   - Set `batchProgress = 'Syncing X scans...'`
   - Call `const { results, summary } = await api.syncBatch(jwt, items)`
   - Show summary toast: `"{summary.synced} synced, {summary.skipped} skipped, {summary.failed} failed"`
   - If any AUTH failures, show additional warning: "QuickBooks connection expired. Please reconnect."
   - Refresh the scan list (re-fetch page 1)
   - Clear `batchSyncing`, reset `batchProgress`

3. **Progress UI** while syncing:
   - Disable the "Sync All" button, "Load more" button, and location picker
   - Show spinner + `batchProgress` text: "Preparing..." → "Syncing X scans..."
   - Since it is one POST request, the client does not get per-scan progress — just a static message

4. **Button styling:** Match the existing "pending" badge style — amber/yellow theme:
   ```html
   <button
     onClick={handleSyncAll}
     disabled={batchSyncing}
     className="text-xs bg-amber-700 hover:bg-amber-600 disabled:bg-amber-900 text-white px-3 py-1 rounded transition-colors"
   >
     {batchSyncing ? '⏳ Syncing...' : '⚡ Sync All Pending'}
   </button>
   ```

5. **Edge cases:**
   - No QB connection: hide the button (already handled by `status.connected` check)
   - No pending scans: hide the button (already handled by `totalPending > 0`)
   - Scans with zero mapped lines: `buildJEPayload()` returns empty `lines[]` — filter these out before sending to batch endpoint
   - Scans with unmapped fields: `buildJEPayload()` produces lines with empty `accountId` — the QB API will return a VALIDATION error, which is correctly categorized. These scans will appear as FAILED in the results.
   - Network error during batch: show error toast, clear syncing state
   - Very large batches (100+ scans): the 200ms delay means ~20 seconds max. The frontend should show the spinner and not time out. The `fetch()` call has no default timeout in browsers, so this should be fine.

⚠️ **SyncView needs `useQBContext`** for the QB accounts list. Currently SyncView does not import it. Mantra should add:
```typescript
import { useQBContext } from '../contexts/QBContext';
// ...
const { accounts } = useQBContext();
```

⚠️ **`scanDate` format:** `ScanRecord.scanDate` is a `string` (ISO format from the backend). Mantra should note:
- `scanDate` is already an ISO string — use `.slice(0, 10)` to get YYYY-MM-DD
- No `toYMD` helper or Date conversion needed



**Verify:**
- "Sync All Pending" button visible when pending/mapped scans exist AND QB is connected
- Button hidden when no pending scans or QB not connected
- Button disabled + spinner shown during sync
- All pending scans across all pages are fetched and synced
- `buildJEPayload()` from `je-builder.ts` used to construct payloads
- Summary toast shows synced/skipped/failed counts
- AUTH failure shows additional reconnection warning
- Scan list refreshed after sync completes
- `tsc --noEmit` passes

---

## Cross-Cutting Notes

1. **Execution order:** Change #1 (je-builder extraction) → Change #2 (batch endpoint) → Change #3 (SyncView UI). The extraction MUST happen first because both the batch endpoint's frontend payload construction and the SyncView depend on `buildJEPayload()`.

2. **No schema changes required** — all models already have the fields needed.

3. **No changes to single-sync flow** — the existing journal-entry endpoint remains unchanged (just refactored to call `syncSingleScan()`).

4. **Rate limiting:** 200ms server-side delay keeps us well within 500/min QB limit.

5. **Behavior-preserving refactoring:** Change #1 is a pure refactor. Mantra should verify that single-sync through the Preview tab works identically after the extraction before proceeding to Change #2.

6. **Type safety:** `tsc --noEmit` should pass with zero errors after all changes.

7. **Existing tests:** Do not modify test files unless they reference the refactored functions.

8. **The `consolidate` toggle and auto-balancing** in `JournalEntryPreview.tsx` are NOT part of `buildJEPayload()`. These are UI-level features that apply after initial line construction. For batch sync, lines are constructed from mappings without consolidation or auto-balancing. If a scan's lines are unbalanced, QB will return a VALIDATION error, which is correctly handled.

9. **Future consideration:** If server-side JE construction is needed later (e.g., scheduled auto-sync), the `buildJEPayload()` logic would need to be ported to the backend. This is deferred to a future phase.
