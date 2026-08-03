import { describe, it, expect } from 'vitest'
import { decodeMapping, guessPostingType, buildJEPayload } from '../je-builder'
import type { DecodedMapping, JEPayload } from '../je-builder'
import type { Mapping, MappingCondition, ScanData, ScanEntry } from '../../../types'
import type { QBAccount } from '../../types/qb'

// --- Fixtures ---

// Builds a raw Mapping object (Prisma shape) with only the fields decodeMapping reads.
// Uses `as unknown as Mapping` because the Prisma Mapping type has many required fields
// (id, userId, locationId, createdAt, etc.) that are irrelevant to decodeMapping's logic.
const makeRawMapping = (overrides: Record<string, unknown>): Mapping =>
  ({
    sourceField: '',
    targetAccount: '',
    postingType: undefined,
    targetMemo: undefined,
    targetClass: undefined,
    targetDescription: undefined,
    keepSeparate: undefined,
    priority: undefined,
    conditions: null,
    ...overrides,
  } as unknown as Mapping)

// QBAccount uses PascalCase per QB API convention.
// All fields except CurrentBalance are required.
const mockAccounts = [
  { Id: 'acc-1', Name: 'Cash', FullyQualifiedName: 'Cash', AccountType: 'Bank', AccountSubType: 'Checking', Classification: 'Asset', Active: true },
  { Id: 'acc-2', Name: 'Revenue', FullyQualifiedName: 'Revenue', AccountType: 'Income', AccountSubType: 'SalesOfProductIncome', Classification: 'Revenue', Active: true },
  { Id: 'acc-3', Name: 'Sales Tax', FullyQualifiedName: 'Sales Tax', AccountType: 'OtherCurrentLiability', AccountSubType: 'SalesTaxPayable', Classification: 'Liability', Active: true },
] as QBAccount[]

describe('decodeMapping', () => {
  it('preserves all fields when every Mapping field is set', () => {
    const mapping = makeRawMapping({
      sourceField: 'Revenue.Net sales',
      targetAccount: 'acc-rev',
      postingType: 'Credit',
      targetClass: 'class-1',
      targetDescription: 'Monthly revenue',
      keepSeparate: true,
      priority: 5,
      conditions: [{ field: 'amount', operator: 'greater_than', value: 10 }],
    })
    const result = decodeMapping(mapping)
    expect(result.sourceField).toBe('Revenue.Net sales')
    expect(result.accountId).toBe('acc-rev')
    expect(result.postingType).toBe('Credit')
    expect(result.classId).toBe('class-1')
    expect(result.description).toBe('Monthly revenue')
    expect(result.keepSeparate).toBe(true)
    expect(result.priority).toBe(5)
    expect(result.conditions).toEqual([{ field: 'amount', operator: 'greater_than', value: 10 }])
  })

  it('applies postingType from targetMemo JSON when postingType is undefined', () => {
    const mapping = makeRawMapping({
      sourceField: 'field',
      targetAccount: 'acc-1',
      postingType: undefined,
      targetMemo: '{"postingType":"Debit"}',
    })
    const result = decodeMapping(mapping)
    expect(result.postingType).toBe('Debit')
  })

  it('direct postingType wins over targetMemo JSON override', () => {
    const mapping = makeRawMapping({
      sourceField: 'field',
      targetAccount: 'acc-1',
      postingType: 'Credit',
      targetMemo: '{"postingType":"Debit"}',
    })
    const result = decodeMapping(mapping)
    expect(result.postingType).toBe('Credit')
  })

  it('silently ignores invalid targetMemo JSON and defaults postingType to Credit', () => {
    const mapping = makeRawMapping({
      sourceField: 'field',
      targetAccount: 'acc-1',
      postingType: undefined,
      targetMemo: 'not valid json',
    })
    const result = decodeMapping(mapping)
    expect(result.postingType).toBe('Credit')
  })

  it('defaults postingType to Credit for unrecognized values', () => {
    const mapping = makeRawMapping({
      sourceField: 'field',
      targetAccount: 'acc-1',
      postingType: 'Invalid',
    })
    const result = decodeMapping(mapping)
    expect(result.postingType).toBe('Credit')
  })

  it('defaults priority to 0 when undefined', () => {
    const mapping = makeRawMapping({
      sourceField: 'field',
      targetAccount: 'acc-1',
      priority: undefined,
    })
    const result = decodeMapping(mapping)
    expect(result.priority).toBe(0)
  })

  it('applies keepSeparate from targetMemo JSON when keepSeparate is undefined', () => {
    const mapping = makeRawMapping({
      sourceField: 'field',
      targetAccount: 'acc-1',
      keepSeparate: undefined,
      targetMemo: '{"keepSeparate": true}',
    })
    const result = decodeMapping(mapping)
    expect(result.keepSeparate).toBe(true)
  })
})

