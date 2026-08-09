import { parseNumericValue } from './parse-numeric-value';
import { decodeMapping } from './je-builder';
import { resolveMapping } from './mapping-conditions';
import { resolveValueMapping } from './resolve-value-mapping';
import type { Mapping, ScanData, ScanEntry, QBBillLineItem, QBChequeLineItem, BatchSyncItem, ValueMapping } from '../../types';
import type { QBAccount, QBCustomer } from '../types/qb';

type TemplateDefaults = Record<string, { value: string; name?: string } | null>;

export function buildBillLikePayload(params: {
  scanRecordId: string;
  transactionType: 'BILL' | 'VENDOR_CREDIT';
  scanData: ScanData;
  mappings: Mapping[];
  accounts: QBAccount[];
  txnDate: string;
  defaults: TemplateDefaults;
  scanEntry?: ScanEntry;
  valueMappings: ValueMapping[];
}): BatchSyncItem | null {
  const { scanRecordId, transactionType, scanData, mappings, accounts, txnDate, defaults, scanEntry, valueMappings } = params;
  const decoded = mappings.map(decodeMapping);

  const scanFields: ScanData = scanEntry
    ? Object.fromEntries(
        Object.entries(scanEntry.lineItems?.[0] ?? {})
          .map(([key, value]) => [key, parseNumericValue(value)])
          .filter(([, value]) => !Number.isNaN(value)),
      ) as ScanData
    : scanData;

  const lines: QBBillLineItem[] = Object.entries(scanFields)
    .filter(([, amount]) => amount !== 0)
    .map(([field, amount]) => {
      const mapping = resolveMapping(decoded, field, scanFields);
      let accountId = mapping?.accountId ?? '';
      if (!accountId) {
        const vmResult = resolveValueMapping(
          field,
          'account',
          valueMappings,
          (id) => accounts.find((a) => a.Id === id),
        );
        if (vmResult.matched) {
          accountId = vmResult.entityId;
        }
      }
      const accountName = accounts.find((a) => a.Id === accountId)?.FullyQualifiedName ?? '';
      const description = mapping?.description ?? field;
      const classId = mapping?.classId;

      return {
        amount: Math.abs(amount),
        accountRef: { value: accountId, name: accountName || undefined },
        description: description || undefined,
        classRef: classId ? { value: classId } : undefined,
      };
    });

  if (lines.length === 0) return null;

  return {
    scanRecordId,
    transactionType,
    txnDate,
    lines,
    vendorRef: defaults.vendorRef ?? undefined,
    apAccountRef: defaults.apAccountRef ?? undefined,
    termsRef: defaults.termsRef ?? undefined,
    dueDate: defaults.dueDate?.value,
    privateNote: defaults.privateNote?.value || defaults.memo?.value,
    memo: defaults.qbMemo?.value,
    docNumber: defaults.docNumber?.value,
  };
}

export function buildChequePayload(params: {
  scanRecordId: string;
  scanData: ScanData;
  mappings: Mapping[];
  accounts: QBAccount[];
  customers?: QBCustomer[];
  txnDate: string;
  defaults: TemplateDefaults;
  scanEntry?: ScanEntry;
  valueMappings: ValueMapping[];
}): BatchSyncItem | null {
  const { scanRecordId, scanData, mappings, accounts, customers, txnDate, defaults, scanEntry, valueMappings } = params;
  const decoded = mappings.map(decodeMapping);

  let customerRef: { value: string; name?: string } | undefined;
  if (customers?.length && scanEntry?.lineItems?.length) {
    for (const lineItem of scanEntry.lineItems) {
      for (const value of Object.values(lineItem)) {
        if (typeof value !== 'string') continue;
        const normalized = value.trim().toLowerCase();
        const matchedCustomer = customers.find((customer) => customer.DisplayName.toLowerCase() === normalized);
        if (matchedCustomer) {
          customerRef = { value: matchedCustomer.Id, name: matchedCustomer.DisplayName };
          break;
        }
      }
      if (customerRef) break;
    }
  }

  const buildLines = (fields: ScanData): QBChequeLineItem[] =>
    Object.entries(fields)
      .filter(([, amount]) => amount !== 0)
      .map(([field, amount]) => {
        const mapping = resolveMapping(decoded, field, fields);
        let accountId = mapping?.accountId ?? '';
        if (!accountId) {
          const vmResult = resolveValueMapping(
            field,
            'account',
            valueMappings,
            (id) => accounts.find((a) => a.Id === id),
          );
          if (vmResult.matched) {
            accountId = vmResult.entityId;
          }
        }
        const accountName = accounts.find((a) => a.Id === accountId)?.FullyQualifiedName ?? '';
        const description = mapping?.description ?? field;
        const classId = mapping?.classId;

        return {
          amount: Math.abs(amount),
          accountRef: { value: accountId, name: accountName || undefined },
          description: description || undefined,
          classRef: classId ? { value: classId } : undefined,
        };
      });

  const lines: QBChequeLineItem[] = [];

  if (scanEntry?.lineItems?.length) {
    for (const lineItem of scanEntry.lineItems) {
      const itemFields = Object.fromEntries(
        Object.entries(lineItem)
          .map(([key, value]) => [key, parseNumericValue(value)])
          .filter(([, value]) => !Number.isNaN(value)),
      ) as ScanData;

      lines.push(...buildLines(itemFields));
    }
  } else {
    lines.push(...buildLines(scanData));
  }

  if (lines.length === 0) return null;

  const amount = lines.reduce((sum, line) => sum + line.amount, 0);

  return {
    scanRecordId,
    transactionType: 'CHEQUE',
    txnDate,
    lines,
    bankAccountRef: defaults.bankAccountRef ?? undefined,
    payeeRef: defaults.payeeRef ?? undefined,
    customerRef,
    amount,
    memo: defaults.qbMemo?.value || defaults.memo?.value,
    docNumber: defaults.docNumber?.value,
  };
}
