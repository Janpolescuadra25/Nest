# Phase 2D: Accounting Accuracy Fixes — Negative Values + Rounding + guessPostingType

## Context

Phase 2C added line consolidation. The scan→map→preview→sync pipeline is fully wired. But Hydra's accounting audit found **two bugs that produce wrong numbers in QuickBooks**, plus one minor fallback issue.

### Bug #1: Negative Values Are Silently Flipped 🔴

**The problem:** In the scan→lines useEffect (JournalEntryPreview.tsx, lines 212-228), `Math.abs()` strips the sign from ALL values:

```typescript
debit: side === 'debit' ? Math.abs(amount).toFixed(2) : '',
credit: side === 'credit' ? Math.abs(amount).toFixed(2) : '',
```

Toast produces **negative values** for several fields:
- `Cash Activity.Credit/non-cash tips` = **-$1,234.00** (tips paid OUT to employees)
- `Discount.Item Discount` can be negative (discount refund)
- `Void.Voided amount` can be negative

When a mapped-as-Credit field has a **negative** value, `Math.abs()` turns it positive, so it becomes a Credit when it should be a Debit. **This creates wrong journal entries.**

**Example:** `Cash Activity.Credit/non-cash tips` = -$1,234.00
- Current: Mapped as Credit → `Math.abs(-1234)` = Credit $1,234.00 ❌ WRONG
- Correct: Negative Credit = Debit $1,234.00 ✅

### Bug #3: Rounding Can Cause $0.01 Imbalance 🟡

**The problem:** When consolidation merges many lines, each `.toFixed(2)` introduces rounding. 30 lines of $3.3333... each → 30 × $3.33 = $99.90, but the true total is $100.00. The $0.10 diff breaks the journal entry.

The backend validates `roundedDebits === roundedCredits` but doesn't **fix** the imbalance. A $0.01 diff between debits and credits will cause the entire sync to fail.

**Standard accounting practice:** Auto-balance by adding the rounding difference to the largest line on the short side.

### Issue #5: guessPostingType Has Wrong Mappings 🟢

**The problem:** `guessPostingType` is a fallback for unmapped fields. It has some incorrect mappings:

1. `Cash Activity` section is hardcoded as `'debit'` on line 77, but `Cash Activity.Credit/non-cash tips` should be a Credit (tips owed TO employees, not cash coming in)
2. The catch-all regex on line 82 matches `credit card|debit card` which could misfire on `Credit/non-cash tips`
3. `Tips` section is hardcoded as `'credit'` on line 78, but `Tips.Credit/non-cash tips paid out` should be a Debit

This is a **fallback only** — once the user maps keys, this function rarely fires. But when it does fire wrong, it produces incorrect posting types.

## What This Task Does

1. **Fix negative value handling** — when `amount < 0`, flip the posting side (Debit↔Credit) and use `Math.abs()` for the amount
2. **Add rounding auto-balance** — if `!isBalanced` and `Math.abs(diff) <= 0.02`, adjust the largest line on the short side by the diff
3. **Fix guessPostingType** — improve the section-specific logic for Cash Activity and Tips

## ABSOLUTE RULES (violating any = instant reject)

1. **DO NOT touch `scanner.ts`** — it works, leave it alone
2. **DO NOT touch `types/index.ts`** — types stay the same
3. **DO NOT touch `manifest.json`** — no new permissions
4. **DO NOT touch any backend file** — the backend already does its own rounding validation
5. **DO NOT add new dependencies** — use only what's already in `package.json`
6. **DO NOT change the `SearchableSelect` component**
7. **DO NOT touch `MappingView.tsx`** — only JournalEntryPreview.tsx changes
8. All existing functionality must continue to work exactly as before
9. The auto-balance must be **transparent** — show a note when it adjusts a line

## Task 1: Fix Negative Value Handling in scan→lines useEffect

### Current Code (lines 212-228)
```typescript
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
```

### New Code
Replace the `side` computation and the debit/credit assignment:

```typescript
      .map(([field, amount]) => {
        const mapping = decoded.find((m) => m.sourceField === field);
        const rawSide = mapping
          ? mapping.postingType.toLowerCase() as 'debit' | 'credit'
          : guessPostingType(field);
        // Negative amount flips the posting side: a negative Credit is a Debit, and vice versa
        const side = amount < 0
          ? (rawSide === 'debit' ? 'credit' : 'debit')
          : rawSide;
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
```

**Key change:** `side` is now computed from `rawSide` + sign flip. `Math.abs()` still ensures the amount is always positive — but it's now on the CORRECT side.

## Task 2: Add Rounding Auto-Balance

### Step 2a: No new state needed

