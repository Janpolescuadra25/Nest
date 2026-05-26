# Phase 2B: Wire the Scan → Map → Preview Pipeline

## Context

The Nest Chrome extension has a **disconnected pipeline**. The scanner (Phase 2, commit b5cdbdf) produces real Toast POS data with keys like `Revenue.Net Sales`, `Payments.Amex.Total`, etc. MappingView (876 lines) lets users map these keys to QB accounts and saves mappings to the backend. JournalEntryPreview (639 lines) generates journal entry lines.

**The problem:** JournalEntryPreview IGNORES saved mappings entirely. It dumps ALL scan keys as journal lines using a `guessPostingType()` function that misclassifies keys. The mapping work the user did in MappingView is completely wasted.

Additionally, the Auto-Detect patterns and Template presets in MappingView use OLD mock-data field names ("Food Sales", "Credit Card Tips") that don't match the new scanner key format ("Sales Category.Food.Net Sales", "Tips.Credit/non-cash tips").

## What This Task Does

Wire the pipeline together so that:
1. MappingView's Auto-Detect and Templates work with the new scanner key format
2. JournalEntryPreview loads saved mappings and applies them to scan data
3. Unmapped keys appear as warning lines (not silently dropped)
4. The Sync button is disabled until all lines have accounts assigned

## ABSOLUTE RULES (violating any = instant reject)

1. **DO NOT touch `scanner.ts`** — it works, it's verified, leave it alone
2. **DO NOT touch `types/index.ts`** — `ScanData = Record<string, number>` stays the same
3. **DO NOT touch `manifest.json`** — no new permissions
4. **DO NOT touch any backend file** — the API routes and Prisma schema already support everything needed
5. **DO NOT add new dependencies** — use only what's already in `package.json`
6. **DO NOT change the MappingView component structure** — only update the `AUTO_DETECT` array and `applyTemplate()` function's field names
7. **DO NOT change the `SearchableSelect` component** — that's being fixed in a separate task
8. All existing functionality must continue to work exactly as before

## Task 1: Update AUTO_DETECT Patterns in MappingView.tsx

### Current Code (lines 71-83)
The `AUTO_DETECT` array uses patterns that match old mock-data keys like "Food Sales", "Credit Card Tips".

### New Code
Replace the entire `AUTO_DETECT` array with patterns that match the new `Section.Field` and `Section.Entity.Column` key format:

```typescript
const AUTO_DETECT: { patterns: RegExp; postingType: 'Debit' | 'Credit'; accountHint: string }[] = [
  // Revenue section
  { patterns: /Revenue\.Net Sales/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Revenue\.Gratuity/i, postingType: 'Credit', accountHint: 'Tips' },
  { patterns: /Revenue\./i, postingType: 'Credit', accountHint: 'Sales of Product' },

  // Net Sales section
  { patterns: /Net Sales\./i, postingType: 'Credit', accountHint: 'Sales of Product' },

  // Tips section
  { patterns: /Tips\./i, postingType: 'Credit', accountHint: 'Tips' },

  // Cash Activity section
  { patterns: /Cash Activity\.Cash tips/i, postingType: 'Debit', accountHint: 'Cash' },
  { patterns: /Cash Activity\.Credit/i, postingType: 'Credit', accountHint: 'Tips' },
  { patterns: /Cash Activity\./i, postingType: 'Debit', accountHint: 'Cash' },

  // Cash Summary section
  { patterns: /Cash Summary\./i, postingType: 'Debit', accountHint: 'Cash' },

  // Payments section — debit side (money coming IN)
  { patterns: /Payments\.Cash\./i, postingType: 'Debit', accountHint: 'Cash' },
  { patterns: /Payments\.(Credit|Amex|Discover|Mastercard|Visa)\./i, postingType: 'Debit', accountHint: 'Undeposited' },
  { patterns: /Payments\.Gift Card\./i, postingType: 'Debit', accountHint: 'Gift Card' },
  { patterns: /Payments\.House Account\./i, postingType: 'Debit', accountHint: 'Accounts Receivable' },
  { patterns: /Payments\.Other\./i, postingType: 'Debit', accountHint: 'Undeposited' },
  { patterns: /Payments\./i, postingType: 'Debit', accountHint: 'Undeposited' },

  // Sales Category section
  { patterns: /Sales Category\.Food/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Sales Category\.(Liquor|Beer|Wine|Beverage|Bar)/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Sales Category\.Merchandise/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Sales Category\./i, postingType: 'Credit', accountHint: 'Sales of Product' },

  // Tax section
  { patterns: /Tax\./i, postingType: 'Credit', accountHint: 'Sales Tax' },

  // Discount section — debit (contra-revenue)
  { patterns: /Discount\./i, postingType: 'Debit', accountHint: 'Discounts' },

  // Service Charge section
  { patterns: /Service Charge\./i, postingType: 'Credit', accountHint: 'Other Income' },

  // Void section
  { patterns: /Void\./i, postingType: 'Debit', accountHint: 'Discounts' },

  // Unpaid Orders section
  { patterns: /Unpaid Orders\./i, postingType: 'Debit', accountHint: 'Accounts Receivable' },

  // Revenue Center section
  { patterns: /Revenue Center\./i, postingType: 'Credit', accountHint: 'Sales of Product' },

  // Service Daypart section
  { patterns: /Service Daypart\./i, postingType: 'Credit', accountHint: 'Sales of Product' },

  // Dining Option section
  { patterns: /Dining Option\./i, postingType: 'Credit', accountHint: 'Sales of Product' },

  // Service Mode section
  { patterns: /Service Mode\./i, postingType: 'Credit', accountHint: 'Sales of Product' },

  // Deferred section
  { patterns: /Deferred\./i, postingType: 'Credit', accountHint: 'Deferred Revenue' },
];
```

