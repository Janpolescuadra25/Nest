# Phase 2C: Line Consolidation — Merge Mapped Lines by Account

## Context

Phase 2B wired the scan→map→preview pipeline. JournalEntryPreview now loads saved mappings and applies them to scan data. Each scan key produces one journal line.

**The problem:** The scanner produces many keys that map to the **same QB account**. For example, the Payments section has separate rows for Amex, Discover, Mastercard, and Visa — all mapping to "Undeposited Funds". This creates 4 separate journal lines in QB when you really want 1 consolidated line.

This affects EVERY multi-row section:

| Section | Example | Current (4 lines) | Desired (1 line) |
|---------|---------|--------------------|--------------------|
| Payments | Amex/Discover/MC/Visa → Undeposited Funds | 4 separate Dr lines | 1 consolidated Dr line |
| Sales Category | Food + Wine → Sales of Product | 2 separate Cr lines | 1 consolidated Cr line |
| Tax | State Tax + Local Tax → Sales Tax Payable | 2 separate Cr lines | 1 consolidated Cr line |
| Discount | Item Discount + Order Discount → Discounts | 2 separate Dr lines | 1 consolidated Dr line |

**But not everything should consolidate.** Cash goes to a different account than Undeposited Funds. Gift Cards go to a liability account. The user needs per-mapping control.

## What This Task Does

1. Add a **"🔒 Keep separate"** checkbox per mapping in MappingView
2. Add a **"🔗 Consolidate"** toggle in JournalEntryPreview
3. When consolidation is ON, merge journal lines that share the same `accountId + postingType + classId` — EXCEPT lines marked "keep separate"
4. Show a consolidation summary (how many lines were merged)

## ABSOLUTE RULES (violating any = instant reject)

1. **DO NOT touch `scanner.ts`** — it works, leave it alone
2. **DO NOT touch `types/index.ts`** — `Mapping` and `ScanData` stay the same
3. **DO NOT touch `manifest.json`** — no new permissions
4. **DO NOT touch any backend file** — the `targetMemo` JSON field already supports storing extra flags
5. **DO NOT add new dependencies** — use only what's already in `package.json`
6. **DO NOT change the `SearchableSelect` component**
7. All existing functionality must continue to work exactly as before
8. Consolidation must be **opt-in** — default OFF, user toggles it ON

## Task 1: Add `keepSeparate` Flag to LocalMapping in MappingView.tsx

### Current Code (lines 9-23)
```typescript
interface LocalMapping {
  localId: string;
  remoteId?: string;
  sourceField: string;
  accountId: string;
  postingType: 'Debit' | 'Credit';
  description: string;
  classId: string;
  taxCodeId: string;
  entityType: '' | 'customer' | 'vendor' | 'employee';
  entityId: string;
  amountRule: string;
  isDirty: boolean;
  expanded: boolean;
}
```

### New Code
Add `keepSeparate: boolean` to the interface:

```typescript
interface LocalMapping {
  localId: string;
  remoteId?: string;
  sourceField: string;
  accountId: string;
  postingType: 'Debit' | 'Credit';
  description: string;
  classId: string;
  taxCodeId: string;
  entityType: '' | 'customer' | 'vendor' | 'employee';
  entityId: string;
  amountRule: string;
  keepSeparate: boolean;
  isDirty: boolean;
  expanded: boolean;
}
```

### Update `encodeToApi` (line 25-39)
Add `keepSeparate` to the JSON stored in `targetMemo`:

```typescript
function encodeToApi(m: LocalMapping, priority: number): Omit<Mapping, 'id' | 'locationId' | 'createdAt'> {
  return {
    sourceField: m.sourceField,
    targetAccount: m.accountId,
    targetClass: m.classId || undefined,
    targetDescription: m.description || undefined,
    targetMemo: JSON.stringify({
      postingType: m.postingType,
      amountRule: m.amountRule,
      keepSeparate: m.keepSeparate || undefined,
      taxCodeId: m.taxCodeId || undefined,
      entityType: m.entityType || undefined,
      entityId: m.entityId || undefined,
    }),
    priority,
  };
}
```

### Update `decodeFromApi` (lines 42-67)
Read `keepSeparate` from the parsed JSON:

