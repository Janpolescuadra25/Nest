# CHEQUE Scan Flow — Implementation Documentation

## 1. Overview

The CHEQUE scan flow allows users to upload a multi-row CHEQUE Excel file, which the backend parses into one transaction per row. Each transaction appears as an individual cheque form in the Preview tab, where users can review, edit, sync individually, or batch-sync all cheques at once.

## 2. Architecture & Data Flow

1. **User uploads CHEQUE Excel** in ScanView → `ScanView.tsx` sends file to backend via `api.parseExcelData()`
2. **Backend parses** (`Backend/src/routes/templates.ts` L370-407) — creates one transaction per valid Excel row, each with `lineItems: [lineItem]` containing all 11 fields
3. **Response mapped** via `mapParsedTransactionsToScanEntries()` (ScanView.tsx L81-96) → `scanEntries` state in `App.tsx`
4. **Scan tab** (`ScanView.tsx` L1403-1465) — renders N cheque cards by iterating `scanEntries.map()`, each showing cheque number, payee, amount, and all 11 fields
5. **User clicks "Sync All Cheques"** (`ScanView.tsx` L1468) → `onTabChange('preview')` navigates to Preview tab
6. **Preview tab** (`App.tsx` L631-648) — renders `<SyncAllChequesButton>` at the top, then N `<CheckPreviewForm>` instances via `scanEntries.map()`
7. **CheckPreviewForm** (`CheckPreviewForm.tsx` L439-531) — auto-populates `payeeRef`, `docNumber`, `txnDate`, `bankAccountRef` from `activeScanEntry.header` via a second `useEffect`
8. **Individual sync** — each `CheckPreviewForm` has its own sync button calling `api.createCheque()` → `POST /api/quickbooks/cheque`
9. **Batch sync** — `SyncAllChequesButton.tsx` (120 lines) calls `buildChequePayload()` per entry, then `api.syncBatch()` with all payloads → `POST /api/quickbooks/sync-batch`

## 3. Key Files

| File | Purpose | Key Lines |
|---|---|---|
| `Backend/src/routes/templates.ts` | CHEQUE Excel parser — one transaction per row | L370-407 |
| `Backend/tests/cheque-parser.test.ts` | 3 tests: 3-row, 2-row+skip, 1-row case-insensitive | Full file |
| `Frontend/src/popup/components/ScanView.tsx` | Cheque card rendering, "Sync All Cheques" button | L100 (column mappings), L1403-1465 (cards), L1468 (nav button) |
| `Frontend/src/popup/components/CheckPreviewForm.tsx` | Individual cheque preview with auto-population | L427-533 |
| `Frontend/src/popup/components/SyncAllChequesButton.tsx` | Batch sync button using `api.syncBatch()` + `buildChequePayload` | Full file (120 lines) |
| `Frontend/src/popup/lib/batch-payload-builder.ts` | `buildChequePayload()` builds QBO-compliant payload per entry | L264-353 |
| `Frontend/src/popup/App.tsx` | Renders `SyncAllChequesButton` + `CheckPreviewForm` instances in Preview tab | L631-648 |

## 4. CHEQUE LineItem Shape

Each `lineItems[0]` in a CHEQUE transaction contains these 11 fields:

`payeeName`, `bankAccount`, `paymentDate`, `checkNo`, `category`, `description`, `amount`, `tax`, `customer`, `memo`, `taxType`

The transaction `header` contains: `payeeName`, `bankAccount`, `paymentDate`, `checkNo`

## 5. Key Implementation Decisions

- **One transaction per row** (not one transaction with N lineItems) — each Excel row becomes an independent QuickBooks CHEQUE transaction. This was a deliberate fix in commit `5e2b5be` to match the Preview tab's design of showing N separate cheque forms.
- **SyncAllChequesButton as a dedicated component** — `App.tsx` does not import `useQBContext`, so the batch sync logic lives in its own component that CAN import it. This follows the codebase pattern of keeping context-dependent logic in child components.
- **CheckPreviewForm was NOT modified** — it already had auto-population logic in its second `useEffect` (L439-531) that resolves header fields. No changes were needed.
- **Default column mappings** — `ScanView.tsx` L100 defines `CHEQUE_DEFAULT_COLUMN_MAPPINGS` with 11 entries that auto-map Excel columns when a CHEQUE template is detected.
- **ScanView "Sync All Cheques" navigates to Preview** — the button calls `onTabChange('preview')` (not `'sync-history'`), bringing the user to where the `SyncAllChequesButton` component is rendered.

## 6. Test Coverage

3 tests in `cheque-parser.test.ts`:

1. **3 valid rows** → `transactions.length === 3`, each with `lineItems.length === 1`, per-row header assertions (Vendor A/1001, Vendor B/1002, Vendor A/1003)
2. **2 valid + 1 invalid amount** → `transactions.length === 2`, `skippedRows === 1`, per-row header assertions (Vendor A/1001, Vendor C/1003)
3. **1 valid row, case-insensitive headers** → `transactions.length === 1`, `lineItems.length === 1`

All part of the 117/117 passing test suite (20 suites).

## 7. Batch Sync Flow (SyncAllChequesButton)

1. On click, loads mappings (`api.getMappings`) and value mappings (`api.getValueMappings`)
2. Iterates `scanEntries`, calling `buildChequePayload(entry, template, mappings, valueMappings, vendors, customers, taxCodes, accounts, locationId)` per entry
3. Null payloads (missing required data) are counted as skipped
4. Calls `api.syncBatch(jwt, payloads)` with all valid payloads → `POST /api/quickbooks/sync-batch`
5. Handles AUTH failure detection (same pattern as `SyncView.tsx`)
6. Shows progress during sync, summary after completion (X synced, Y skipped, Z failed)
7. Uses `useToast()` for notifications — must be rendered inside `<ToastProvider>`
8. Uses `useQBContext()` for accounts, vendors, customers, taxCodes — must be rendered inside `<QBContextProvider>`

## 8. State Management Note

All scan state (`scanData`, `scanEntries`, `activeScanEntryId`, `scanMode`, `selectedTemplateForScan`) lives in `App.tsx` as in-memory `useState` (L52-60). This state is **lost on popup close**. F-6 (Scan Data Flow Hardening) will address this by persisting to `chrome.storage.local`.
