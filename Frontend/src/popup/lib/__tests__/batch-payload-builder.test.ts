import { describe, expect, it } from 'vitest';
import { buildChequePayload } from '../batch-payload-builder';
import type { Mapping, QBChequeLineItem, ScanData, ScanEntry, ValueMapping } from '../../../types';
import type { QBAccount } from '../../types/qb';

describe('batch-payload-builder', () => {
  const mockAccounts: QBAccount[] = [
    { Id: 'acc-1', Name: 'Checking', FullyQualifiedName: 'Checking', AccountType: 'Bank', AccountSubType: 'Checking', Classification: 'Asset', Active: true },
    { Id: 'acc-2', Name: 'Rent Expense', FullyQualifiedName: 'Rent Expense', AccountType: 'Expense', AccountSubType: 'Rent', Classification: 'Expense', Active: true },
    { Id: 'acc-3', Name: 'Utilities Expense', FullyQualifiedName: 'Utilities Expense', AccountType: 'Expense', AccountSubType: 'Utilities', Classification: 'Expense', Active: true },
    { Id: 'acc-4', Name: 'Office Supplies', FullyQualifiedName: 'Office Supplies', AccountType: 'Expense', AccountSubType: 'Office Supplies', Classification: 'Expense', Active: true },
  ];

  const mockMappings: Mapping[] = [
    { id: 'm-1', locationId: 'loc-1', templateId: 'tmpl-1', sourceField: 'Rent', targetAccount: 'acc-2', postingType: 'Debit', keepSeparate: false, targetClass: undefined, targetName: undefined, targetDescription: undefined, targetMemo: undefined, conditions: null, priority: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'm-2', locationId: 'loc-1', templateId: 'tmpl-1', sourceField: 'Utilities', targetAccount: 'acc-3', postingType: 'Debit', keepSeparate: false, targetClass: undefined, targetName: undefined, targetDescription: undefined, targetMemo: undefined, conditions: null, priority: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'm-3', locationId: 'loc-1', templateId: 'tmpl-1', sourceField: 'Supplies', targetAccount: 'acc-4', postingType: 'Debit', keepSeparate: false, targetClass: undefined, targetName: undefined, targetDescription: undefined, targetMemo: undefined, conditions: null, priority: 0, createdAt: '2026-01-01T00:00:00.000Z' },
  ];

  const mockDefaults = {
    bankAccountRef: { value: 'acc-1', name: 'Checking' },
    payeeRef: { value: 'vendor-1', name: 'ACME Corp' },
    qbMemo: { value: 'Monthly payment' },
    docNumber: { value: 'CHK-001' },
  };

  const mockValueMappings: ValueMapping[] = [];

  it('processes all line items from scanEntry, not just the first', () => {
    const scanEntry: ScanEntry = {
      id: 'scan-1',
      source: 'excel',
      header: { payeeRef: 'ACME Corp', docNumber: 'CHK-001', date: '2026-01-15' },
      lineItems: [
        { Rent: '1500' },
        { Utilities: '300' },
        { Supplies: '75.50' },
      ],
    };

    const result = buildChequePayload({
      scanRecordId: 'scan-1',
      scanData: {},
      mappings: mockMappings,
      accounts: mockAccounts,
      txnDate: '2026-01-15',
      defaults: mockDefaults,
      scanEntry,
      valueMappings: mockValueMappings,
    });

    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe('CHEQUE');
    expect(result!.lines).toHaveLength(3);
    expect(result!.amount).toBe(1875.5);

    const lines = result!.lines as QBChequeLineItem[];
    expect(lines[0].accountRef.value).toBe('acc-2');
    expect(lines[0].amount).toBe(1500);
    expect(lines[1].accountRef.value).toBe('acc-3');
    expect(lines[1].amount).toBe(300);
    expect(lines[2].accountRef.value).toBe('acc-4');
    expect(lines[2].amount).toBe(75.5);
    expect(result!.bankAccountRef?.value).toBe('acc-1');
    expect(result!.payeeRef?.value).toBe('vendor-1');
    expect(result!.docNumber).toBe('CHK-001');
    expect(result!.memo).toBe('Monthly payment');
  });

  it('handles a single line item correctly (baseline)', () => {
    const scanEntry: ScanEntry = {
      id: 'scan-2',
      source: 'excel',
      header: { payeeRef: 'Vendor B', docNumber: 'CHK-002', date: '2026-02-01' },
      lineItems: [
        { Rent: '1200' },
      ],
    };

    const result = buildChequePayload({
      scanRecordId: 'scan-2',
      scanData: {},
      mappings: mockMappings,
      accounts: mockAccounts,
      txnDate: '2026-02-01',
      defaults: mockDefaults,
      scanEntry,
      valueMappings: mockValueMappings,
    });

    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(1);
    expect(result!.amount).toBe(1200);
  });

  it('returns null when scanEntry has no line items', () => {
    const scanEntry: ScanEntry = {
      id: 'scan-3',
      source: 'excel',
      header: {},
      lineItems: [],
    };

    const result = buildChequePayload({
      scanRecordId: 'scan-3',
      scanData: {},
      mappings: mockMappings,
      accounts: mockAccounts,
      txnDate: '2026-01-15',
      defaults: mockDefaults,
      scanEntry,
      valueMappings: mockValueMappings,
    });

    expect(result).toBeNull();
  });

  it('falls back to scanData when no scanEntry is provided (POS mode)', () => {
    const scanData: ScanData = {
      Rent: 1500,
      Utilities: 300,
      Supplies: 75.5,
    };

    const result = buildChequePayload({
      scanRecordId: 'scan-4',
      scanData,
      mappings: mockMappings,
      accounts: mockAccounts,
      txnDate: '2026-01-15',
      defaults: mockDefaults,
      valueMappings: mockValueMappings,
    });

    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(3);
    expect(result!.amount).toBe(1875.5);
  });

  it('handles undefined scanEntry same as POS mode', () => {
    const scanData: ScanData = { Rent: 500 };

    const result = buildChequePayload({
      scanRecordId: 'scan-5',
      scanData,
      mappings: mockMappings,
      accounts: mockAccounts,
      txnDate: '2026-01-15',
      defaults: mockDefaults,
      scanEntry: undefined,
      valueMappings: mockValueMappings,
    });

    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(1);
    expect(result!.amount).toBe(500);
  });
});
