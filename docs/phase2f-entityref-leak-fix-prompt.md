# Phase 2F: EntityRef Type Leak Fix - Strip `type` from EntityRef in QB Payload

## Context

Phase 2E added the `type` field to `entityRef` in the frontend, which correctly passes `Customer`/`Vendor`/`Employee` to the backend. However, the backend currently passes the **entire** `entityRef` object (including the `type` field) into QuickBooks' `EntityRef`, which is wrong.

### The Bug

In `qb.service.ts` line 135:

```typescript
if (line.entityRef) lineDetail.Entity = { EntityRef: line.entityRef, Type: line.entityRef.type ?? 'Customer' };
```

This spreads the full `entityRef` object -- `{ value, name, type }` -- into `EntityRef`. The QuickBooks JournalEntry API expects `EntityRef` to contain only `{ value, name }`. The `type` field leaks into `EntityRef` as an unrecognized property.

**What QB expects:**
```json
"Entity": {
  "EntityRef": { "value": "123", "name": "Acme Corp" },
  "Type": "Customer"
}
```

**What we currently send:**
```json
"Entity": {
  "EntityRef": { "value": "123", "name": "Acme Corp", "type": "Customer" },
  "Type": "Customer"
}
```

QB will likely ignore the extra `type` field, but it's not clean and could cause a cryptic validation error on some QB versions or future API changes.

## What This Task Does

Strip the `type` field from the `EntityRef` object so QB receives exactly the shape it expects.

## ABSOLUTE RULES (violating any = instant reject)

1. **DO NOT touch any frontend file** -- the frontend correctly sends `type` in `entityRef`, and the backend needs it for the `Type` field
2. **DO NOT touch `types/index.ts`** -- the `QBJournalLineItem` type is correct as-is
3. **DO NOT touch `manifest.json`** -- no new permissions
4. **DO NOT add new dependencies**
5. **DO NOT change any other line in `qb.service.ts`** -- only line 135
6. All existing functionality must continue to work exactly as before

## Task: Strip `type` from EntityRef in qb.service.ts

### Current Code (line 135)
```typescript
    if (line.entityRef) lineDetail.Entity = { EntityRef: line.entityRef, Type: line.entityRef.type ?? 'Customer' };
```

### New Code
Replace with:

```typescript
    if (line.entityRef) lineDetail.Entity = { EntityRef: { value: line.entityRef.value, name: line.entityRef.name }, Type: line.entityRef.type ?? 'Customer' };
```

**Key change:**
1. `EntityRef` now explicitly includes only `value` and `name` -- the two fields QB expects
2. `Type` still reads from `line.entityRef.type` with `'Customer'` fallback -- unchanged behavior
3. The `type` field no longer leaks into the `EntityRef` object sent to QB

## Expected Behavior After Changes

1. Line with `entityRef = { value: '123', name: 'Acme Corp', type: 'Customer' }` -> QB gets `Entity: { EntityRef: { value: '123', name: 'Acme Corp' }, Type: 'Customer' }`
2. Line with `entityRef = { value: '456', name: 'Tip Payouts LLC', type: 'Vendor' }` -> QB gets `Entity: { EntityRef: { value: '456', name: 'Tip Payouts LLC' }, Type: 'Vendor' }`
3. Line with `entityRef = { value: '789', name: 'John Smith', type: 'Employee' }` -> QB gets `Entity: { EntityRef: { value: '789', name: 'John Smith' }, Type: 'Employee' }`
4. Line with `entityRef` missing `type` -> QB gets `Type: 'Customer'` (fallback) (unchanged)
5. Line with no `entityRef` -> no `Entity` in QB payload (unchanged)

## Files Modified

| File | Changes |
|------|--------|
| `Backend/src/services/qb.service.ts` | Strip `type` from `EntityRef` object on line 135 |

**NO other files touched.**

## Verification

After making changes:

1. Run `npx tsc --noEmit` in the Backend directory -- must have zero errors
2. Commit with message: `fix: strip type field from EntityRef in QB journal entry payload`
3. Do NOT push (user will test locally first)

## Testing Checklist (for user)

After rebuilding and reloading:

1. Sync a journal entry with a Customer entity -> verify QB accepts it and Entity shows correctly
2. Sync a journal entry with a Vendor entity -> verify QB accepts it and Entity shows as Vendor
3. Sync a journal entry with an Employee entity -> verify QB accepts it and Entity shows as Employee
4. Sync a journal entry with no entity -> verify it works (unchanged)
5. Check the raw QB API request body (via backend logs) -> confirm `EntityRef` contains only `value` and `name`, no `type`