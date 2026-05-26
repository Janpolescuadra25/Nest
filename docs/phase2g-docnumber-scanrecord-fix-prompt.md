# Phase 2G: Fix docNumber/scanRecordId Bug + Add DocNumber to QB Payload

## Context

A critical bug was found in the scan-to-sync pipeline. The frontend's `JournalEntryPreview.tsx` passes `docNumber` as the 4th argument to `api.createJournalEntry()`, but that parameter is `scanRecordId` — not `docNumber`. If the user enters a doc number (e.g., "NEST-001"), the backend will try to use it as a Prisma foreign key to look up a `ScanRecord`, which will fail with a 500 error.

Additionally, `docNumber` is never sent to the QB API, so even if the user fills it in, it's lost.

## The Bug

### Frontend: JournalEntryPreview.tsx line 452-455
```typescript
      const result = await api.createJournalEntry(
        jwt, txnDate, jeLines, docNumber || undefined,
        privateNote || `Nest sync — ${txnDate} — ${locations[0]?.name ?? ''}`,
      ) as { journalEntryId: string; txnDate: string };
```

The 4th argument is `docNumber`, but `api.createJournalEntry` defines the 4th parameter as `scanRecordId`:

### Frontend: api.ts line 122-129
```typescript
  createJournalEntry: (
    jwt: string,
    txnDate: string,
    lines: unknown[],
    scanRecordId?: string,
    privateNote?: string
  ) =>
    post('/api/quickbooks/journal-entry', { txnDate, lines, scanRecordId, privateNote }, jwt),
```

So `docNumber` value (e.g., "NEST-001") gets sent as `scanRecordId` in the request body.

### Backend: quickbooks.ts line 247-259
```typescript
    if (scanRecordId) {
      await prisma.syncLog.create({
        data: {
          scanRecordId,
          qbJournalEntryId: result.id,
          status: 'SUCCESS',
        },
      });

      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'SYNCED' },
      });
    }
```

If `scanRecordId` is "NEST-001", `prisma.syncLog.create` will fail with a foreign key constraint error (no ScanRecord with that ID exists), and `prisma.scanRecord.update` will fail too. The QB journal entry IS created successfully, but the response to the frontend is a 500 error — confusing the user.

## What This Task Does

