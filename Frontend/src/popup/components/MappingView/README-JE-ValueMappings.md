# Journal Entry Value Mappings Implementation
Status: **DONE** (completed 2026-08-24)

## Overview
Added column-based value mappings for Journal Entry (JE) templates in EXCEL scan mode, enabling AI Suggest functionality for JE line item fields. This matches the existing value mapping pattern used by Cheque and Bill templates.

## Files Modified
1. `../lib/value-mapping-column-utils.ts`
   - Added `JournalEntryColumnOptions` interface
   - Added `buildJournalEntryColumnConfigs()` function returning 4 `ColumnMappingConfig` entries
2. `../../../types/index.ts`
   - Extended `ColumnMappingConfig.sourceField` union to include `'account' | 'name' | 'class' | 'tax'`
3. `index.tsx` (this file)
   - Added import for `buildJournalEntryColumnConfigs`
   - Added `jeClassOptions` useMemo to format QB classes into select options
   - Added `journalEntryColumnConfigs` useMemo to build JE column configs
   - Replaced the single generic ValueMappingSection with the wrapper+map pattern used by Bill/Cheque

## JE Columns Implemented
| sourceField | fieldType | Label | Description |
|-------------|-----------|-------|-------------|
| account | account | Account | Map raw account names from Excel to QuickBooks accounts |
| name | name | Entity Name | Map raw entity/customer names from Excel to QuickBooks vendors/customers |
| class | class | Class | Map raw class names from Excel to QuickBooks classes |
| tax | taxCode | Tax Code | Map raw tax names from Excel to QuickBooks tax codes |

## Behavior
- When viewing a JE template in EXCEL mode, 4 value mapping sections render (one per column)
- Each section extracts unique scanned values from JE lineItems (not headers, since JEs are multi-line)
- AI Suggest button is active and functional for all 4 columns
- Batch apply works identically to Bill/Cheque
- TypeScript compiles cleanly with zero errors

## Dependencies
- Reuses existing `ValueMappingSection.tsx` component
- Reuses existing `POST /api/mappings/suggest-values` backend endpoint
- Reuses existing QBContext data (accounts, classes, taxCodes, vendors)

## Architecture Notes
- JE scan entries store data in `lineItems` (multi-line row-based), unlike Cheque/Bill which use both `header` and `lineItems`
- The `uniqueScannedValues` useMemo in ValueMappingSection already handles both `entry.header[field]` and `entry.lineItems[*][field]`, so no changes were needed there
- The backend endpoint is template-agnostic — it receives `valueCategories` with `fieldType` and matches against the appropriate QB entity list, so no backend changes were needed
- `chequePayeeOptions` (active vendors) is reused for JE's `name` field since both map to the same QB entity type
- `classes` was already fetched in MappingView via QBContext but had no useMemo formatting it into the `{ value, label, subtitle }` shape — `jeClassOptions` fills this gap