The `autoBalanced` value is computed directly during render (see Step 2b). No `useState` needed — this avoids an extra render cycle.

### Step 2b: Add auto-balance logic AFTER `displayLines` computation and BEFORE `totalDebits`

Replace the current block (lines 321-329):

```typescript
  const displayLines = consolidate ? consolidateLines(lines) : lines;

  const totalDebits = displayLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredits = displayLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const diff = totalDebits - totalCredits;
  const isBalanced = Math.abs(diff) < 0.01;

  const unmappedCount = displayLines.filter((l) => !l.accountId).length;
  const allMapped = unmappedCount === 0;
```

With this:

```typescript
  // Auto-balance: if rounding caused a tiny imbalance (≤ $0.02), adjust the largest line
  const rawDisplayLines = consolidate ? consolidateLines(lines) : lines;
  const rawTotalDebits = rawDisplayLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const rawTotalCredits = rawDisplayLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const rawDiff = rawTotalDebits - rawTotalCredits;

  let displayLines = rawDisplayLines;
  let autoBalancedThisRender: { amount: number; lineId: string } | null = null;

  if (Math.abs(rawDiff) > 0.001 && Math.abs(rawDiff) <= 0.02) {
    // Find the largest line on the short side and adjust it
    const shortSide = rawDiff > 0 ? 'credit' : 'debit';
    const candidates = rawDisplayLines.filter((l) => {
      const val = parseFloat(shortSide === 'debit' ? l.debit : l.credit) || 0;
      return val > 0;
    });
    if (candidates.length > 0) {
      const largest = candidates.reduce((best, l) => {
        const val = parseFloat(shortSide === 'debit' ? l.debit : l.credit) || 0;
        const bestVal = parseFloat(shortSide === 'debit' ? best.debit : best.credit) || 0;
        return val > bestVal ? l : best;
      });
      const adjustment = Math.abs(rawDiff);
      displayLines = rawDisplayLines.map((l) => {
        if (l.localId !== largest.localId) return l;
        if (shortSide === 'debit') {
          const newVal = (parseFloat(l.debit) || 0) + adjustment;
          return { ...l, debit: newVal.toFixed(2) };
        } else {
          const newVal = (parseFloat(l.credit) || 0) + adjustment;
          return { ...l, credit: newVal.toFixed(2) };
        }
      });
      autoBalancedThisRender = { amount: adjustment, lineId: largest.localId };
    }
  }

  // Auto-balance info for UI display (computed directly, no extra render)
  const autoBalanced = autoBalancedThisRender;

  const totalDebits = displayLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredits = displayLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const diff = totalDebits - totalCredits;
  const isBalanced = Math.abs(diff) < 0.01;

  const unmappedCount = displayLines.filter((l) => !l.accountId).length;
  const allMapped = unmappedCount === 0;
```

### Step 2c: Show auto-balance warning in the UI

After the consolidation summary bar (around line 530), add:

```tsx
      {autoBalanced && (
        <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-yellow-900/20 border border-yellow-700 text-yellow-300">
          <span>⚖️ Auto-balanced ${autoBalanced.amount.toFixed(2)} rounding difference</span>
          <span className="text-yellow-500">— adjusted largest line to make debits = credits</span>
        </div>
      )}
```

## Task 3: Fix guessPostingType

### Current Code (lines 75-85)
```typescript
function guessPostingType(field: string): 'debit' | 'credit' {
  const section = field.toLowerCase().split('.')[0]?.trim() ?? '';
  if (/^(payments|cash activity|cash summary)$/.test(section)) return 'debit';
  if (/^(revenue|net sales|tips|sales category|tax|service charge|revenue center|service daypart|dining option|service mode|deferred)$/.test(section)) return 'credit';
  if (/^(discount|void)$/.test(section)) return 'debit';
  if (/^(unpaid orders)$/.test(section)) return 'debit';
  const lower = field.toLowerCase();
  if (/cash|credit card|debit card|gift card|discount|comp|net sales|total/.test(lower)) return 'debit';
  if (/sales|revenue|tax|tip|gratuity|fee|charge/.test(lower)) return 'credit';
  return 'debit';
}
```

### New Code
Replace the entire function:

```typescript
function guessPostingType(field: string): 'debit' | 'credit' {
  const section = field.toLowerCase().split('.')[0]?.trim() ?? '';
  const lower = field.toLowerCase();

  // Section-specific overrides (more specific = higher priority)

  // Cash Activity: most items are Debit (cash coming in), but tips paid out are Credit
  if (section === 'cash activity') {
    if (/credit.*tip|non-cash tip|tip.*paid/i.test(lower)) return 'credit';
    return 'debit';
  }

  // Tips: most items are Credit (tips received), but tips paid out are Debit
  if (section === 'tips') {
    if (/paid out|paid.*out|cash.*tip/i.test(lower)) return 'debit';
    return 'credit';
  }

  // Payments: always Debit (money coming IN to the restaurant)
  if (/^(payments|cash summary)$/.test(section)) return 'debit';

  // Revenue / Sales: always Credit
  if (/^(revenue|net sales|sales category|revenue center|service daypart|dining option|service mode|deferred)$/.test(section)) return 'credit';

  // Tax, Service Charge: Credit
  if (/^(tax|service charge)$/.test(section)) return 'credit';

  // Discount, Void: Debit (contra-revenue)
  if (/^(discount|void)$/.test(section)) return 'debit';

  // Unpaid Orders: Debit (Accounts Receivable)
  if (/^(unpaid orders)$/.test(section)) return 'debit';

  // Fallback: keyword matching on the full field name
  if (/cash|credit card|debit card|gift card|discount|comp|net sales|total/.test(lower)) return 'debit';
  if (/sales|revenue|tax|tip|gratuity|fee|charge/.test(lower)) return 'credit';

  return 'debit';
}
```

**Key changes:**
1. `Cash Activity` is no longer blanket `'debit'` — `Credit/non-cash tips` returns `'credit'`
2. `Tips` section gets special handling — `paid out` / `cash tip` returns `'debit'`
3. Section matching is more granular — each section is its own `if` block for clarity
4. The catch-all regex fallbacks remain unchanged

## Expected Behavior After Changes

### Negative Value Flip
1. `Cash Activity.Credit/non-cash tips` = -$1,234.00
   - Mapping says Credit → `rawSide = 'credit'`
   - `amount < 0` → flip → `side = 'debit'`
   - Result: Debit $1,234.00 ✅
2. `Revenue.Net Sales` = $30,000.00
   - Mapping says Credit → `rawSide = 'credit'`
   - `amount > 0` → no flip → `side = 'credit'`
   - Result: Credit $30,000.00 ✅
3. `Discount.Item Discount` = -$50.00
   - Mapping says Debit → `rawSide = 'debit'`
   - `amount < 0` → flip → `side = 'credit'`
   - Result: Credit $50.00 ✅ (negative discount = credit)

### Rounding Auto-Balance
1. 30 lines consolidated → totalDebits = $100.005, totalCredits = $100.000
2. `rawDiff = $0.005` → `Math.abs(rawDiff) <= 0.02` → auto-balance triggers
3. Short side = credits → find largest credit line → add $0.005
4. Result: totalDebits = $100.01, totalCredits = $100.01 ✅ Balanced
5. Yellow warning bar shows: "⚖️ Auto-balanced $0.01 rounding difference"

### guessPostingType
1. `Cash Activity.Credit/non-cash tips` → matches `/credit.*tip/` → returns `'credit'` ✅
2. `Cash Activity.Cash received` → no override → returns `'debit'` ✅
3. `Tips.Credit/non-cash tips paid out` → matches `/paid out/` → returns `'debit'` ✅
4. `Tips.Credit card tips` → no override → returns `'credit'` ✅

## Files Modified

| File | Changes |
|------|---------|
| `Frontend/src/popup/components/JournalEntryPreview.tsx` | Fix negative value flip in scan→lines useEffect; add rounding auto-balance with computed `autoBalanced` const and warning bar; fix `guessPostingType` section-specific logic |

**NO other files touched.**

## Verification

After making changes:

1. Run `npx tsc --noEmit` — must have zero errors
2. Run `npm run build` — must succeed
3. Commit with message: `fix: negative value flip, rounding auto-balance, and guessPostingType accuracy`
4. Do NOT push (user will test locally first)

## Testing Checklist (for user)

After rebuilding and reloading the extension:

1. Scan a Toast report that has negative values (e.g., `Cash Activity.Credit/non-cash tips`)
2. Go to Preview tab → verify the negative value appears on the CORRECT side (Debit, not Credit)
3. Map `Cash Activity.Credit/non-cash tips` as Credit → verify the negative amount flips to Debit
4. Toggle Consolidate ON → verify consolidation still works correctly with flipped lines
5. Create a scenario with rounding imbalance (many lines with 3-decimal amounts) → verify auto-balance triggers
6. Verify the yellow "⚖️ Auto-balanced" warning bar appears when auto-balance adjusts a line
7. Verify the balance bar shows "✅ Balanced" after auto-balance
8. Verify sync succeeds (no $0.01 rejection from QB)
9. Test `guessPostingType` by leaving some fields unmapped → verify Cash Activity tips default to Credit, not Debit
