import { describe, expect, it } from 'vitest';
import { isSectionVisible, sourceToScanMode, isTransactionTypeCompatible } from '../scan-mode-utils';

describe('scan-mode-utils', () => {
  describe('isSectionVisible()', () => {
    it('hides fieldMapping for non-JOURNAL_ENTRY types', () => {
      expect(isSectionVisible('fieldMapping', 'IMAGE', 'JOURNAL_ENTRY')).toBe(true);
      expect(isSectionVisible('fieldMapping', 'POS', 'JOURNAL_ENTRY')).toBe(true);
      expect(isSectionVisible('fieldMapping', 'EXCEL', 'BILL')).toBe(false);
      expect(isSectionVisible('fieldMapping', null, null)).toBe(false);
    });

    it('shows columnMapping only for EXCEL', () => {
      expect(isSectionVisible('columnMapping', 'EXCEL', 'JOURNAL_ENTRY')).toBe(true);
      expect(isSectionVisible('columnMapping', 'EXCEL', 'BILL')).toBe(true);
      expect(isSectionVisible('columnMapping', 'IMAGE', 'JOURNAL_ENTRY')).toBe(false);
      expect(isSectionVisible('columnMapping', 'POS', 'JOURNAL_ENTRY')).toBe(false);
    });

    it('shows productMatching for IMAGE always, EXCEL only with productNameColumn, and never for POS', () => {
      expect(isSectionVisible('productMatching', 'IMAGE', 'BILL')).toBe(true);
      expect(isSectionVisible('productMatching', 'IMAGE', 'JOURNAL_ENTRY')).toBe(true);
      expect(isSectionVisible('productMatching', 'EXCEL', 'BILL', { hasProductNameColumn: true })).toBe(true);
      expect(isSectionVisible('productMatching', 'EXCEL', 'BILL', { hasProductNameColumn: false })).toBe(false);
      expect(isSectionVisible('productMatching', 'EXCEL', 'BILL')).toBe(false);
      expect(isSectionVisible('productMatching', 'POS', 'JOURNAL_ENTRY')).toBe(false);
    });

    it('shows templateDefaults only for BILL, VENDOR_CREDIT', () => {
      expect(isSectionVisible('templateDefaults', 'IMAGE', 'BILL')).toBe(true);
      expect(isSectionVisible('templateDefaults', 'IMAGE', 'VENDOR_CREDIT')).toBe(true);
      expect(isSectionVisible('templateDefaults', 'IMAGE', 'CHEQUE')).toBe(false);
      expect(isSectionVisible('templateDefaults', 'IMAGE', 'JOURNAL_ENTRY')).toBe(false);
      expect(isSectionVisible('templateDefaults', 'POS', 'JOURNAL_ENTRY')).toBe(false);
    });
  });

  describe('sourceToScanMode()', () => {
    it('maps source strings to scan modes', () => {
      expect(sourceToScanMode('pos')).toBe('POS');
      expect(sourceToScanMode('toast')).toBe('POS');
      expect(sourceToScanMode('oracle')).toBe('POS');
      expect(sourceToScanMode('excel')).toBe('EXCEL');
      expect(sourceToScanMode('xlsx')).toBe('EXCEL');
      expect(sourceToScanMode('image')).toBe('IMAGE');
      expect(sourceToScanMode('pdf')).toBe('IMAGE');
      expect(sourceToScanMode('')).toBe('IMAGE');
      expect(sourceToScanMode(null as any)).toBe('IMAGE');
    });
  });

  describe('isTransactionTypeCompatible()', () => {
    it('validates transaction type compatibility with scan mode', () => {
      expect(isTransactionTypeCompatible('POS', 'JOURNAL_ENTRY')).toBe(true);
      expect(isTransactionTypeCompatible('POS', 'BILL')).toBe(false);
      expect(isTransactionTypeCompatible('POS', 'VENDOR_CREDIT')).toBe(false);
      expect(isTransactionTypeCompatible('IMAGE', 'JOURNAL_ENTRY')).toBe(true);
      expect(isTransactionTypeCompatible('IMAGE', 'BILL')).toBe(true);
      expect(isTransactionTypeCompatible('EXCEL', 'CHEQUE')).toBe(true);
    });
  });
});