```typescript
function decodeFromApi(m: Mapping): LocalMapping {
  let extra: {
    postingType?: string;
    amountRule?: string;
    keepSeparate?: boolean;
    taxCodeId?: string;
    entityType?: string;
    entityId?: string;
  } = {};
  try {
    if (m.targetMemo) extra = JSON.parse(m.targetMemo) as typeof extra;
  } catch { /* ignore */ }
  return {
    localId: m.id,
    remoteId: m.id,
    sourceField: m.sourceField,
    accountId: m.targetAccount,
    postingType: (extra.postingType as 'Debit' | 'Credit') ?? 'Credit',
    description: m.targetDescription ?? '',
    classId: m.targetClass ?? '',
    taxCodeId: extra.taxCodeId ?? '',
    entityType: (extra.entityType as LocalMapping['entityType']) ?? '',
    entityId: extra.entityId ?? '',
    amountRule: extra.amountRule ?? 'Direct Amount',
    keepSeparate: extra.keepSeparate ?? false,
    isDirty: false,
    expanded: false,
  };
}
```

### Update `autoDetect` function
Find the `autoDetect` function (search for `const autoDetect =`). In the `LocalMapping` objects it creates, add `keepSeparate: false`:

Add `keepSeparate: false,` after the `amountRule: 'Direct Amount',` line in the autoDetect function's return object.

### Update `applyTemplate` function (around line 442-463)
In the `newMappings` map inside `applyTemplate`, add `keepSeparate: false`:

Add `keepSeparate: false,` after the `amountRule: 'Direct Amount',` line in the applyTemplate function's return object.

### Add "🔒 Keep separate" checkbox in the mapping card UI

In the expanded section of the mapping card (around lines 839-910), add a checkbox row AFTER the "Entity + Amount Rule" grid (after line 898, before the Save button):

```tsx
          {/* Keep separate toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={m.keepSeparate}
              onChange={(e) => onUpdate({ keepSeparate: e.target.checked, isDirty: true })}
              className="rounded border-gray-600"
            />
            <span className="text-xs text-gray-400">🔒 Keep separate</span>
            <span className="text-xs text-gray-600">— don't merge with other lines</span>
          </label>
```

## Task 2: Add Consolidation Toggle and Logic in JournalEntryPreview.tsx

### Step 2a: Add `consolidate` state

After the existing state declarations (around line 154, after `mappingsLoaded`), add:

```typescript
const [consolidate, setConsolidate] = useState(false);
```

### Step 2b: Update `decodeMapping` helper (lines 97-124)

Add `keepSeparate` to the `DecodedMapping` interface and the decoder:

```typescript
interface DecodedMapping {
  sourceField: string;
  accountId: string;
  postingType: 'Debit' | 'Credit';
  classId?: string;
  description?: string;
  keepSeparate?: boolean;
}

function decodeMapping(m: Mapping): DecodedMapping {
  let postingType: 'Debit' | 'Credit' = 'Credit';
  let classId: string | undefined;
  let keepSeparate: boolean | undefined;
  try {
    if (m.targetMemo) {
      const extra = JSON.parse(m.targetMemo) as { postingType?: string; classId?: string; keepSeparate?: boolean };
      if (extra.postingType === 'Debit' || extra.postingType === 'Credit') {
        postingType = extra.postingType;
      }
      classId = extra.classId;
      keepSeparate = extra.keepSeparate;
    }
  } catch { /* ignore */ }
  return {
    sourceField: m.sourceField,
    accountId: m.targetAccount,
    postingType,
    classId,
    description: m.targetDescription ?? undefined,
    keepSeparate,
  };
}
```

### Step 2c: Add `keepSeparate` to LineItem interface (line 14-24)

Add `keepSeparate` field to the `LineItem` interface:

```typescript
interface LineItem {
  localId: string;
  accountId: string;
  accountName: string;
  entityVal: string; // "customer:ID" | "vendor:ID" | "employee:ID" | ""
  description: string;
  classId: string;
  taxCodeId: string;
  debit: string;
  credit: string;
  keepSeparate: boolean;
}
```

### Step 2d: Update `newLine` helper (lines 54-67)

Add `keepSeparate: false` to the defaults:

```typescript
function newLine(overrides?: Partial<LineItem>): LineItem {
  return {
    localId: `line-${Date.now()}-${Math.random()}`,
    accountId: '',
    accountName: '',
    entityVal: '',
    description: '',
    classId: '',
    taxCodeId: '',
    debit: '',
    credit: '',
    keepSeparate: false,
    ...overrides,
  };
}
```