**Key design decisions:**
- More specific patterns are listed FIRST (e.g., `Payments\.Cash\.` before `Payments\.`) — the `find()` in `autoDetect()` returns the first match
- Section prefix is used to determine posting type (Revenue = Credit, Payments = Debit, etc.)
- `accountHint` maps to QB account name fragments for auto-matching

## Task 2: Rewrite Template Presets in MappingView.tsx

### Current Code (lines 376-430)
The `applyTemplate()` function uses hardcoded old field names.

### New Code
Replace the templates object inside `applyTemplate()` with new key format:

```typescript
const templates: Record<string, { field: string; postingType: 'Debit' | 'Credit'; accountHint: string }[]> = {
  'Standard Daily': [
    { field: 'Revenue.Net sales', postingType: 'Credit', accountHint: 'Sales of Product' },
    { field: 'Revenue.Tax amount', postingType: 'Credit', accountHint: 'Sales Tax' },
    { field: 'Tips.Total tips', postingType: 'Credit', accountHint: 'Tips' },
    { field: 'Payments.Credit/debit.Total', postingType: 'Debit', accountHint: 'Undeposited' },
    { field: 'Payments.Cash.Total', postingType: 'Debit', accountHint: 'Cash' },
  ],
  'Full Service': [
    { field: 'Revenue.Net sales', postingType: 'Credit', accountHint: 'Sales of Product' },
    { field: 'Revenue.Gratuity', postingType: 'Credit', accountHint: 'Tips' },
    { field: 'Revenue.Tax amount', postingType: 'Credit', accountHint: 'Sales Tax' },
    { field: 'Tips.Credit/non-cash tips', postingType: 'Credit', accountHint: 'Tips' },
    { field: 'Tips.Cash tips', postingType: 'Credit', accountHint: 'Tips' },
    { field: 'Discount.Total discounts.Amount', postingType: 'Debit', accountHint: 'Discounts' },
    { field: 'Payments.Credit/debit.Total', postingType: 'Debit', accountHint: 'Undeposited' },
    { field: 'Payments.Cash.Total', postingType: 'Debit', accountHint: 'Cash' },
    { field: 'Payments.Gift Card.Total', postingType: 'Debit', accountHint: 'Gift Card' },
  ],
  'Quick Service': [
    { field: 'Revenue.Net sales', postingType: 'Credit', accountHint: 'Sales of Product' },
    { field: 'Revenue.Tax amount', postingType: 'Credit', accountHint: 'Sales Tax' },
    { field: 'Payments.Credit/debit.Total', postingType: 'Debit', accountHint: 'Undeposited' },
    { field: 'Payments.Cash.Total', postingType: 'Debit', accountHint: 'Cash' },
  ],
};
```

**Note:** The `field` values here are EXACT keys that the scanner produces. These must match what appears in `scanData` after a scan. The user should verify these against live scan output (Phase 2A debug logging helps here).

## Task 3: Wire JournalEntryPreview to Use Saved Mappings

This is the main task. Currently, `JournalEntryPreview` generates lines from raw `scanData` using `guessPostingType()`. It needs to:

1. Load saved mappings for the selected location from the backend
2. Apply mappings to scan data to generate proper journal lines
3. Show unmapped keys as warning lines

### Step 3a: Add Mapping Loading

Add state and a `useEffect` to load mappings when the component mounts or when `locId` changes:

