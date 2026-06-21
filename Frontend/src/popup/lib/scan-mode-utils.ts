import type { ScanMode } from '../../types';

/**
 * Maps a scan source string (from ScanRecord.source) to a ScanMode type.
 * Note: ScanRecord.source will eventually be renamed to scanMode (Phase 1 Task 1.4).
 * For now, we bridge the existing field to the new enum.
 */
export function sourceToScanMode(source: string): ScanMode {
  const s = (source || '').toLowerCase().trim();
  if (s === 'pos' || s === 'toast' || s === 'oracle' || s === 'salido') return 'POS';
  if (s === 'excel' || s === 'xlsx' || s === 'csv') return 'EXCEL';
  return 'IMAGE';
}

/**
 * Returns a human-readable label for a ScanMode value.
 */
export function getScanModeDisplay(mode: ScanMode): string {
  switch (mode) {
    case 'POS': return 'POS Scan';
    case 'EXCEL': return 'Excel Import';
    case 'IMAGE': return 'Image / PDF Scan';
  }
}

/**
 * Validates that the combination of scan mode and transaction type is allowed.
 * Current constraint: POS mode only supports JOURNAL_ENTRY (per Roadmap Table 6).
 * This may be relaxed in the future if POS systems add line-item support.
 */
export function isTransactionTypeCompatible(
  scanMode: ScanMode,
  transactionType: string
): boolean {
  if (scanMode === 'POS') {
    return transactionType === 'JOURNAL_ENTRY';
  }
  // IMAGE and EXCEL support all transaction types
  return true;
}

/**
 * Determines whether a given MappingView section should be visible
 * based on the current scan mode and template configuration.
 */
export function isSectionVisible(
  section: 'fieldMapping' | 'columnMapping' | 'productMatching' | 'templateDefaults',
  scanMode: ScanMode | null | undefined,
  transactionType: string | null | undefined,
  options?: { hasProductNameColumn?: boolean }
): boolean {
  const mode = scanMode || 'IMAGE';

  switch (section) {
    case 'fieldMapping':
      return transactionType === 'JOURNAL_ENTRY';

    case 'columnMapping':
      return mode === 'EXCEL';

    case 'productMatching':
      if (mode === 'POS') return false;
      if (mode === 'EXCEL') return !!options?.hasProductNameColumn;
      return true;

    case 'templateDefaults':
      return ['BILL', 'VENDOR_CREDIT', 'CHEQUE'].includes(transactionType || '');

    default:
      return false;
  }
}