### Step 2e: Update the scanData→lines useEffect (lines 200-223)

Pass `keepSeparate` from the decoded mapping into the new line:

```typescript
  // Build lines from scan data, applying saved mappings
  useEffect(() => {
    if (!scanData || !mappingsLoaded) return;
    const decoded = savedMappings.map(decodeMapping);
    const scanLines: LineItem[] = Object.entries(scanData)
      .filter(([, v]) => v !== 0)
      .map(([field, amount]) => {
        const mapping = decoded.find((m) => m.sourceField === field);
        const side = mapping
          ? mapping.postingType.toLowerCase() as 'debit' | 'credit'
          : guessPostingType(field);
        const accountName = mapping
          ? (accountsRef.current.find((a) => a.Id === mapping.accountId)?.FullyQualifiedName ?? '')
          : '';
        return newLine({
          description: mapping?.description ?? field,
          accountId: mapping?.accountId ?? '',
          accountName,
          classId: mapping?.classId ?? '',
          keepSeparate: mapping?.keepSeparate ?? false,
          debit: side === 'debit' ? Math.abs(amount).toFixed(2) : '',
          credit: side === 'credit' ? Math.abs(amount).toFixed(2) : '',
        });
      });
    if (scanLines.length > 0) setLines(scanLines);
  }, [scanData, savedMappings, mappingsLoaded]); // NOTE: no `accounts` dep — uses accountsRef
```

### Step 2f: Add consolidation function

Add this function AFTER the `removeLine` function (around line 273) and BEFORE the `totalDebits` calculation:

```typescript
  // Consolidate lines that share the same accountId + postingType + classId
  const consolidateLines = useCallback((rawLines: LineItem[]): LineItem[] => {
    const groups: Record<string, LineItem[]> = {};
    const separate: LineItem[] = [];

    rawLines.forEach((line) => {
      if (line.keepSeparate || !line.accountId) {
        separate.push(line);
        return;
      }
      const debitAmt = parseFloat(line.debit) || 0;
      const creditAmt = parseFloat(line.credit) || 0;
      const side = debitAmt > 0 ? 'debit' : 'credit';
      const key = `${line.accountId}|${side}|${line.classId}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(line);
    });

    const merged: LineItem[] = Object.values(groups).map((group) => {
      if (group.length === 1) return group[0];
      const totalDebit = group.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
      const totalCredit = group.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
      const descriptions = group.map((l) => l.description).filter(Boolean);
      return newLine({
        accountId: group[0].accountId,
        accountName: group[0].accountName,
        classId: group[0].classId,
        description: descriptions.length <= 3
          ? descriptions.join(' + ')
          : `${descriptions.slice(0, 3).join(' + ')} +${descriptions.length - 3} more`,
        keepSeparate: false,
        debit: totalDebit ? totalDebit.toFixed(2) : '',
        credit: totalCredit ? totalCredit.toFixed(2) : '',
      });
    });

    return [...separate, ...merged];
  }, []);
```

### Step 2g: Compute displayed lines

After the `consolidateLines` function and BEFORE the `totalDebits` calculation (around line 275), add:

```typescript
  const displayLines = consolidate ? consolidateLines(lines) : lines;
```

Then replace ALL subsequent references to `lines` in the render/JSX section with `displayLines`, EXCEPT:
- `setLines` calls (those still update the raw lines)
- The `handleSync` function (it should use `displayLines` so it syncs the consolidated version)
- The `updateLine` and `removeLine` functions (they still operate on raw `lines`)

Specifically, replace these in the JSX:
- `lines.map(...)` → `displayLines.map(...)` (in the table body, line ~498)
- `lines.length` → `displayLines.length` (in the footer, lines ~517, 522)
- `totalDebits` and `totalCredits` should use `displayLines` instead of `lines`:

```typescript
  const totalDebits = displayLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredits = displayLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
```

**IMPORTANT:** Move the `displayLines` computation BEFORE `totalDebits`/`totalCredits` since they depend on it. The order should be:

```typescript
  const displayLines = consolidate ? consolidateLines(lines) : lines;

  const totalDebits = displayLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredits = displayLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const diff = totalDebits - totalCredits;
  const isBalanced = Math.abs(diff) < 0.01;

  const unmappedCount = displayLines.filter((l) => !l.accountId).length;
  const allMapped = unmappedCount === 0;
