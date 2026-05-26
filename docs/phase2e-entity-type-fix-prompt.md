# Phase 2E: Entity Type Bug Fix — Pass Correct Entity Type to QuickBooks

## Context

The sync pipeline is fully wired: scan → map → preview → sync → QB. But there's a bug in `handleSync` that causes QuickBooks to reject journal entries that use **Vendor** or **Employee** entity refs.

### The Bug 🔴

In `JournalEntryPreview.tsx`, `handleSync` builds `entityRef` objects from `l.entityVal` (which has the format `customer:123`, `vendor:456`, `employee:789`):

```typescript
// Current code (line 416-422):
let entityRef: { value: string; name?: string } | undefined;
if (l.entityVal) {
  const parts = l.entityVal.split(':');
  const eId = parts[1];
  const opt = entityOptions.find((o) => o.value === l.entityVal);
  if (eId) entityRef = { value: eId, name: opt?.label };
}
```

The `entityRef` object has **no `type` field**. It only sends `{ value, name }`.

Meanwhile, the backend (`qb.service.ts` line 135) does:
```typescript
if (line.entityRef) lineDetail.Entity = { EntityRef: line.entityRef, Type: line.entityRef.type ?? 'Customer' };
```

Since `entityRef.type` is always `undefined`, QB always gets `Type: 'Customer'`. This means:
- ✅ Customer entity refs work fine
- ❌ Vendor entity refs get sent as `Type: 'Customer'` → QB rejects them
- ❌ Employee entity refs get sent as `Type: 'Customer'` → QB rejects them

The QuickBooks JournalEntry API requires the correct `Type` value (`'Customer'`, `'Vendor'`, or `'Employee'`) to match the entity being referenced.

### Why This Matters

If a user assigns a Vendor (e.g., a tip payout vendor) or an Employee to a journal entry line, the sync will fail with a QB validation error. The error message from QB is cryptic and won't clearly indicate the root cause.

## What This Task Does

Add the `type` field to `entityRef` in `handleSync`, derived from the prefix in `l.entityVal`.

## ABSOLUTE RULES (violating any = instant reject)

1. **DO NOT touch any backend file** — the backend already handles `entityRef.type` correctly (line 135 of `qb.service.ts`)
2. **DO NOT touch `types/index.ts`** — the `QBJournalLineItem` type already has `type?: string` on `entityRef`
3. **DO NOT touch `manifest.json`** — no new permissions
4. **DO NOT add new dependencies**
5. **DO NOT change the `SearchableSelect` component**
6. **DO NOT change `entityOptions`** — the prefix format (`customer:`, `vendor:`, `employee:`) is correct
7. All existing functionality must continue to work exactly as before

## Task: Fix entityRef to include type in handleSync

### Current Code (lines 416-422)
```typescript
          let entityRef: { value: string; name?: string } | undefined;
          if (l.entityVal) {
            const parts = l.entityVal.split(':');
            const eId = parts[1];
            const opt = entityOptions.find((o) => o.value === l.entityVal);
            if (eId) entityRef = { value: eId, name: opt?.label };
          }
```

### New Code
Replace with:

```typescript
          let entityRef: { value: string; name?: string; type?: string } | undefined;
          if (l.entityVal) {
            const parts = l.entityVal.split(':');
            const eType = parts[0];
            const eId = parts[1];
            const opt = entityOptions.find((o) => o.value === l.entityVal);
            if (eId) entityRef = {
              value: eId,
              name: opt?.label,
              type: eType === 'vendor' ? 'Vendor' : eType === 'employee' ? 'Employee' : 'Customer',
            };
          }
```

**Key change:** 
1. The type annotation adds `type?: string` to the `entityRef` object shape
2. `eType = parts[0]` extracts the prefix (`customer`, `vendor`, or `employee`)
3. The ternary maps the lowercase prefix to the QB-expected PascalCase type string
4. Default is `'Customer'` — same as the backend fallback, so no behavior change for customer refs

## Expected Behavior After Changes

1. Line with `entityVal = 'customer:123'` → `entityRef = { value: '123', name: 'Acme Corp', type: 'Customer' }` ✅
2. Line with `entityVal = 'vendor:456'` → `entityRef = { value: '456', name: 'Tip Payouts LLC', type: 'Vendor' }` ✅ (was `'Customer'` ❌)
3. Line with `entityVal = 'employee:789'` → `entityRef = { value: '789', name: 'John Smith', type: 'Employee' }` ✅ (was `'Customer'` ❌)
4. Line with no entity → `entityRef = undefined` → no Entity in QB payload ✅ (unchanged)

## Files Modified

| File | Changes |
|------|---------|
| `Frontend/src/popup/components/JournalEntryPreview.tsx` | Add `type` field to `entityRef` in `handleSync`, derived from `entityVal` prefix |

**NO other files touched.**

## Verification

After making changes:

1. Run `npx tsc --noEmit` — must have zero errors
2. Run `npm run build` — must succeed
3. Commit with message: `fix: pass correct entity type (Customer/Vendor/Employee) to QuickBooks sync`
4. Do NOT push (user will test locally first)

## Testing Checklist (for user)

After rebuilding and reloading the extension:

1. Create a journal entry line with a Customer entity → sync → verify it succeeds (same as before)
2. Create a journal entry line with a Vendor entity → sync → verify it succeeds (previously would fail)
3. Create a journal entry line with an Employee entity → sync → verify it succeeds (previously would fail)
4. Create a journal entry with no entity on any line → sync → verify it succeeds (unchanged)
5. Check the QB journal entry in QuickBooks → verify the entity shows correctly with the right type
