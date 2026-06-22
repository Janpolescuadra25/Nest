# Nest — End-to-End Perfection Roadmap

**Version 1.0 | June 2026**
**Goal:** Make Nest the most accurate, accountant-trusted POS-to-QuickBooks automation tool — from the smallest input field to the entire sync pipeline.

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Critical Security Fixes (Phase S)](#2-critical-security-fixes-phase-s)
3. [Accountant-Grade Mapping Quality (Phase A)](#3-accountant-grade-mapping-quality-phase-a)
4. [AI Suggestion Perfection (Phase B)](#4-ai-suggestion-perfection-phase-b)
5. [Preview Form Accuracy (Phase C)](#5-preview-form-accuracy-phase-c)
6. [Multi-Type Sync Completion (Phase D)](#6-multi-type-sync-completion-phase-d)
7. [Template Defaults Completion (Phase E)](#7-template-defaults-completion-phase-e)
8. [Onboarding & Registration Flow (Phase F)](#8-onboarding--registration-flow-phase-f)
9. [Pricing & Cost Sustainability (Phase G)](#9-pricing--cost-sustainability-phase-g)
10. [Test Coverage & Confidence (Phase H)](#10-test-coverage--confidence-phase-h)
11. [Polish & Production Readiness (Phase I)](#11-polish--production-readiness-phase-i)
12. [Execution Order & Dependencies](#12-execution-order--dependencies)

---

## 1. Current State Assessment

### What's Already Excellent

| Area | Status | Details |
|------|--------|---------|
| Architecture | ✅ Solid | Chrome Extension (MV3) + Express + Prisma + PostgreSQL + QB OAuth 2.0 |
| Transaction Types | ✅ 5 types | JE, Bill, Vendor Credit, Cheque, Bill Payment — all functional |
| Scan Modes | ✅ 3 modes | POS (Toast/Oracle/SALIDO), Excel, Image (Gemini 2.5 Flash) |
| Dedup System | ✅ Working | SHA-256 request hash, already_synced detection, 409 → force-sync override |
| Retry System | ✅ Working | Type-aware `retrySyncFromLog`, 3-attempt limit, batch retry |
| RBAC | ✅ Comprehensive | 19 features × read/write/execute, 5 roles, Owner-set overrides |
| Billing | ✅ Functional | 4 Stripe plans, team management, capacity enforcement |
| Templates | ✅ Good | Scan mode + transaction type isolation, compatibility matrix |
| Product Matching | ✅ Good | EXACT, CONTAINS, STARTS_WITH, FUZZY, REGEX rules engine |
| Token Security | ✅ Encrypted | AES-256-GCM for QB OAuth tokens |
| Audit Logging | ✅ Present | User management actions tracked |

### What's Broken or Missing

| Area | Severity | Details |
|------|----------|---------|
| **CRITICAL: QB_SECRET in render.yaml** | 🔴 | `QB_CLIENT_SECRET` hardcoded in plain text |
| Sync batch is JE-only | 🟡 | `/sync-batch` only handles Journal Entries |
| Template defaults incomplete | 🟡 | Cheque defaults hidden, VC vendor not SearchableSelect |
| No pre-sync accounting validation | 🟡 | No warnings for unbalanced JE, mismatched totals |
| AI account matching too loose | 🟡 | `includes()` fuzzy match can match wrong accounts |
| No AI confidence indicator | 🟠 | Users can't tell if a suggestion is high/low confidence |
| No guided onboarding | 🟠 | New users land on Scan tab with no wizard |
| Test coverage < 10% | 🟠 | Only 8 test files, no sync/dedup/gemini/validator tests |
| Render free tier cold starts | 🟠 | 15-30 second spin-up hurts UX |
| No per-plan AI usage limits | 🟠 | Heavy users could inflate Gemini costs |
| ScanView console.log decision | 🟢 | 5 logs, NODE_ENV-guarded — low priority |
| No empty states with CTAs | 🟢 | Tabs show nothing when no data |

---

## 2. Critical Security Fixes (Phase S)

**Priority:** 🔴 BLOCKING — Do this before anything else.
**Estimated effort:** 30 minutes.

### S.1 — Move QB secrets to Render dashboard

**Problem:** `render.yaml` exposes `QB_CLIENT_ID` and `QB_CLIENT_SECRET` in plain text. Anyone with repo access has your Intuit OAuth credentials.

**Fix:**
```yaml
# render.yaml — change these:
- key: QB_CLIENT_ID
  sync: false          # was: value: "ABnJGWv9uA34..."
- key: QB_CLIENT_SECRET
  sync: false          # was: value: "XmvpXiOAm5Hb..."
```
Then set both values manually in the Render dashboard under Environment.

**Also:** Rotate the QB Client Secret in the Intuit Developer portal since it's been in git history.

### S.2 — Audit .env.example completeness

The `.env.example` is missing several required variables:
- `ENCRYPTION_KEY` (required for token encryption)
- `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REDIRECT_URI`
- `RESEND_API_KEY`
- `PORT`

Add all missing variables with placeholder values and comments.

---

## 3. Accountant-Grade Mapping Quality (Phase A)

**Priority:** 🟡 High — This is the core value proposition.
**Estimated effort:** 3-4 days.
**Goal:** Every mapping decision should feel like a CPA is looking over your shoulder.

### A.1 — Account Type Validation in Mappings

**Problem:** Users can map a revenue field (e.g., "Net Sales") as a Debit to an Income account. The AI suggests correct posting types, but users can override with zero warnings.

**Fix — Add validation warnings in `MappingView`:**
- When user selects an account, check its `AccountType` / `Classification`
- If posting type conflicts with account type, show a yellow warning badge:
  - Income/Revenue account + Debit → ⚠️ "Revenue accounts are normally credited"
  - Asset account + Credit → ⚠️ "Asset accounts are normally debited"
  - Expense account + Credit → ⚠️ "Expense accounts are normally debited"
  - Liability account + Debit → ⚠️ "Liability accounts are normally credited"
- Don't block — just warn. Some mappings are intentionally contra.

**Where:** `MappingView/MappingTable.tsx` — add a `validatePostingType()` function.

### A.2 — Redundancy Detection in Field Mappings

**Problem:** Two POS fields can be mapped to the same account with the same posting type without any warning. This could be intentional (e.g., two payment methods → Cash account) or a mistake.

**Fix — Add a "Potential duplicate" indicator:**
- When two mappings share the same `targetAccount` + `postingType`, show a ℹ️ badge
- Tooltip: "Also mapped: {other field name}. Consolidate if these represent the same data."
- Don't block — this is informational for the accountant.

### A.3 — Mapping Completeness Indicator

**Problem:** There's no indicator showing how many scan fields are mapped vs. unmapped.

**Fix — Add a progress bar in MappingView header:**
```
Mapping Coverage: ████████░░ 24/28 fields mapped (4 unmapped)
```
- Green when 100%
- Yellow when 75-99%
- Red when < 75%

### A.4 — Required Field Highlighting

**Problem:** All scan fields look the same. Accountants can't tell which fields are critical (must be mapped) vs. optional.

**Fix — Mark critical fields with a red asterisk:**
- For POS/JE: All "Revenue.*", "Payments.*", "Tax.*" fields
- For Bill: vendor, invoiceNumber, total, lineItems
- For Check: payeeName, amount, chequeNumber

### A.5 — Balance Preview in Mapping View

**Problem:** The mapping view doesn't show a live debit/credit balance. Accountants need to verify the entry will balance before they sync.

**Fix — Add a "Projected Balance" widget:**
- Sum all Debit mappings + sum all Credit mappings
- Show: `Total Debits: $1,234.56 | Total Credits: $1,234.56 | ✅ Balanced`
- If unbalanced: `⚠️ Unbalanced by $12.34`
- This is a projection — actual amounts come from scan data.

---

## 4. AI Suggestion Perfection (Phase B)

**Priority:** 🟡 High — AI is Nest's differentiator.
**Estimated effort:** 2-3 days.

### B.1 — Fix Loose Account Matching

**Problem:** In `mappings.ts` line ~100, the AI account matching uses:
```typescript
account.FullyQualifiedName.toLowerCase().includes(suggestion.accountHint.toLowerCase())
```
This is dangerous — if the AI suggests hint "Cash", it matches "Cash", "Petty Cash", "Cash Management", and potentially wrong accounts.

**Fix — Use tiered matching with priority:**
1. **Exact match** (case-insensitive): `FullyQualifiedName === accountName`
2. **Exact hint match**: `FullyQualifiedName === accountHint`
3. **Starts with**: `FullyQualifiedName.startsWith(accountName)`
4. **No match found**: Set `accountId = null`, show hint text only — let user pick.

Never use `includes()` — it's too permissive.

### B.2 — Add Confidence Indicators to Suggestions

**Problem:** The AI returns a `reason` string but no confidence score. Users can't tell if a suggestion is 95% certain or 50% guess.

**Fix — Extend the Gemini schema:**
Add `confidence` field to `mappingSuggestionSchema`:
```
confidence: { type: SchemaType.NUMBER, description: 'Confidence 0-1. 1=exact account match available, 0.5=inferred' }
```

**Frontend display:**
- 🟢 Green dot: confidence ≥ 0.8
- 🟡 Yellow dot: confidence 0.5-0.79
- 🔴 Red dot: confidence < 0.5
- Show reason text on hover.

### B.3 — Batch Accept/Reject UI

**Problem:** Users must accept suggestions one by one. Accountants reviewing 20+ fields want to accept all high-confidence ones and individually review the rest.

**Fix — Add to the AI suggestions panel:**
- "Accept All (green only)" button — accepts only confidence ≥ 0.8
- "Accept All" button — accepts all suggestions
- Per-suggestion checkbox + "Accept Selected" button
- "Dismiss" button per suggestion (clears it without applying)

### B.4 — Negative Preference Learning

**Problem:** `MappingPreference` only tracks accepts. If the AI keeps suggesting the wrong account for a field, it never learns to stop.

**Fix — Add a `MappingRejection` model (or add `timesRejected` to MappingPreference):**
- When user changes an AI-suggested mapping to a different account, increment rejection count
- When building the preference context for Gemini, include: "Previously rejected: {field} → {account} (rejected {n} times)"
- This teaches the AI to avoid previously rejected pairings.

### B.5 — Improve Gemini Prompt with Account Type Context

**Current state:** ✅ Already good — the prompt sends account types and includes accounting rules.

**Improvement — Add transaction-type-specific rules:**
```
TRANSACTION TYPE CONTEXT:
- For JOURNAL_ENTRY (POS): Each field is an aggregated POS total. Map to income/asset/liability accounts.
- For BILL: Line items are expenses. Map to expense/COGS accounts. All lines post as Credit (AP increases).
- For VENDOR_CREDIT: Line items are expense reductions. Map to expense/COGS accounts. All lines post as Debit.
- For CHEQUE: Line items are expenses paid from bank. Map to expense/COGS accounts. All lines post as Debit.
```

This prevents the AI from suggesting Income accounts for Bill line items.

### B.6 — AI Usage Rate Limiting Per Plan

**Problem:** No per-user AI usage limits. A user on the Solo plan could make 10,000 Gemini calls/day, costing you money.

**Fix — Add rate limiting:**
- Track AI calls per user per day in a `AiUsage` table or Redis counter
- Solo: 50 AI calls/day
- Starter: 200/day
- Growth: 1,000/day
- Enterprise: 5,000/day
- Show usage in Settings: "AI scans used: 23/50 today"

---

## 5. Preview Form Accuracy (Phase C)

**Priority:** 🟡 High — Previews must mirror QuickBooks exactly.
**Estimated effort:** 2-3 days.

### C.1 — Pre-Sync Validation Warnings

**Problem:** No validation happens before the user clicks Sync. Errors only surface as 500s from the backend.

**Fix — Add a `validateBeforeSync()` function to each preview form:**

| Check | Form | Warning Type |
|-------|------|-------------|
| Sum of line amounts ≠ Bill total | Bill | ⚠️ Yellow |
| Sum of line amounts ≠ Check amount | Check | ⚠️ Yellow |
| Sum of debits ≠ sum of credits | JE | 🔴 Block (QB will reject) |
| No due date set | Bill | ℹ️ Info |
| Bill payment exceeds outstanding balance | Bill Payment | 🔴 Block |
| Duplicate line items (same account + class) | All | ℹ️ Info |
| No vendor selected | Bill/VC/Payment | 🔴 Block |
| No AP account set | Bill/VC | 🔴 Block |
| No bank account set | Check/Payment | 🔴 Block |

- 🔴 Block: Disable Sync button, show error message
- ⚠️ Yellow: Show warning, allow sync with confirmation
- ℹ️ Info: Show info badge, allow sync

### C.2 — JE Balance Indicator (Live)

**Problem:** JE balance is only checked at sync time in `buildJournalEntryPayload()`. The user doesn't know it's unbalanced until they hit Sync and get a 500 error.

**Fix — Add a live balance display in `JournalEntryPreview.tsx`:**
```
Debits: $1,234.56  |  Credits: $1,234.56  |  ✅ Balanced
```
- Update on every line change
- If unbalanced by ≤ $0.02, show auto-balance button
- If unbalanced by > $0.02, disable Sync button

### C.3 — Line Item Total Calculation Display

**Problem:** Bill/Check/VC forms show line item amounts but no running total.

**Fix — Add a "Total" row at the bottom of line items table:**
```
┌─────────────────────────────────────────────┐
│ Account    │ Description  │ Amount          │
│────────────┼──────────────┼─────────────────│
│ COGS       │ Food items   │ $500.00         │
│ Rent Exp   │ Store lease  │ $200.00         │
│────────────┼──────────────┼─────────────────│
│                              Total: $700.00 │
└─────────────────────────────────────────────┘
```
- For Bill: Compare total against the scanned invoice total
- For Check: Compare total against check amount
- Show ✅ if match, ⚠️ if mismatch

### C.4 — QuickBooks Layout Parity Audit

**Current state:** Forms were redesigned to mirror QuickBooks (commit `e662d2c`). Verify:

| QB Field | Nest Form | Status |
|----------|-----------|--------|
| Bill: Vendor | Bill: Vendor (SearchableSelect) | ✅ |
| Bill: AP Account | Bill: AP Account (disabled) | ✅ |
| Bill: Terms | Bill: Terms (dropdown/input) | ✅ |
| Bill: Due Date | Bill: Due Date (date picker) | ✅ |
| Bill: Memo | Bill: Memo (textarea) | ✅ |
| Bill: Bill No. | Bill: Doc Number | ✅ |
| Bill: Line Items (Account, Desc, Class, TaxCode, Amount) | ✅ | ✅ |
| Check: Bank Account | Check: Bank Account (filtered, disabled) | ✅ |
| Check: Payee | Check: Payee (SearchableSelect) | ✅ |
| Check: Amount | Check: Amount | ✅ |
| Check: Line Items (Account, Desc, Class, Amount — no TaxCode) | ✅ | ✅ |
| VC: Vendor | VC: Vendor (SearchableSelect) | ✅ |
| VC: AP Account | VC: AP Account (disabled) | ✅ |
| VC: Line Items (Account, Desc, Class, TaxCode, Amount) | ✅ | ✅ |
| JE: Date | JE: Date | ✅ |
| JE: Doc Number | JE: Doc Number | ✅ |
| JE: Private Note | JE: Private Note | ✅ |
| JE: Line Items (Account, Name, Desc, Class, TaxCode, Debit, Credit) | ✅ | ✅ |
| JE: Adjusting Entry checkbox | ✅ | ✅ |
| JE: Consolidation toggle | ✅ | ✅ |
| Bill Payment: Vendor | ✅ | ✅ |
| Bill Payment: PayType (Cash/Check/CC) | ✅ | ✅ |
| Bill Payment: Outstanding Bills table | ✅ | ✅ |
| Bill Payment: Vendor Credits table | ✅ | ✅ |
| Bill Payment: Bank Account (conditional) | ✅ | ✅ |
| Bill Payment: Check # (conditional) | ✅ | ✅ |

**Verdict:** Layout parity is strong. Focus should be on the *validation* layer (C.1-C.3), not layout changes.

### C.5 — SearchableSelect for Vendor Credit Vendor Field

**Problem:** Vendor Credit form may use a plain `<select>` for vendor instead of `SearchableSelect`. With 500+ vendors, this is unusable.

**Fix:** Ensure all vendor/payee/account fields use `SearchableSelect` with fuzzy search across all forms.

---

## 6. Multi-Type Sync Completion (Phase D)

**Priority:** 🟡 High — "Sync All Pending" only works for JE.
**Estimated effort:** 2-3 days.

### D.1 — Backend Multi-Type Batch Sync

**Problem:** `POST /sync-batch` only accepts JE payloads (`txnDate`, `lines`, `privateNote`). It calls `syncSingleScan()` for every item regardless of transaction type.

**Fix — Rewrite `/sync-batch` to dispatch by `transactionType`:**

```typescript
// Each batch item includes transactionType
items: Array<{
  scanRecordId: string;
  transactionType: 'JOURNAL_ENTRY' | 'BILL' | 'VENDOR_CREDIT' | 'CHEQUE';
  txnDate: string;
  // JE fields
  lines?: QBJournalLineItem[];
  privateNote?: string;
  // Bill/VC fields
  vendorRef?: { value: string; name?: string };
  apAccountRef?: { value: string; name?: string };
  // Bill-only
  termsRef?: { value: string; name?: string };
  dueDate?: string;
  // Check fields
  bankAccountRef?: { value: string; name?: string };
  payeeRef?: { value: string; name?: string };
  amount?: number;
  // Common
  memo?: string;
  docNumber?: string;
}>
```

Dispatch to the correct `syncSingle*` function based on `transactionType`.

### D.2 — Frontend SyncView Multi-Type Support

**Problem:** SyncView filters to JE-only scans for batch sync and shows a toast for non-JE scans.

**Fix — Update `SyncView.tsx`:**
- Remove the JE-only filter
- Build type-aware payloads based on `scanRecord.transactionType`
- For non-JE types, read the stored `rawScanEntry` to reconstruct the sync payload
- Or better: store the last sync payload on the scan record for retry/batch purposes

### D.3 — Bill Payment Batch (Future)

**Problem:** Bill payments require interactive bill selection, so they can't be batched the same way.

**Decision:** Bill payments remain manual-only (from BillPaymentView). This is correct — payments require accountant decision-making about which bills to pay.

---

## 7. Template Defaults Completion (Phase E)

**Priority:** 🟡 High — From the Cypra roadmap, this is "the real blocker."
**Estimated effort:** 1-2 days.

### E.1 — Bill Template `apAccountRef` Default

**Problem:** The Bill form's AP Account field is disabled (locked). If the template doesn't provide a default, the field is empty and the user can't set it.

**Fix:**
1. Ensure `templateDefaults` section is visible for BILL and VENDOR_CREDIT (✅ already in `isSectionVisible`)
2. When a template has `defaults.apAccountRef`, auto-populate the AP Account field on form load
3. If no default is set, show a warning: "No AP Account default set in template. Set one in the Mapping tab."
4. Consider allowing the AP Account to be editable if no template default exists (fallback)

### E.2 — Cheque Template Defaults

**Problem:** `isSectionVisible('templateDefaults', ...)` returns `false` for CHEQUE transaction type. Cheque templates can't have defaults.

**Fix:** Add `'CHEQUE'` to the allowed list:
```typescript
case 'templateDefaults':
  return ['BILL', 'VENDOR_CREDIT', 'CHEQUE'].includes(transactionType || '');
```

Cheque template defaults should include:
- `bankAccountRef` (default bank account)
- `payeeRef` (optional, if usually the same payee)
- `docNumber` (starting check number pattern)

### E.3 — Vendor Credit SearchableSelect for Vendor

**Problem:** If the VC form uses a plain `<select>` for the vendor field, it's unusable with many vendors.

**Fix:** Ensure `SearchableSelect` is used for vendor selection in `VendorCreditPreviewForm.tsx`, same as `BillPreviewForm.tsx`.

### E.4 — Template Default Persistence on Save

**Problem:** Need to verify that when a user sets defaults in the TemplateDefaultsSection, they're actually saved to the template's `defaults` JSON column and loaded on next use.

**Fix — Audit the save/load flow:**
1. User edits defaults in MappingView → TemplateDefaultsSection
2. On "Save Template", the `defaults` JSON is sent to `PUT /api/templates/:id`
3. On form load, `selectedTemplate.defaults` is read to pre-populate fields
4. Verify this round-trip works for all default types (vendorRef, apAccountRef, termsRef, etc.)

---

## 8. Onboarding & Registration Flow (Phase F)

**Priority:** 🟠 Medium — First impressions matter.
**Estimated effort:** 2-3 days.

### F.1 — Guided Onboarding Wizard

**Problem:** New users land on the Scan tab with no guidance. They don't know the pipeline: Scan → Map → Preview → Sync.

**Fix — Add a 4-step onboarding wizard for first-time users:**
```
Step 1: "Create your first Location"
  → Name, POS URL (if POS mode)

Step 2: "Connect QuickBooks"
  → OAuth redirect
  → Sync QB lists (accounts, vendors, classes)

Step 3: "Create a Template"
  → Choose scan mode (POS/Excel/Image)
  → Choose transaction type
  → Set defaults (vendor, AP account)

Step 4: "Ready to Scan!"
  → "Click the Scan tab to scan your first document"
```

- Show only when user has 0 locations and 0 templates
- "Skip onboarding" link for experienced users
- Progress persisted in localStorage

### F.2 — Invite Link Registration Page

**Problem:** The `InviteLink` model exists with tokens, but the frontend registration flow for invite links may be incomplete.

**Fix — Add a `/register?invite={token}` route handling:**
1. When user opens the extension with an invite link, pre-fill their email
2. Call `POST /api/invite/use` with the token to validate and get role hint
3. On registration, set the user's role to the invite's `roleHint`
4. Link the new user to the inviter's team (`adminId` = inviter's ID)

### F.3 — Empty States with CTAs

**Problem:** When there's no data (no scans, no mappings, no syncs), tabs show blank content.

**Fix — Add empty state components for each tab:**

| Tab | Empty State |
|-----|------------|
| Scan | "No scans yet. Navigate to a Toast POS page and click Scan, or upload an invoice image." |
| Mapping | "No mappings yet. Select a template and add mappings, or use AI Suggest." |
| Preview | "No scan data to preview. Scan a document first." |
| Sync | "No sync history. Sync a transaction to see it here." |
| Settings → Locations | "No locations yet. Create your first location to get started." |

### F.4 — Pipeline Progress Indicator Enhancement

**Problem:** The pipeline indicator (Scan → Map → Rules → Preview → Sync) exists but may not show completion state clearly.

**Fix — Add visual states:**
- ✅ Green checkmark when each step is complete (has data)
- 🔵 Blue dot for the current step
- ⚪ Gray circle for upcoming steps
- Clicking a completed step navigates to it

---

## 9. Pricing & Cost Sustainability (Phase G)

**Priority:** 🟠 Medium — Must not lose money per user.
**Estimated effort:** 1 day analysis + implementation.

### G.1 — Cost Analysis

**Current costs per month:**

| Resource | Free Tier | Actual Cost |
|----------|-----------|-------------|
| Render (free) | $0 | 15-30s cold starts |
| Render (Starter) | $7/mo | No cold starts |
| Gemini 2.5 Flash | ~$0.075/1M input, ~$0.30/1M output | ~$0.0003 per scan |
| Stripe fees | 2.9% + $0.30 per transaction | $0.56 on $9 plan |
| PostgreSQL (Render free) | 90 days then $7/mo | Must upgrade eventually |

**Per-user cost estimate (monthly):**
| Plan | Revenue | Stripe Fee | Gemini (est.) | Render Share | Net |
|------|---------|------------|---------------|-------------|-----|
| Solo ($9) | $9.00 | -$0.56 | -$0.50 | -$1.00 | **$6.94** |
| Starter ($35) | $35.00 | -$1.32 | -$2.00 | -$1.00 | **$30.68** |
| Growth ($107) | $107.00 | -$3.40 | -$10.00 | -$1.50 | **$92.10** |
| Enterprise ($178) | $178.00 | -$5.45 | -$25.00 | -$2.00 | **$145.55** |

**Verdict:** Pricing is sustainable. Even Solo plan is profitable if AI usage stays reasonable.

### G.2 — Upgrade Render to Starter Tier

**Problem:** Render free tier causes 15-30 second cold starts. Accountants using the tool daily will find this unacceptable.

**Fix — Upgrade `render.yaml`:**
```yaml
plan: starter  # was: free — $7/month, no cold starts
```

This is the single highest-ROI investment. $7/month for production-quality uptime.

### G.3 — Add AI Usage Limits Per Plan

(See B.6 above — this is both a quality and cost measure.)

### G.4 — Consider Annual Pricing Discount

**Fix — Add annual billing option:**
- Solo: $90/year (save $18, ~17% off)
- Starter: $350/year (save $70)
- Growth: $1,070/year (save $214)
- Enterprise: $1,780/year (save $356)

This improves cash flow and reduces churn.

### G.5 — Pricing Page in Frontend

**Problem:** No visible pricing page. Users can't compare plans without going through checkout.

**Fix — Add a pricing/upgrade view in the extension:**
- 4 plan cards with features comparison
- "Current Plan" badge on active plan
- "Upgrade" button → Stripe checkout
- "Manage Subscription" → Stripe portal

---

## 10. Test Coverage & Confidence (Phase H)

**Priority:** 🟠 Medium — Must prove reliability.
**Estimated effort:** 3-4 days.

### H.1 — Backend Test Priorities

| Test File | What to Test | Priority |
|-----------|-------------|----------|
| `dedup.test.ts` | `hashSyncRequest`, `findDuplicateSync`, `countSyncAttempts`, `createSyncLogEntry` | 🔴 |
| `validators.test.ts` | All Zod schemas — bill, cheque, vendorCredit, billPayment, journalEntry | 🔴 |
| `gemini.test.ts` | Mock Gemini API — classification, invoice parsing, mapping suggestions | 🟡 |
| `qb-service.test.ts` | Mock fetch — buildJournalEntryPayload, buildBillPayload, etc. | 🟡 |
| `quickbooks-routes.test.ts` | Integration — sync endpoints, dedup flow, retry flow | 🟡 |
| `sync-batch.test.ts` | Batch sync with mixed types | 🟡 |
| `auth.test.ts` | Register, login, session, team billing merge | 🟠 |
| `capacity.test.ts` | Plan limit enforcement | 🟠 |

### H.2 — Frontend Test Priorities

| Test File | What to Test | Priority |
|-----------|-------------|----------|
| `je-builder.test.ts` | `guessPostingType`, `buildJEPayload`, `decodeMapping` | 🔴 |
| `column-extractor.test.ts` | `extractLineItems`, `evaluateProductMatch` | 🟡 |
| `scan-mode-utils.test.ts` | Already exists ✅ | ✅ |
| `fuzzy-matcher.test.ts` | Already exists ✅ | ✅ |
| `api.test.ts` | Mock fetch — all API methods, error handling | 🟡 |

### H.3 — Integration Test: Full Sync Pipeline

**Goal:** End-to-end test that simulates:
1. Scan a Toast page → save scan record
2. Map fields → save mappings
3. Build JE payload → sync to QB (mocked)
4. Verify sync log created with correct hash
5. Sync again → verify dedup (409)
6. Force sync → verify `skipDedupCheck` works
7. Retry failed sync → verify attempt count

---

## 11. Polish & Production Readiness (Phase I)

**Priority:** 🟢 Polish — Do after core phases.
**Estimated effort:** 2-3 days.

### I.1 — Console.log Audit

**Decision:** ScanView's 5 `console.log` statements are `NODE_ENV`-guarded. They're fine for debugging in development and silent in production.

**Action:** Leave as-is. No removal needed.

### I.2 — Error Messages with Actionable Next Steps

**Problem:** Production errors show "An unexpected error occurred" with no guidance.

**Fix — Create error code mapping:**
```typescript
const ERROR_GUIDANCE: Record<string, { message: string; action: string }> = {
  QB_TOKEN_EXPIRED: {
    message: 'QuickBooks connection expired',
    action: 'Go to Settings → Reconnect QuickBooks',
  },
  QB_RATE_LIMITED: {
    message: 'QuickBooks API limit reached',
    action: 'Wait 60 seconds and try again',
  },
  VALIDATION_ERROR: {
    message: 'Some fields are invalid',
    action: 'Check the highlighted fields and try again',
  },
  NETWORK_ERROR: {
    message: 'Cannot reach Nest server',
    action: 'Check your internet connection',
  },
};
```

### I.3 — Loading States & Skeleton Screens

**Problem:** Some views show nothing while loading, causing layout shift.

**Fix — Add skeleton screens:**
- ScanView: skeleton table while loading scans
- MappingView: skeleton mapping rows while loading
- SyncView: skeleton sync log table
- Preview forms: skeleton form fields while loading template defaults

### I.4 — Keyboard Shortcuts (Future)

- `Ctrl+Enter` in any preview form → Sync
- `Esc` → Close any modal/warning
- `Tab` / `Shift+Tab` → Navigate between form fields

### I.5 — Toast Notifications for Success

**Problem:** Sync success shows inline text. No celebratory feedback.

**Fix — Add toast notifications:**
- ✅ "Journal Entry synced successfully — Doc #NEST-ab12cd34"
- ✅ "Bill created — $500.00 to Vendor ABC"
- With "View in QuickBooks" link button

### I.6 — Mobile Responsiveness (Future)

The extension popup is 950×750. On smaller screens, consider:
- Responsive table → card layout
- Collapsible sidebar
- Touch-friendly form controls

---

## 12. Execution Order & Dependencies

```
Phase S (Security) ──────────────────────────── 30 min [BLOCKING]
    │
    ▼
Phase E (Template Defaults) ─────────────────── 1-2 days [BLOCKING for UX]
    │
    ├──► Phase A (Mapping Quality) ─────────── 3-4 days
    │        │
    │        └──► Phase B (AI Perfection) ──── 2-3 days (depends on A.1)
    │
    ├──► Phase C (Preview Validation) ──────── 2-3 days
    │
    ├──► Phase D (Multi-Type Sync) ────────── 2-3 days
    │
    ▼
Phase F (Onboarding) ────────────────────────── 2-3 days (after core features)
    │
    ├──► Phase G (Pricing) ─────────────────── 1 day (can be parallel)
    │
    ├──► Phase H (Tests) ───────────────────── 3-4 days (can be parallel)
    │
    ▼
Phase I (Polish) ─────────────────────────────── 2-3 days (last)
```

### Recommended Sprint Plan

| Sprint | Phases | Duration | Outcome |
|--------|--------|----------|---------|
| Sprint 1 | S + E | 2 days | Security fixed, template defaults complete |
| Sprint 2 | A + C | 5 days | Accountant-grade mapping + preview validation |
| Sprint 3 | B + D | 5 days | AI perfection + multi-type batch sync |
| Sprint 4 | F + G | 3 days | Onboarding wizard + pricing/Render upgrade |
| Sprint 5 | H | 4 days | Full test coverage |
| Sprint 6 | I | 3 days | Polish, toasts, skeletons, error guidance |

**Total estimated: 22 working days (4-5 weeks for a single developer)**

---

## Appendix: Quick Reference

### Transaction Type × Scan Mode Matrix

| Type | POS | Excel | Image |
|------|-----|-------|-------|
| Journal Entry | ✅ | ✅ | ✅ |
| Bill | ❌ | ✅ | ✅ |
| Vendor Credit | ❌ | ✅ | ✅ |
| Cheque | ❌ | ✅ | ✅ |
| Bill Payment | N/A | N/A | N/A (manual from BillPaymentView) |

### QB API Endpoints Used

| Entity | Method | URL |
|--------|--------|-----|
| Journal Entry | POST | `/company/{realmId}/journalentry` |
| Bill | POST | `/company/{realmId}/bill` |
| Vendor Credit | POST | `/company/{realmId}/vendorcredit` |
| Cheque | POST | `/company/{realmId}/purchase` (PaymentType=Check) |
| Bill Payment | POST | `/company/{realmId}/billpayment` |
| Accounts | GET | `/query?query=SELECT * FROM Account` |
| Vendors | GET | `/query?query=SELECT * FROM Vendor` |
| Classes | GET | `/query?query=SELECT * FROM Class` |
| Employees | GET | `/query?query=SELECT * FROM Employee` |
| Customers | GET | `/query?query=SELECT * FROM Customer` |
| Tax Codes | GET | `/query?query=SELECT * FROM TaxCode` |
| Terms | GET | `/query?query=SELECT * FROM Term` |
| Bills (outstanding) | GET | `/query?query=SELECT ... FROM Bill WHERE Balance > 0` |
| Vendor Credits | GET | `/query?query=SELECT ... FROM VendorCredit` |

### Key File Reference

| Concern | File |
|---------|------|
| QB sync routes | `Backend/src/routes/quickbooks.ts` |
| QB API service | `Backend/src/services/qb.service.ts` |
| AI/Gemini | `Backend/src/lib/gemini.ts` |
| Dedup | `Backend/src/lib/dedup.ts` |
| Validators | `Backend/src/lib/validators.ts` |
| Stripe/plans | `Backend/src/lib/stripe.ts` |
| Permissions | `Backend/src/lib/permissions.ts` |
| Prisma schema | `Backend/prisma/schema.prisma` |
| API client | `Frontend/src/popup/lib/api.ts` |
| Scan mode utils | `Frontend/src/popup/lib/scan-mode-utils.ts` |
| JE builder | `Frontend/src/popup/lib/je-builder.ts` |
| Column extractor | `Frontend/src/popup/lib/column-extractor.ts` |
| MappingView | `Frontend/src/popup/components/MappingView/index.tsx` |
| JE Preview | `Frontend/src/popup/components/JournalEntryPreview.tsx` |
| Bill Preview | `Frontend/src/popup/components/BillPreviewForm.tsx` |
| Check Preview | `Frontend/src/popup/components/CheckPreviewForm.tsx` |
| VC Preview | `Frontend/src/popup/components/VendorCreditPreviewForm.tsx` |
| Bill Payment | `Frontend/src/popup/components/BillPaymentView.tsx` |
| SyncView | `Frontend/src/popup/components/SyncView.tsx` |
| ScanView | `Frontend/src/popup/components/ScanView.tsx` |

---

*This roadmap is a living document. Update it as phases are completed and new discoveries are made.*