```

### Step 2h: Update `handleSync` to use consolidated lines

In the `handleSync` function (around line 292-340), change `lines` to `displayLines`:

```typescript
  const handleSync = useCallback(async () => {
    if (!isBalanced) return;
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const jeLines = displayLines
        .filter((l) => parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0)
```

The rest of the function stays the same — just the first `lines` reference becomes `displayLines`.

**CRITICAL:** Add `displayLines` and `consolidate` to the `useCallback` dependency array for `handleSync`.

### Step 2i: Add Consolidate toggle in the UI

Add the toggle in the balance bar area (around line 420, inside the `<div className="flex items-center gap-3">` that contains the balance bar), AFTER the balance bar div and BEFORE the column toggle button:

```tsx
        <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none shrink-0">
          <input
            type="checkbox"
            checked={consolidate}
            onChange={(e) => setConsolidate(e.target.checked)}
            className="rounded border-gray-600"
          />
          <span className={consolidate ? 'text-cyan-400' : 'text-gray-500'}>
            🔗 Consolidate
          </span>
        </label>
```

### Step 2j: Show consolidation summary

After the unmapped warning bar (around line 464), add a consolidation summary:

```tsx
      {consolidate && displayLines.length < lines.length && (
        <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-cyan-900/20 border border-cyan-800 text-cyan-400">
          <span>🔗 Consolidated {lines.length} lines → {displayLines.length} lines</span>
          <span className="text-cyan-600">— {lines.length - displayLines.length} merged</span>
        </div>
      )}
```

### Step 2k: Update the "Add Line" button

The "Add Line" button (around line 547) should add a line with `keepSeparate: false` — this already works because `newLine()` defaults `keepSeparate` to `false`.

## Expected Behavior After Changes

### MappingView
1. User expands a mapping card → sees "🔒 Keep separate" checkbox
2. Check it for lines that must stay separate (e.g., Cash, Gift Card)
3. Leave unchecked for lines that can be consolidated (e.g., Amex, Visa, MC, Discover)
4. Save mapping → `keepSeparate` stored in `targetMemo` JSON
5. Existing mappings without `keepSeparate` default to `false` (consolidatable)

### JournalEntryPreview
1. Lines load as before — one per scan key
2. User clicks "🔗 Consolidate" toggle → lines with same account+side+class merge
3. Lines marked "🔒 Keep separate" stay as individual lines
4. Consolidation summary shows "Consolidated 30 lines → 12 lines — 18 merged"
5. Balance bar shows totals from consolidated lines
6. Sync sends consolidated lines to QB — cleaner journal entry
7. Toggle off → back to individual lines

## Files Modified

| File | Changes |
|------|---------|
| `Frontend/src/popup/components/MappingView.tsx` | Add `keepSeparate` to `LocalMapping`, `encodeToApi`, `decodeFromApi`, `autoDetect`, `applyTemplate`, and mapping card UI |
| `Frontend/src/popup/components/JournalEntryPreview.tsx` | Add `keepSeparate` to `LineItem`, `DecodedMapping`, `newLine`; add `consolidate` state, `consolidateLines` function, `displayLines` computation; update `handleSync`; add toggle UI and summary bar |

**NO other files touched.**

## Verification

After making changes:

1. Run `npx tsc --noEmit` — must have zero errors
2. Run `npm run build` — must succeed
3. Commit with message: `feat: add line consolidation toggle and keep-separate per mapping`
4. Do NOT push (user will test locally first)

## Testing Checklist (for user)

After rebuilding and reloading the extension:

1. Go to Mappings tab → expand a mapping → verify "🔒 Keep separate" checkbox appears
2. Check "Keep separate" for Cash and Gift Card mappings → save
3. Leave "Keep separate" unchecked for Amex, Discover, MC, Visa
4. Go to Preview tab → verify all lines appear individually (consolidate OFF)
5. Click "🔗 Consolidate" toggle → verify credit card lines merge into one Undeposited Funds line
6. Verify Cash and Gift Card lines stay separate (they have 🔒)
7. Verify consolidation summary shows correct count
8. Verify balance bar totals are the same (consolidation doesn't change totals)
9. Click "⚡ Sync to QuickBooks" → verify QB receives consolidated journal entry
10. Toggle consolidation OFF → verify lines go back to individual