describe('guessPostingType', () => {
  it('returns debit for Cash Activity.Cash', () => {
    expect(guessPostingType('Cash Activity.Cash')).toBe('debit')
  })

  it('returns credit for Cash Activity.Credit tips (exception to cash activity default)', () => {
    expect(guessPostingType('Cash Activity.Credit tips')).toBe('credit')
  })

  it('returns credit for Tips.Tips', () => {
    expect(guessPostingType('Tips.Tips')).toBe('credit')
  })

  it('returns debit for Tips.Cash tips paid out (exception to tips default)', () => {
    expect(guessPostingType('Tips.Cash tips paid out')).toBe('debit')
  })

  it('returns debit for Payments.Credit card', () => {
    expect(guessPostingType('Payments.Credit card')).toBe('debit')
  })

  it('returns credit for Revenue.Net sales', () => {
    expect(guessPostingType('Revenue.Net sales')).toBe('credit')
  })

  it('returns credit for Tax.Sales tax', () => {
    expect(guessPostingType('Tax.Sales tax')).toBe('credit')
  })

  it('returns debit for Discount.Total discount', () => {
    expect(guessPostingType('Discount.Total discount')).toBe('debit')
  })

  it('returns debit for Unpaid Orders.Balance', () => {
    expect(guessPostingType('Unpaid Orders.Balance')).toBe('debit')
  })

  it('returns credit for Credit Card Tips', () => {
    expect(guessPostingType('Credit Card Tips')).toBe('credit')
  })

  it('returns credit for Gift Card.Gift cards sold', () => {
    expect(guessPostingType('Gift Card.Gift cards sold')).toBe('credit')
  })

  it('returns debit for unknown field names (default fallback)', () => {
    expect(guessPostingType('Some Random Field')).toBe('debit')
  })
})

describe('buildJEPayload', () => {
  it('returns balanced=true when total debits equal total credits', () => {
    const result = buildJEPayload({
      scanRecordId: 'scan-1',
      scanData: { debitField: 100, creditField: 100 },
      mappings: [
        makeRawMapping({ sourceField: 'debitField', targetAccount: 'acc-1', postingType: 'Debit' }),
        makeRawMapping({ sourceField: 'creditField', targetAccount: 'acc-2', postingType: 'Credit' }),
      ],
      accounts: mockAccounts,
      txnDate: '2024-01-15',
      valueMappings: [],
    })
    expect(result.balanced).toBe(true)
    expect(result.imbalanceAmount).toBe(0)
    expect(result.totalDebits).toBe(100)
    expect(result.totalCredits).toBe(100)
  })

  it('returns balanced=false and correct imbalance when debits exceed credits', () => {
    const result = buildJEPayload({
      scanRecordId: 'scan-1',
      scanData: { field1: 150, field2: 50 },
      mappings: [
        makeRawMapping({ sourceField: 'field1', targetAccount: 'acc-1', postingType: 'Debit' }),
        makeRawMapping({ sourceField: 'field2', targetAccount: 'acc-2', postingType: 'Credit' }),
      ],
      accounts: mockAccounts,
      txnDate: '2024-01-15',
      valueMappings: [],
    })
    expect(result.balanced).toBe(false)
    expect(result.imbalanceAmount).toBe(100)
    expect(result.totalDebits).toBe(150)
    expect(result.totalCredits).toBe(50)
  })

  it('flips posting side when amount is negative', () => {
    const result = buildJEPayload({
      scanRecordId: 'scan-1',
      scanData: { field1: -100 },
      mappings: [
        makeRawMapping({ sourceField: 'field1', targetAccount: 'acc-1', postingType: 'Debit' }),
      ],
      accounts: mockAccounts,
      txnDate: '2024-01-15',
      valueMappings: [],
    })
    expect(result.totalDebits).toBe(0)
    expect(result.totalCredits).toBe(100)
  })

  it('excludes fields with amount === 0 from lines', () => {
    const result = buildJEPayload({
      scanRecordId: 'scan-1',
      scanData: { field1: 100, field2: 0, field3: 50 },
      mappings: [
        makeRawMapping({ sourceField: 'field1', targetAccount: 'acc-1', postingType: 'Debit' }),
        makeRawMapping({ sourceField: 'field2', targetAccount: 'acc-2', postingType: 'Credit' }),
        makeRawMapping({ sourceField: 'field3', targetAccount: 'acc-3', postingType: 'Credit' }),
      ],
      accounts: mockAccounts,
      txnDate: '2024-01-15',
      valueMappings: [],
    })
    expect(result.lines).toHaveLength(2)
  })

  it('uses guessPostingType for unmapped fields', () => {
    const result = buildJEPayload({
      scanRecordId: 'scan-1',
      scanData: { 'Some Random Field': 75 },
      mappings: [],
      accounts: [],
      txnDate: '2024-01-15',
      valueMappings: [],
    })
    expect(result.totalDebits).toBe(75)
    expect(result.totalCredits).toBe(0)
    expect(result.lines).toHaveLength(1)
  })

  it('reads fields from scanEntry.lineItems[0] when scanEntry is provided', () => {
    const result = buildJEPayload({
      scanRecordId: 'scan-1',
      scanData: { field1: 999 },
      scanEntry: {
        id: 's1',
        source: 'excel',
        header: {},
        lineItems: [{ field1: '200' }],
      } as ScanEntry,
      mappings: [
        makeRawMapping({ sourceField: 'field1', targetAccount: 'acc-1', postingType: 'Debit' }),
      ],
      accounts: mockAccounts,
      txnDate: '2024-01-15',
      valueMappings: [],
    })
    expect(result.totalDebits).toBe(200)
  })

  it('passes privateNote and docNumber through to the payload', () => {
    const result = buildJEPayload({
      scanRecordId: 'scan-1',
      scanData: { field1: 100 },
      mappings: [
        makeRawMapping({ sourceField: 'field1', targetAccount: 'acc-1', postingType: 'Debit' }),
      ],
      accounts: mockAccounts,
      txnDate: '2024-01-15',
      privateNote: 'Internal note',
      docNumber: 'INV-001',
      valueMappings: [],
    })
    expect(result.privateNote).toBe('Internal note')
    expect(result.docNumber).toBe('INV-001')
  })
})
