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
  vendors?: Array<{ Id: string; DisplayName?: string; Name?: string }>;
  taxCodes?: Array<{ Id: string; Name?: string; Description?: string }>;
  txnDate: string;
  defaults: TemplateDefaults;
  scanEntry?: ScanEntry;
  valueMappings: ValueMapping[];
}): BatchSyncItem | null {
  const { scanRecordId, scanData, mappings, accounts, customers, vendors, taxCodes, txnDate, defaults, scanEntry, valueMappings } = params;
  const decoded = mappings.map(decodeMapping);

  let customerRef: { value: string; name?: string } | undefined;
  if (customers?.length && scanEntry?.lineItems?.length) {
    for (const lineItem of scanEntry.lineItems) {
      const rawCustomer = String(lineItem.customer ?? lineItem.Customer ?? '').trim();
      if (!rawCustomer) continue;

      const normalized = rawCustomer.toLowerCase();
      const matchedCustomer = customers.find((customer) => {
        const candidate = String(customer.DisplayName || customer.CompanyName || '').toLowerCase();
        return candidate.includes(normalized) || normalized.includes(candidate);
      });
      if (matchedCustomer) {
        customerRef = { value: matchedCustomer.Id, name: matchedCustomer.DisplayName || matchedCustomer.CompanyName };
        break;
      }

      if (valueMappings.length > 0) {
        const vmResult = resolveValueMapping(
          rawCustomer,
          'name',
          valueMappings,
          (id) => customers.find((customer) => customer.Id === id),
          'customer',
        );
        if (vmResult.matched) {
          customerRef = { value: vmResult.entityId, name: vmResult.entityName || undefined };
          break;
        }
      }
    }
  }

  const buildFixedChequeLine = (lineItem: Record<string, unknown>): QBChequeLineItem[] => {
    const amount = parseNumericValue(lineItem.amount ?? lineItem.Amount);
    if (amount === 0) return [];

    const category = String(lineItem.category ?? lineItem.Category ?? '').trim();
    const description = String(lineItem.description ?? lineItem.Description ?? category).trim();
    let accountId = '';
    if (category) {
      const mapping = resolveMapping(decoded, category, lineItem as unknown as ScanData);
      if (mapping?.accountId) {
        accountId = mapping.accountId;
      } else {
        const vmResult = resolveValueMapping(
          category,
          'account',
          valueMappings,
          (id) => accounts.find((a) => a.Id === id),
          'category',
        );
        if (vmResult.matched) {
          accountId = vmResult.entityId;
        }
      }
    }

    const taxType = String(lineItem.taxType ?? lineItem.TaxType ?? '').trim();
    let taxCodeRef;
    if (taxType && valueMappings.length > 0) {
      const vmResult = resolveValueMapping(
        taxType,
        'taxCode',
        valueMappings,
        (id) => taxCodes?.find((t) => t.Id === id),
        'taxType',
      );
      if (vmResult.matched) {
        taxCodeRef = { value: vmResult.entityId, name: vmResult.entityName ?? undefined };
      }
    }

    const accountName = accounts.find((a) => a.Id === accountId)?.FullyQualifiedName ?? '';
    const classId = resolveMapping(decoded, category, lineItem as unknown as ScanData)?.classId;

    return [{
      amount: Math.abs(amount),
      accountRef: { value: accountId, name: accountName || undefined },
      description: description || undefined,
      classRef: classId ? { value: classId } : undefined,
      ...(taxCodeRef ? { taxCodeRef } : {}),
    } as QBChequeLineItem & { taxCodeRef?: { value: string; name?: string } }];
  };

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
            field,
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
      if (Object.prototype.hasOwnProperty.call(lineItem, 'category')) {
        lines.push(...buildFixedChequeLine(lineItem));
      } else {
        const itemFields = Object.fromEntries(
          Object.entries(lineItem)
            .map(([key, value]) => [key, parseNumericValue(value)])
            .filter(([, value]) => !Number.isNaN(value)),
        ) as ScanData;

        lines.push(...buildLines(itemFields));
      }
    }
  } else {
    lines.push(...buildLines(scanData));
  }

  if (lines.length === 0) return null;

  const amount = lines.reduce((sum, line) => sum + line.amount, 0);
  const headerBank = scanEntry?.header?.['bankAccount'] as string | undefined;
  const headerDate = scanEntry?.header?.['paymentDate'] as string | undefined;
  const headerCheckNo = scanEntry?.header?.['checkNo'] as string | undefined;
  const rawPayee = String(scanEntry?.header?.payeeName ?? scanEntry?.header?.['payee'] ?? scanEntry?.header?.vendor ?? '').trim();
  const rawBank = String(scanEntry?.header?.bankAccount ?? scanEntry?.header?.['bankName'] ?? '').trim();
  const rawMemo = '';

  let payeeRef = defaults.payeeRef ?? undefined;
  if (rawPayee && valueMappings.length > 0) {
    const vmResult = resolveValueMapping(
      rawPayee,
      'name',
      valueMappings,
      (id) => vendors?.find((v) => v.Id === id),
      'payee',
    );
    if (vmResult.matched) {
      payeeRef = { value: vmResult.entityId, name: vmResult.entityName || undefined };
    }
  }

  let bankAccountRef = defaults.bankAccountRef ?? undefined;
  if (rawBank && valueMappings.length > 0) {
    const vmResult = resolveValueMapping(
      rawBank,
      'account',
      valueMappings,
      (id) => accounts.find((a) => a.Id === id),
      'bankAccount',
    );
    if (vmResult.matched) {
      bankAccountRef = { value: vmResult.entityId, name: vmResult.entityName || undefined };
    }
  }

  const matchedBank = !bankAccountRef && headerBank
    ? accounts.find((a) => a.Name.toLowerCase().includes(headerBank.toLowerCase()))
    : undefined;

  const finalBankAccountRef = bankAccountRef || (matchedBank ? { value: matchedBank.Id, name: matchedBank.FullyQualifiedName || undefined } : undefined);

  const memo = rawMemo || defaults.qbMemo?.value || defaults.memo?.value;

  const finalScanRecordId = scanEntry?.scanRecordId ?? scanRecordId;

  return {
    scanRecordId: finalScanRecordId,
    transactionType: 'CHEQUE',
    txnDate: headerDate || txnDate,
    lines,
    bankAccountRef: finalBankAccountRef,
    payeeRef,
    customerRef,
    amount,
    memo,
    docNumber: headerCheckNo || defaults.docNumber?.value,
  };
}