import { describe, expect, it } from 'vitest';
import type { ExcelDataParseResult, ScanEntry } from '../../../types';
import { mapParsedTransactionsToScanEntries } from '../../components/ScanView';

describe('ScanView Excel parsing helper', () => {
  it('preserves type=BILL on bill transactions when mapping to ScanEntry', () => {
    const transactions: ExcelDataParseResult['transactions'] = [
      {
        type: 'BILL',
        header: {
          date: '2026-08-10',
          vendor: 'Vendor A',
          docNumber: 'BILL-1001',
          dueDate: '2026-08-30',
          account: 'Accounts Payable',
          taxType: 'Taxable',
        },
        lineItems: [{ amount: '250.00', postingType: 'Credit' }],
      },
    ];

    const scanEntries: ScanEntry[] = mapParsedTransactionsToScanEntries(transactions, 'bill.xlsx');

    expect(scanEntries).toHaveLength(1);
    expect(scanEntries[0].type).toBe('BILL');
    expect(scanEntries[0].lineItems[0].amount).toBe('250.00');
  });
});