```typescript
// Add these imports at the top:
import type { Mapping } from '../../types';

// Add inside the component, after existing state declarations:
const [savedMappings, setSavedMappings] = useState<Mapping[]>([]);
const [mappingsLoaded, setMappingsLoaded] = useState(false);

// Add this useEffect:
useEffect(() => {
  if (!jwt || !locId) return;
  api.getMappings(jwt, locId)
    .then((mappings) => {
      setSavedMappings(mappings);
      setMappingsLoaded(true);
    })
    .catch((err) => {
      console.error('[JE Preview] Failed to load mappings:', err);
      setMappingsLoaded(true); // still mark as loaded so we can show unmapped lines
    });
}, [jwt, locId]);
```

### Step 3b: Create a `decodeMapping` Helper

The `Mapping` type stores extra info in `targetMemo` as JSON. Add a helper to decode it:

```typescript
interface DecodedMapping {
  sourceField: string;
  accountId: string;
  postingType: 'Debit' | 'Credit';
  classId?: string;
  description?: string;
}

function decodeMapping(m: Mapping): DecodedMapping {
  let postingType: 'Debit' | 'Credit' = 'Credit';
  let classId: string | undefined;
  try {
    if (m.targetMemo) {
      const extra = JSON.parse(m.targetMemo) as {
        postingType?: string;
        classId?: string;
      };
      if (extra.postingType === 'Debit' || extra.postingType === 'Credit') {
        postingType = extra.postingType;
      }
      classId = extra.classId;
    }
  } catch { /* ignore */ }
  return {
    sourceField: m.sourceField,
    accountId: m.targetAccount,
    postingType,
    classId,
    description: m.targetDescription ?? undefined,
  };
}
```

### Step 3c: Replace the scanData → lines useEffect

Replace the existing `useEffect` that generates lines from `scanData` (currently around lines 143-156) with one that applies saved mappings.

**CRITICAL: Use a ref for `accounts` to prevent infinite re-render loops.** The `accounts` array comes from `useQBContext()` and gets a new reference every time `syncAllLists()` runs. Including it in the dependency array would cause: effect fires → `setLines()` → re-render → `syncAllLists` → new `accounts` ref → effect fires again → infinite loop.

```typescript
// Add this ref BEFORE the useEffect (near other refs/state):
const accountsRef = useRef(accounts);
accountsRef.current = accounts;

// Replace the existing scanData useEffect with this:
useEffect(() => {
  if (!scanData || !mappingsLoaded) return; // wait for mappings to load first

  const decoded = savedMappings.map(decodeMapping);

  const scanLines: LineItem[] = Object.entries(scanData)
    .filter(([, v]) => v !== 0)
    .map(([field, amount]) => {
      const mapping = decoded.find((m) => m.sourceField === field);
      const side = mapping?.postingType ?? guessPostingType(field);
      const accountName = mapping
        ? (accountsRef.current.find((a) => a.Id === mapping.accountId)?.FullyQualifiedName ?? '')
        : '';

      return newLine({
        description: mapping?.description ?? field,
        accountId: mapping?.accountId ?? '',
        accountName,
        classId: mapping?.classId ?? '',
        debit: side === 'debit' ? Math.abs(amount).toFixed(2) : '',
        credit: side === 'credit' ? Math.abs(amount).toFixed(2) : '',
      });
    });

  if (scanLines.length > 0) setLines(scanLines);
}, [scanData, savedMappings, mappingsLoaded]); // NOTE: NO `accounts` dependency — uses accountsRef instead
```

### Step 3d: Show Unmapped Warning in the Table

In the `TableRow` component, add a visual indicator for unmapped lines (lines with no account assigned):

**Replace** the existing account `<td>` in `TableRow` with this version (adds ⚠️ UNMAPPED badge when no account is assigned):

```typescript
{colVis.account && (
  <td className="px-1 py-1" style={{ minWidth: 160, maxWidth: 220 }}>
    <div className="relative">
      {!line.accountId && (
        <span className="absolute -top-3 left-0 text-[10px] bg-amber-900 text-amber-300 px-1 rounded z-10">
          ⚠️ UNMAPPED
        </span>
      )}
      <SearchableSelect
        options={accountOptions}
        value={line.accountId}
        onChange={(v) => {
          const acct = accounts.find((a) => a.Id === v);
          onChange({ accountId: v, accountName: acct?.FullyQualifiedName ?? '' });
        }}
        placeholder="Account…"
      />
    </div>
  </td>
)}
```

### Step 3e: Count Unmapped Lines and Show Summary

Add computed values after the `totalDebits`/`totalCredits` calculations:

```typescript
const unmappedCount = lines.filter((l) => !l.accountId).length;
const allMapped = unmappedCount === 0;
```

