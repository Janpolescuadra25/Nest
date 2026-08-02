import { parseNumericValue } from './parse-numeric-value';
import { decodeMapping } from './je-builder';
import { resolveMapping } from './mapping-conditions';
import { resolveValueMapping } from './resolve-value-mapping';
import type { Mapping, ScanData, ScanEntry, QBBillLineItem, QBChequeLineItem, BatchSyncItem, ValueMapping } from '../../types';
import type { QBAccount } from '../types/qb';

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
  txnDate: string;
  defaults: TemplateDefaults;
  scanEntry?: ScanEntry;
  valueMappings: ValueMapping[];
}): BatchSyncItem | null {
  const { scanRecordId, scanData, mappings, accounts, txnDate, defaults, scanEntry, valueMappings } = params;
  const decoded = mappings.map(decodeMapping);

  const scanFields: ScanData = scanEntry
    ? Object.fromEntries(
        Object.entries(scanEntry.lineItems?.[0] ?? {})
          .map(([key, value]) => [key, parseNumericValue(value)])
          .filter(([, value]) => !Number.isNaN(value)),
      ) as ScanData
    : scanData;

  const lines: QBChequeLineItem[] = Object.entries(scanFields)
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

  const amount = lines.reduce((sum, line) => sum + line.amount, 0);

  return {
    scanRecordId,
    transactionType: 'CHEQUE',
    txnDate,
    lines,
    bankAccountRef: defaults.bankAccountRef ?? undefined,
    payeeRef: defaults.payeeRef ?? undefined,
    amount,
    memo: defaults.qbMemo?.value || defaults.memo?.value,
    docNumber: defaults.docNumber?.value,
  };
}