1. Add `docNumber` as a proper parameter to `api.createJournalEntry`
2. Fix the call site in `JournalEntryPreview.tsx` to pass `docNumber` correctly
3. Add `docNumber` to the backend payload so it reaches the QB API
4. Pass `scanRecordId` correctly (currently it's never passed from the preview)

## ABSOLUTE RULES (violating any = instant reject)

1. **DO NOT touch `scanner.ts`** — scanner is correct
2. **DO NOT touch `manifest.json`** — no new permissions
3. **DO NOT add new dependencies**
4. **DO NOT change the QB API call URL or minorversion**
5. All existing functionality must continue to work exactly as before
6. The `scanRecordId` must be passed as `undefined` from the preview for now (the scan-to-save flow is separate)

## Task: Fix 3 files

### File 1: Frontend/src/popup/lib/api.ts

#### Current code (lines 122-129):
```typescript
  createJournalEntry: (
    jwt: string,
    txnDate: string,
    lines: unknown[],
    scanRecordId?: string,
    privateNote?: string
  ) =>
    post('/api/quickbooks/journal-entry', { txnDate, lines, scanRecordId, privateNote }, jwt),
```

#### New code:
```typescript
  createJournalEntry: (
    jwt: string,
    txnDate: string,
    lines: unknown[],
    scanRecordId?: string,
    privateNote?: string,
    docNumber?: string
  ) =>
    post('/api/quickbooks/journal-entry', { txnDate, lines, scanRecordId, privateNote, docNumber }, jwt),
```

**Changes:**
- Added `docNumber?: string` as 6th parameter
- Added `docNumber` to the POST body

### File 2: Frontend/src/popup/components/JournalEntryPreview.tsx

#### Current code (lines 452-455):
```typescript
      const result = await api.createJournalEntry(
        jwt, txnDate, jeLines, docNumber || undefined,
        privateNote || `Nest sync — ${txnDate} — ${locations[0]?.name ?? ''}`,
      ) as { journalEntryId: string; txnDate: string };
```

#### New code:
```typescript
      const result = await api.createJournalEntry(
        jwt, txnDate, jeLines, undefined,
        privateNote || `Nest sync — ${txnDate} — ${locations[0]?.name ?? ''}`,
        docNumber || undefined,
      ) as { journalEntryId: string; txnDate: string };
```

**Changes:**
- 4th arg: `docNumber || undefined` → `undefined` (scanRecordId — not used from preview)
- 5th arg: unchanged (privateNote)
- 6th arg: `docNumber || undefined` (the actual docNumber, passed correctly)

### File 3: Backend/src/types/index.ts

#### Current code (lines 28-34):
```typescript
export interface CreateJournalEntryInput {
  txnDate: string;             // YYYY-MM-DD
  privateNote?: string;
  lines: QBJournalLineItem[];
  realmId: string;
  accessToken: string;
}
```

#### New code:
```typescript
export interface CreateJournalEntryInput {
  txnDate: string;             // YYYY-MM-DD
  docNumber?: string;
  privateNote?: string;
  lines: QBJournalLineItem[];
  realmId: string;
  accessToken: string;
}
```

**Changes:**
- Added `docNumber?: string` field

### File 4: Backend/src/routes/quickbooks.ts

#### Current code (lines 204-209):
```typescript
    const { txnDate, lines, privateNote, scanRecordId } = req.body as {
      txnDate?: string;
      lines?: QBJournalLineItem[];
      privateNote?: string;
      scanRecordId?: string;
    };
```

#### New code:
```typescript
    const { txnDate, lines, privateNote, scanRecordId, docNumber } = req.body as {
      txnDate?: string;
      lines?: QBJournalLineItem[];
      privateNote?: string;
      scanRecordId?: string;
      docNumber?: string;
    };
```

#### Current code (lines 237-243):
```typescript
    const input: CreateJournalEntryInput = {
      txnDate,
      lines,
      privateNote,
      realmId: qbToken.realmId,
      accessToken,
    };
```

#### New code:
```typescript
    const input: CreateJournalEntryInput = {
      txnDate,
      docNumber,
      lines,
      privateNote,
      realmId: qbToken.realmId,
      accessToken,
    };
```

### File 5: Backend/src/services/qb.service.ts

#### Current code (lines 118-119):
```typescript
function buildJournalEntryPayload(input: CreateJournalEntryInput): object {
  const { txnDate, lines, privateNote } = input;
```

#### New code:
```typescript
function buildJournalEntryPayload(input: CreateJournalEntryInput): object {
  const { txnDate, docNumber, lines, privateNote } = input;
```

#### Current code (lines 159-164):
```typescript
  const payload: Record<string, unknown> = {
    TxnDate: txnDate,
    Line: qbLines,
  };

  if (privateNote) payload.PrivateNote = privateNote;
```

#### New code:
```typescript
  const payload: Record<string, unknown> = {
    TxnDate: txnDate,
    Line: qbLines,
  };

  if (docNumber) payload.DocNumber = docNumber;
  if (privateNote) payload.PrivateNote = privateNote;
```

## Expected Behavior After Changes

1. User enters doc number "NEST-001" → QB receives `DocNumber: "NEST-001"` in the JE payload ✅
2. User leaves doc number empty → no `DocNumber` in QB payload ✅
3. `scanRecordId` is `undefined` → no Prisma lookup attempted → no 500 error ✅
4. QB creates JE with DocNumber → shows in QB UI ✅
5. Private note still works as before ✅
6. Sync logging still works when `scanRecordId` is provided (from the scan-save flow) ✅

## Files Modified

| File | Changes |
|------|--------|
| `Frontend/src/popup/lib/api.ts` | Add `docNumber` parameter to `createJournalEntry` |
| `Frontend/src/popup/components/JournalEntryPreview.tsx` | Fix arg order — pass `docNumber` as 6th arg, `scanRecordId` as `undefined` |
| `Backend/src/types/index.ts` | Add `docNumber` to `CreateJournalEntryInput` |
| `Backend/src/routes/quickbooks.ts` | Destructure `docNumber` from body, pass to input |
| `Backend/src/services/qb.service.ts` | Destructure `docNumber`, add `DocNumber` to QB payload |

## Verification

After making changes:

1. Run `npx tsc --noEmit` in the Backend directory — must have zero errors
2. Run `npx tsc --noEmit` in the Frontend directory — must have zero errors
3. Commit with message: `fix: separate docNumber from scanRecordId, add DocNumber to QB payload`
4. Do NOT push (user will test locally first)

## Testing Checklist (for user)

After rebuilding and reloading:

1. Sync a JE with a doc number entered → verify QB shows the DocNumber ✅
2. Sync a JE without a doc number → verify it works (no DocNumber in payload) ✅
3. Sync a JE with a private note → verify it still appears in QB ✅
4. Check backend logs → no Prisma errors about scanRecordId ✅
5. Check the raw QB API request body → confirm `DocNumber` is present when provided ✅