Update the Sync button's `disabled` condition:

```typescript
disabled={syncing || !isBalanced || !allMapped || lines.every((l) => !l.accountId)}
```

Update the Sync button text to show unmapped count:

```typescript
{syncing
  ? 'Syncing to QuickBooks…'
  : !isBalanced
    ? '⚠️ Journal Entry is Unbalanced'
    : !allMapped
      ? `⚠️ ${unmappedCount} unmapped line${unmappedCount !== 1 ? 's' : ''} — assign all accounts`
      : '⚡ Sync to QuickBooks'}
```

Add an unmapped summary bar AFTER the balance bar:

```tsx
{unmappedCount > 0 && (
  <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-amber-900/30 border border-amber-700 text-amber-300">
    <span>⚠️ {unmappedCount} unmapped line{unmappedCount !== 1 ? 's' : ''}</span>
    <span className="text-amber-500">— assign QB accounts before syncing</span>
  </div>
)}
```

### Step 3f: Improve `guessPostingType()` as Fallback

Update `guessPostingType()` to use section-prefix logic for better fallback guesses:

```typescript
function guessPostingType(field: string): 'debit' | 'credit' {
  const lower = field.toLowerCase();

  // Section-based logic (prefix before the first dot)
  const section = lower.split('.')[0]?.trim() ?? '';

  // Payment sections → debit (money coming IN)
  if (/^(payments|cash activity|cash summary)$/.test(section)) return 'debit';

  // Revenue/credit sections → credit (money earned)
  if (/^(revenue|net sales|tips|sales category|tax|service charge|revenue center|service daypart|dining option|service mode|deferred)$/.test(section)) return 'credit';

  // Contra/reduction sections → debit
  if (/^(discount|void)$/.test(section)) return 'debit';

  // Receivable sections → debit
  if (/^(unpaid orders)$/.test(section)) return 'debit';

  // Fallback: keyword matching
  if (/cash|credit card|debit card|gift card|discount|comp|net sales|total/.test(lower)) return 'debit';
  if (/sales|revenue|tax|tip|gratuity|fee|charge/.test(lower)) return 'credit';
  return 'debit';
}
```

This is a FALLBACK only — the primary posting type comes from saved mappings. But this makes the fallback much more accurate for the new key format.

## Expected Behavior After Changes

### MappingView
1. User clicks "🔍 Auto-Detect" → patterns match new `Section.Field` format → correct posting types and account hints
2. User clicks "📋 Standard Daily" → template uses new key names like `Revenue.Net Sales`, `Payments.Credit/debit.Total`
3. User saves mappings → stored in backend as before

### JournalEntryPreview
1. User scans page → `scanData` populated with 100+ keys
2. JournalEntryPreview loads saved mappings for this location
3. Mapped keys → journal lines with correct account, posting type, class, description
4. Unmapped keys → journal lines with ⚠️ UNMAPPED badge, guessed posting type, empty account
5. Balance bar shows Dr/Cr totals
6. Unmapped count shown if > 0
7. Sync button disabled until all lines have accounts AND entry is balanced
8. User can assign accounts to unmapped lines directly in the table
9. User clicks "⚡ Sync to QuickBooks" → journal entry created with all lines

## Files Modified

| File | Changes |
|------|---------|
| `Frontend/src/popup/components/MappingView.tsx` | Update `AUTO_DETECT` array, rewrite `applyTemplate()` templates |
| `Frontend/src/popup/components/JournalEntryPreview.tsx` | Add mapping loading, apply mappings to scan data, show unmapped warnings, improve `guessPostingType()`, update sync button logic |

**NO other files touched.**

## Verification

After making changes:

1. Run `npx tsc --noEmit` — must have zero errors
2. Run `npm run build` — must succeed
3. Commit with message: `feat: wire scan→map→preview pipeline, update auto-detect for new key format`
4. Do NOT push (user will test locally first)

## Testing Checklist (for user)

After rebuilding and reloading the extension:

1. Navigate to Toast Sales Summary page, click "Re-scan Page" in ScanView
2. Go to Mappings tab → click "🔍 Auto-Detect" → verify patterns match new keys
3. Click "📋 Standard Daily" → verify template fields match scanner output
4. Save a few mappings → verify they persist
5. Go to Preview tab → verify mapped keys have accounts assigned
6. Verify unmapped keys show ⚠️ UNMAPPED badge
7. Verify Sync button is disabled while unmapped lines exist
8. Assign accounts to unmapped lines → verify Sync button enables when all mapped + balanced
9. Click "⚡ Sync to QuickBooks" → verify journal entry is created
