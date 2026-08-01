import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { extractLineItems, getAutoFillSummary, evaluateProductMatch } from '../lib/column-extractor';
import { resolveValueMapping } from '../lib/resolve-value-mapping';
import { useLocations } from '../hooks/useLocations';
import { useQuickBooks } from '../hooks/useQuickBooks';
import { useQBContext } from '../contexts/QBContext';
import SearchableSelect from './SearchableSelect';
import SmartDatePicker from './SmartDatePicker';
import ErrorCard from './shared/ErrorCard';
import type { ExtractedLineItem, ScanData, ScanEntry, Mapping, Template, PayeeMapping, ValueMapping } from '../../types';
import type { SelectOption } from './SearchableSelect';
import type { QBAccount } from '../types/qb';
import { decodeMapping } from '../lib/je-builder';
import { resolveMapping } from '../lib/mapping-conditions';
import { parseNumericValue } from '../lib/parse-numeric-value';

interface BillLine {
  localId: string;
  accountId: string;
  accountName: string;
  description: string;
  classId: string;
  taxCodeId: string;
  amount: string;
}

function newLine(overrides?: Partial<BillLine>): BillLine {
  return {
    localId: `line-${Date.now()}-${Math.random()}`,
    accountId: '',
    accountName: '',
    description: '',
    classId: '',
    taxCodeId: '',
    amount: '',
    ...overrides,
  };
}

function toYMD(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

function parseScanDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const textual = Date.parse(trimmed);
  if (!isNaN(textual)) {
    return toYMD(new Date(textual));
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    const [, numA, numB, yearStr] = slashMatch;
    let year = yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);
    const a = parseInt(numA, 10);
    const b = parseInt(numB, 10);

    if (a > 12) {
      return `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
    if (b > 12) {
      return `${year}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    }
    return `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }

  return undefined;
}

function fmt(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  jwt: string;
  scanData: ScanData | null;
  activeScanEntry?: ScanEntry | null;
  selectedLocationId: string;
  scanRecordId?: string | null;
  selectedTemplate?: Template | null;
  onNavigateToPayments?: () => void;
  userRole?: string;
  attachments?: Array<{ id: string; fileName: string; fileSize: number; mimeType: string; createdAt: string }>;
}

export default function BillPreviewForm({
  jwt,
  scanData,
  activeScanEntry,
  selectedLocationId,
  scanRecordId,
  selectedTemplate,
  onNavigateToPayments,
  userRole,
  attachments,
}: Props) {
  const { status, connect } = useQuickBooks(jwt);
  const { locations } = useLocations(jwt);
  const {
    accounts,
    classes,
    vendors,
    taxCodes,
    terms,
    listsLoaded,
    listsLoading,
    listsError,
    syncAllLists,
  } = useQBContext();

  const today = toYMD(new Date());
  const [txnDate, setTxnDate] = useState(today);
  const [vendorRef, setVendorRef] = useState<{ value: string; name?: string }>({ value: '' });
  const [valueMappings, setValueMappings] = useState<ValueMapping[]>([]);
  const [payeeMappings, setPayeeMappings] = useState<PayeeMapping[]>([]);
  const [apAccountRef, setApAccountRef] = useState<{ value: string; name?: string }>({ value: '' });
  const [termsRef, setTermsRef] = useState<{ value: string; name?: string }>({ value: '' });
  const [defaultTaxCodeId, setDefaultTaxCodeId] = useState('');
  const [dueDate, setDueDate] = useState(today);
  const [memo, setMemo] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [lines, setLines] = useState<BillLine[]>([newLine(), newLine()]);
  const [savedMappings, setSavedMappings] = useState<Mapping[]>([]);
  const [mappingsLoaded, setMappingsLoaded] = useState(false);
  const [ruleTransformedLineItems, setRuleTransformedLineItems] = useState<Record<string, string>[] | null>(null);
  const [autoFillSummary, setAutoFillSummary] = useState<{ total: number; mapped: number; unmapped: number } | null>(null);
  const [unmatchedItems, setUnmatchedItems] = useState<{ productName: string }[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ id: string; txnDate: string; docNumber?: string; skipped?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [approvalSubmitted, setApprovalSubmitted] = useState(false);
  const canSyncDirectly = !userRole || userRole === 'ADMIN' || userRole === 'OWNER' || userRole === 'MANAGER';

  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const userHasEditedLinesRef = useRef(false);

  const locId = selectedLocationId || locations[0]?.id || '';

  useEffect(() => {
    userHasEditedLinesRef.current = false;
  }, [activeScanEntry]);

  useEffect(() => {
    if (!activeScanEntry) {
      return;
    }
    if (activeScanEntry.source === 'pos') {
      return;
    }
    if (!selectedTemplate?.columnMappings || !selectedTemplate?.id) {
      return;
    }
    if (!jwt || !locId) return;
    if (userHasEditedLinesRef.current) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const productMappings = await api.getProductMappings(jwt, selectedTemplate.id);
        if (cancelled) return;
        const itemsToExtract = ruleTransformedLineItems ?? activeScanEntry.lineItems ?? [];
        const extracted = extractLineItems({
          lineItems: itemsToExtract,
          columnMappings: selectedTemplate.columnMappings,
          productMappings,
          defaultPostingType: 'Credit',
        });
        if (cancelled) return;

        setLines(extracted.map((item) => newLine({
          accountId: item.accountId,
          accountName: item.accountName || accountsRef.current.find((a) => a.Id === item.accountId)?.FullyQualifiedName || '',
          description: item.description,
          classId: item.classId ?? '',
          taxCodeId: item.taxCodeId ?? '',
          amount: item.amount.toFixed(2),
        })));
        setAutoFillSummary(getAutoFillSummary(extracted));
        setUnmatchedItems(extracted.filter((item) => !item.matched).map((item) => ({ productName: item.productName })));
      } catch (err) {
        console.error('Auto-fill error:', err);
        // silent fallback: user can still click Auto-fill
      }
    })();

    return () => { cancelled = true; };
  }, [activeScanEntry, selectedTemplate, jwt, locId, ruleTransformedLineItems]);

  useEffect(() => {
    if (!listsLoaded && !listsLoading && !listsError) {
      void syncAllLists();
    }
  }, [listsLoaded, listsLoading, listsError, syncAllLists]);

  useEffect(() => {
    if (!jwt || !locId) return;
    setMappingsLoaded(false);
    api.getMappings(jwt, locId)
      .then((mappings) => {
        setSavedMappings(mappings);
        setMappingsLoaded(true);
      })
      .catch((err) => {
        console.error('[Bill Preview] Failed to load mappings:', err);
        setMappingsLoaded(true);
      });
  }, [jwt, locId]);

  useEffect(() => {
    if (!jwt || !locId || !activeScanEntry?.lineItems?.length) return;
    if (!selectedTemplate?.id) return;

    const apply = async () => {
      try {
        const rules = await api.getRules(jwt, locId, selectedTemplate?.id);
        const activeRules = rules.filter((r) => r.isActive);
        if (activeRules.length === 0) {
          setRuleTransformedLineItems(null);
          return;
        }

        const result = await api.applyRules(jwt, {
          lineItems: activeScanEntry.lineItems,
          rules: activeRules,
        });
        if (result.type === 'lineItems') {
          setRuleTransformedLineItems(result.data);
        }
      } catch (err) {
        console.error('[Bill Preview] Failed to apply rules:', err);
      }
    };

    void apply();
  }, [jwt, locId, activeScanEntry, selectedTemplate?.id]);

  useEffect(() => {
    if (!scanData || !locId) return;
    const loc = locations.find((location) => location.id === locId);
    if (!loc) return;
    const memoTemplate = loc.memoTemplate;
    const docNumberTemplate = loc.docNumberTemplate;

    if (memoTemplate) {
      setMemo((prev) => prev || memoTemplate.replace(/\{(\w+)\}/g, (match, field: string) => {
        const key = Object.keys(scanData).find((k) => k.toLowerCase().replace(/\s+/g, '_') === field.toLowerCase());
        return key !== undefined ? String(scanData[key]) : match;
      }));
    }

    if (docNumberTemplate) {
      setDocNumber((prev) => prev || docNumberTemplate.replace(/\{(\w+)\}/g, (match, field: string) => {
        const key = Object.keys(scanData).find((k) => k.toLowerCase().replace(/\s+/g, '_') === field.toLowerCase());
        return key !== undefined ? String(scanData[key]) : match;
      }));
    }
  }, [scanData, locId, locations]);

  useEffect(() => {
    if (!selectedTemplate || selectedTemplate.transactionType !== 'BILL') return;
    const defaults = selectedTemplate.defaults as Record<string, { value: string; name?: string } | null> | null;
    if (!defaults) return;

    if (defaults.vendorRef) setVendorRef(defaults.vendorRef);
    if (defaults.apAccountRef) setApAccountRef(defaults.apAccountRef);
    if (defaults.termsRef) setTermsRef(defaults.termsRef);
    if (defaults.dueDate?.value) setDueDate(defaults.dueDate.value);
    if (defaults.memo?.value) setMemo(defaults.memo.value);
    if (defaults.docNumber?.value) setDocNumber(defaults.docNumber.value);
    if (defaults.taxCodeRef?.value) setDefaultTaxCodeId(defaults.taxCodeRef.value);
  }, [selectedTemplate]);

  useEffect(() => {
    if (!jwt || !selectedTemplate?.id) return;
    api.getValueMappings(jwt, selectedTemplate.id)
      .then(setValueMappings)
      .catch(() => {});
  }, [jwt, selectedTemplate?.id]);

  useEffect(() => {
    if (!jwt || !selectedTemplate?.id) return;
    api.getPayeeMappings(jwt, selectedTemplate.id)
      .then(setPayeeMappings)
      .catch(() => {});
  }, [jwt, selectedTemplate?.id]);

  useEffect(() => {
    if (!activeScanEntry) return;
    if (activeScanEntry.source === 'pos') return;
    const h = activeScanEntry.header;
    if (!h || !Object.keys(h).length) return;

    setVendorRef((prev) => {
      if (prev.value) return prev;
      const vendorName = (h.vendor || '').trim();
      if (!vendorName) return prev;

      const vmResult = resolveValueMapping(
        vendorName,
        'name',
        valueMappings,
        (id) => {
          if (id.startsWith('vendor:')) return vendors.find((v) => v.Id === id.replace('vendor:', ''));
          return undefined;
        },
      );
      if (vmResult.matched && vmResult.entityId.startsWith('vendor:')) {
        const vendorId = vmResult.entityId.replace('vendor:', '');
        const vendor = vendors.find((v) => v.Id === vendorId);
        if (vendor) return { value: vendor.Id, name: vendor.DisplayName };
      }

      if (payeeMappings.length > 0) {
        let bestMatch: PayeeMapping | null = null;
        let bestConfidence = 0;
        for (const mapping of payeeMappings) {
          const result = evaluateProductMatch(vendorName, mapping.scannedName, mapping.matchingRule);
          if (result.matched && result.confidence > bestConfidence) {
            bestMatch = mapping;
            bestConfidence = result.confidence;
          }
        }
        if (bestMatch) {
          const vendor = vendors.find((v) => v.Id === bestMatch!.vendorId);
          if (vendor) return { value: vendor.Id, name: vendor.DisplayName };
        }
      }

      const lower = vendorName.toLowerCase();
      const match = vendors.find((v) => {
        if (v.DisplayName.toLowerCase() === lower) return true;
        if (v.CompanyName?.toLowerCase() === lower) return true;
        if (v.DisplayName.toLowerCase().includes(lower)) return true;
        if (v.CompanyName?.toLowerCase()?.includes(lower)) return true;
        if (lower.includes(v.DisplayName.toLowerCase())) return true;
        if (v.CompanyName && lower.includes(v.CompanyName.toLowerCase())) return true;
        return false;
      });
      if (match) return { value: match.Id, name: match.DisplayName };
      return prev;
    });

    setDocNumber((prev) => {
      if (prev) return prev;
      return (h.invoiceNumber || '').trim() || prev;
    });

    const parsedDate = parseScanDate(h.invoiceDate);
    if (parsedDate) {
      setTxnDate((prev) => {
        if (prev && prev !== toYMD(new Date())) return prev;
        return parsedDate;
      });
    }

    const parsedDue = parseScanDate(h.dueDate);
    if (parsedDue) {
      setDueDate((prev) => {
        if (prev && prev !== toYMD(new Date())) return prev;
        return parsedDue;
      });
    }

    if (h.total) {
      setMemo((prev) => {
        if (prev) return prev;
        return `Invoice total: ${h.total}`;
      });
    }
  }, [activeScanEntry, vendors, payeeMappings, valueMappings]);

  useEffect(() => {
    if (!mappingsLoaded) return;
    if (activeScanEntry?.source === 'image' || activeScanEntry?.source === 'pdf') return;
    const decoded = savedMappings.map(decodeMapping);
    const scanFields: Record<string, number> = activeScanEntry
      ? Object.fromEntries(
        Object.entries(activeScanEntry.lineItems?.[0] ?? {})
          .map(([key, value]) => [key, parseNumericValue(value)])
          .filter(([, v]) => !Number.isNaN(v)),
      ) as Record<string, number>
      : scanData ?? {};

    const billLines = Object.entries(scanFields)
      .filter(([, amount]) => amount !== 0)
      .map(([field, amount]) => {
        const mapping = resolveMapping(decoded, field, scanFields);
        const accountId = mapping?.accountId ?? '';
        const accountName = accountsRef.current.find((a) => a.Id === accountId)?.FullyQualifiedName ?? '';
        return newLine({
          accountId,
          accountName,
          description: mapping?.description ?? field,
          classId: mapping?.classId ?? '',
          amount: Math.abs(amount).toFixed(2),
        });
      });

    if (billLines.length > 0) {
      setLines(billLines);
    }
  }, [activeScanEntry, scanData, savedMappings, mappingsLoaded]);

  const vendorOptions = useMemo(() =>
    vendors
      .filter((vendor) => vendor.Active)
      .map((vendor) => ({ value: vendor.Id, label: vendor.DisplayName, subtitle: vendor.CompanyName ?? undefined })),
    [vendors],
  );

  const apAccountOptions = useMemo(() =>
    accounts
      .filter((account) => account.Active && (account.AccountType === 'Accounts Payable' || account.AccountSubType === 'AccountsPayable'))
      .map((account) => ({ value: account.Id, label: account.FullyQualifiedName, subtitle: account.AccountSubType })),
    [accounts],
  );

  useEffect(() => {
    if (apAccountOptions.length === 1 && !apAccountRef.value) {
      setApAccountRef({ value: apAccountOptions[0].value, name: apAccountOptions[0].label });
    }
  }, [apAccountOptions, apAccountRef.value]);

  const accountOptions = useMemo(() =>
    accounts
      .filter((account) => account.Active)
      .map((account) => ({ value: account.Id, label: account.FullyQualifiedName, subtitle: account.AccountSubType, group: account.Classification || account.AccountType })),
    [accounts],
  );

  const classOptions = useMemo(() =>
    classes.filter((item) => item.Active).map((item) => ({ value: item.Id, label: item.FullyQualifiedName })),
    [classes],
  );

  const taxCodeOptions = useMemo(() =>
    taxCodes.filter((item) => item.Active).map((item) => ({ value: item.Id, label: item.Name, subtitle: item.Description })),
    [taxCodes],
  );

  const updateLine = (localId: string, patch: Partial<BillLine>) => {
    userHasEditedLinesRef.current = true;
    setLines((prev) => prev.map((line) => (line.localId === localId ? { ...line, ...patch } : line)));
  };

  const removeLine = (localId: string) => {
    userHasEditedLinesRef.current = true;
    setLines((prev) => prev.filter((line) => line.localId !== localId));
  };

  const addLine = () => {
    userHasEditedLinesRef.current = true;
    setLines((prev) => [...prev, newLine({ taxCodeId: defaultTaxCodeId })]);
  };

  const effectiveLines = lines;
  const totalAmount = effectiveLines.reduce((sum, line) => sum + (parseFloat(line.amount) || 0), 0);
  const unmappedCount = effectiveLines.filter((line) => parseFloat(line.amount) > 0 && !line.accountId).length;
  const hasAmount = effectiveLines.some((line) => parseFloat(line.amount) > 0);
  const allMapped = unmappedCount === 0 && hasAmount;
  const hasHeader = Boolean(vendorRef.value && apAccountRef.value);

  const inactiveWarnings: string[] = [];
  effectiveLines.forEach((line, i) => {
    if (line.accountId) {
      const account = accounts.find((a) => a.Id === line.accountId);
      if (account && !account.Active) {
        inactiveWarnings.push(`Line ${i + 1}: Account "${account.FullyQualifiedName}" is inactive`);
      }
    }
  });
  effectiveLines.forEach((line, i) => {
    if (line.classId) {
      const cls = classes.find((c) => c.Id === line.classId);
      if (cls && !cls.Active) {
        inactiveWarnings.push(`Line ${i + 1}: Class "${cls.FullyQualifiedName}" is inactive`);
      }
    }
  });
  if (vendorRef.value) {
    const vendor = vendors.find((v) => v.Id === vendorRef.value);
    if (vendor && !vendor.Active) {
      inactiveWarnings.push(`Vendor "${vendor.DisplayName}" is inactive`);
    }
  }

  const scannedTotal = activeScanEntry?.header?.total
    ? parseFloat(String(activeScanEntry.header.total).replace(/[^0-9.\-]/g, ''))
    : null;
  const totalMismatch = scannedTotal !== null && totalAmount > 0 && Math.abs(totalAmount - scannedTotal) > 0.01
    ? Math.abs(totalAmount - scannedTotal)
    : null;

  const handleClearAll = () => {
    setTxnDate(today);
    setVendorRef({ value: '' });
    setApAccountRef({ value: '' });
    setTermsRef({ value: '' });
    setDueDate(today);
    setMemo('');
    setDocNumber('');
    setLines([newLine(), newLine()]);
    userHasEditedLinesRef.current = false;
    setError(null);
    setSyncResult(null);
    setAutoFillSummary(null);
    setUnmatchedItems([]);
    setRuleTransformedLineItems(null);
  };


  const handleSync = useCallback(async (skipDedupCheck = false) => {
    if (!hasHeader || !allMapped || !hasAmount) return;
    setSyncing(true);
    setError(null);
    setDuplicateWarning(null);
    setSyncResult(null);

    try {
      const billLines = effectiveLines
        .filter((line) => parseFloat(line.amount) > 0)
        .map((line) => ({
          amount: parseFloat(line.amount),
          accountRef: { value: line.accountId, name: line.accountName || undefined },
          description: line.description || undefined,
          classRef: line.classId ? { value: line.classId } : undefined,
          taxCodeRef: line.taxCodeId ? { value: line.taxCodeId } : undefined,
        }));

      const result = await api.createBill(
        jwt,
        txnDate,
        vendorRef,
        apAccountRef,
        termsRef.value ? termsRef : undefined,
        dueDate || undefined,
        memo || undefined,
        docNumber || undefined,
        billLines,
        scanRecordId ?? undefined,
        skipDedupCheck,
      ) as { billId?: string; qbJournalEntryId?: string; txnDate?: string; docNumber?: string; skipped?: boolean };

      setSyncResult({ id: result.billId ?? result.qbJournalEntryId ?? '', txnDate: result.txnDate ?? txnDate, skipped: Boolean(result.skipped), docNumber: result.docNumber });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDuplicateWarning(err.payload?.error ?? err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Bill sync failed');
      }
    } finally {
      setSyncing(false);
    }
  }, [allMapped, apAccountRef, dueDate, effectiveLines, hasAmount, hasHeader, jwt, memo, scanRecordId, termsRef, txnDate, docNumber, vendorRef]);

  const handleSubmitForApproval = useCallback(async () => {
    if (!scanRecordId) {
      setError('No scan record to submit');
      return;
    }
    setSyncing(true);
    setError(null);
    setApprovalSubmitted(false);
    try {
      await api.submitScanForApproval(jwt, scanRecordId);
      setApprovalSubmitted(true);
      setSyncResult({ id: '', txnDate: '', skipped: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit for approval');
    } finally {
      setSyncing(false);
    }
  }, [jwt, scanRecordId]);

  const handleForceSync = useCallback(() => {
    if (!hasHeader || !allMapped || !hasAmount) return;
    void handleSync(true);
  }, [handleSync, hasHeader, allMapped, hasAmount]);

  if (!status.connected) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <div className="text-4xl mb-3">🔗</div>
        <p className="text-gray-600 text-sm mb-1">QuickBooks not connected</p>
        <p className="text-gray-600 text-xs mb-4">Connect QuickBooks in Settings to sync bills</p>
        <button onClick={connect} className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg">
          Connect QuickBooks
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs px-3 py-1.5 bg-emerald-50/20 border border-emerald-200 rounded-lg">
        <span className="text-emerald-600">✅ QB Connected</span>
        <span className="text-gray-600 truncate">{status.realmId}</span>
        <button
          onClick={() => void syncAllLists()}
          disabled={listsLoading}
          className="ml-auto text-gray-600 hover:text-gray-600 transition-colors"
          title="Refresh QB lists"
        >
          {listsLoading ? '…' : '↻'}
        </button>
      </div>
      {attachments && attachments.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-500 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <span>📎</span>
          <span>{attachments.length} attachment{attachments.length > 1 ? 's' : ''}: {attachments.map((a) => a.fileName).join(', ')}</span>
        </div>
      )}
      {listsError && (
        <ErrorCard message={listsError} onRetry={() => void syncAllLists()} variant="warning" />
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-3 grid grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-medium text-gray-700 mb-1">Transaction Date</div>
          <SmartDatePicker value={txnDate} onChange={setTxnDate} />
        </div>
        <div>
          <div className="text-sm font-medium text-gray-700 mb-1">Vendor</div>
          <SearchableSelect
            options={vendorOptions}
            value={vendorRef.value}
            onChange={(value) => {
              const selected = vendors.find((v) => v.Id === value);
              setVendorRef({ value, name: selected?.DisplayName });
            }}
            placeholder="Select vendor…"
          />
        </div>
        <div>
          <div className="text-sm font-medium text-gray-700 mb-1">AP Account</div>
          <SearchableSelect
            options={apAccountOptions}
            value={apAccountRef.value}
            onChange={(value) => {
              const selected = accounts.find((a) => a.Id === value);
              setApAccountRef({ value, name: selected?.FullyQualifiedName });
            }}
            placeholder="Accounts Payable"
          />
        </div>
        <div>
          <div className="text-sm font-medium text-gray-700 mb-1">Due Date</div>
          <SmartDatePicker value={dueDate} onChange={setDueDate} />
        </div>
        <div className="col-span-2">
          <div className="text-sm font-medium text-gray-700 mb-1">Terms</div>
          {terms.length > 0 ? (
            <select
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white text-gray-900 focus:border-emerald-500 focus:outline-none"
              value={termsRef.value}
              onChange={(e) => {
                const selected = terms.find((term) => term.Id === e.target.value);
                setTermsRef({ value: e.target.value, name: selected?.Name });
              }}
            >
              <option value="" disabled>Select terms…</option>
              {terms.map((term) => (
                <option key={term.Id} value={term.Id}>{term.Name}</option>
              ))}
            </select>
          ) : (
            <input
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white text-gray-900 focus:border-emerald-500 focus:outline-none"
              value={termsRef.value}
              onChange={(e) => setTermsRef({ value: e.target.value })}
              placeholder="Terms reference…"
            />
          )}
        </div>
        <div className="col-span-2">
          <div className="text-sm font-medium text-gray-700 mb-1">Memo / Private Note</div>
          <input
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white text-gray-900 focus:border-emerald-500 focus:outline-none"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={`Nest sync — ${txnDate}`}
          />
        </div>
        <div className="col-span-2">
          <div className="text-sm font-medium text-gray-700 mb-1">Bill No.</div>
          <input
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white text-gray-900 focus:border-emerald-500 focus:outline-none"
            value={docNumber}
            onChange={(e) => setDocNumber(e.target.value)}
            placeholder="Optional bill number"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="flex flex-col gap-2 px-3 py-3 border-b border-gray-200 sm:flex-row sm:items-center sm:justify-between">
          {autoFillSummary ? (
            <div className="text-xs text-gray-600">
              {autoFillSummary.total} items: {autoFillSummary.mapped} mapped, {autoFillSummary.unmapped} unmapped
            </div>
          ) : null}
        </div>
        {unmatchedItems.length > 0 && (
          <details className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <summary className="text-xs font-medium text-amber-400 cursor-pointer select-none">
              {unmatchedItems.length} unmatched product{unmatchedItems.length !== 1 ? 's' : ''}
            </summary>
            <div className="mt-2 space-y-1">
              {unmatchedItems.map((item, idx) => (
                <div key={idx} className="text-xs text-gray-600">• {item.productName}</div>
              ))}
            </div>
          </details>
        )}
        <div className="overflow-x-auto overflow-y-auto max-h-[320px]">
          <table className="w-full text-sm border-collapse min-w-[680px]">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-3 w-8">#</th>
                <th className="text-left px-3 py-3 min-w-[180px]">Account</th>
                <th className="text-left px-3 py-3 min-w-[160px]">Description</th>
                <th className="text-left px-3 py-3 min-w-[120px]">Class</th>
                <th className="text-left px-3 py-3 min-w-[120px]">Tax Code</th>
                <th className="text-right px-3 py-3 w-24">Amount</th>
                <th className="text-center px-3 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {effectiveLines.map((line, idx) => (
                <tr key={line.localId} className={`border-b border-gray-200 ${idx % 2 === 1 ? 'bg-gray-50' : ''}`}>
                  <td className="px-3 py-2 text-gray-600 text-center text-xs">{idx + 1}</td>
                  <td className="px-3 py-2 min-w-[180px] max-w-[240px]">
                    <SearchableSelect
                      options={accountOptions}
                      value={line.accountId}
                      onChange={(value) => {
                        const account = accounts.find((a) => a.Id === value);
                        updateLine(line.localId, { accountId: value, accountName: account?.FullyQualifiedName ?? '' });
                      }}
                      placeholder="Account…"
                    />
                  </td>
                  <td className="px-3 py-2 min-w-[160px]">
                    <input
                      className="w-full bg-[#F5F5F7] border border-gray-200 text-gray-600 text-sm rounded-md px-3 py-2 focus:border-emerald-500 focus:outline-none"
                      value={line.description}
                      onChange={(e) => updateLine(line.localId, { description: e.target.value })}
                      placeholder="Description…"
                      maxLength={4000}
                    />
                  </td>
                  <td className="px-3 py-2 min-w-[120px] max-w-[160px]">
                    <SearchableSelect
                      options={classOptions}
                      value={line.classId}
                      onChange={(value) => updateLine(line.localId, { classId: value })}
                      placeholder="Class…"
                    />
                  </td>
                  <td className="px-3 py-2 min-w-[120px] max-w-[160px]">
                    <SearchableSelect
                      options={taxCodeOptions}
                      value={line.taxCodeId}
                      onChange={(value) => updateLine(line.localId, { taxCodeId: value })}
                      placeholder="Tax Code…"
                    />
                  </td>
                  <td className="px-3 py-2 text-right w-24">
                    <input
                      className="w-full bg-[#F5F5F7] border border-gray-200 text-gray-600 text-sm rounded-md px-3 py-2 text-right focus:border-emerald-500 focus:outline-none"
                      value={line.amount}
                      onChange={(e) => updateLine(line.localId, { amount: e.target.value })}
                      placeholder="0.00"
                      inputMode="decimal"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeLine(line.localId)}
                      className="text-gray-600 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={effectiveLines.length <= 1}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-300 bg-gray-100 font-semibold">
                <td className="px-3 py-3 text-gray-600">{effectiveLines.length}</td>
                <td colSpan={4} className="px-3 py-3 text-gray-600">Total</td>
                <td className="px-3 py-3 text-right font-mono text-emerald-300">${fmt(totalAmount)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <button
        type="button"
        onClick={addLine}
        className="w-full text-xs text-gray-600 hover:text-gray-600 border border-dashed border-gray-200 hover:border-gray-300 py-1.5 rounded-lg transition-colors"
      >
        + Add Line
      </button>

      {duplicateWarning && (
        <ErrorCard
          variant="warning"
          message={duplicateWarning}
          onDismiss={() => setDuplicateWarning(null)}
          onRetry={handleForceSync}
        />
      )}
      {inactiveWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg px-3 py-2 space-y-1">
          <div className="font-medium">⚠️ Inactive entity warnings:</div>
          {inactiveWarnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}
      {totalMismatch !== null && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg px-3 py-2">
          ⚠️ Line items total (${totalAmount.toFixed(2)}) does not match scanned total ({scannedTotal!.toFixed(2)}). Difference: {totalMismatch.toFixed(2)}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {approvalSubmitted ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 mt-4">
          <div className="text-blue-800 font-semibold">✅ Submitted for Approval</div>
          <div className="text-blue-600 text-sm mt-1">Your sync is pending manager review.</div>
        </div>
      ) : syncResult && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-600 text-xs rounded-lg px-3 py-2 space-y-1.5">
          <div>{syncResult.skipped ? '✅ Bill already synced' : '✅ Bill created'} — <span className="font-mono">{syncResult.id}</span></div>
          {syncResult.docNumber && <div>Bill # {syncResult.docNumber}</div>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(syncResult.id).catch(() => {})}
              className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800 hover:border-emerald-600 px-2 py-0.5 rounded transition-colors"
            >
              Copy ID
            </button>
            <a
              href={`${status.environment === 'sandbox' ? 'https://app.sandbox.qbo.intuit.com' : 'https://app.qbo.intuit.com'}/app/bill?txnId=${syncResult.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-400 hover:underline"
            >
              View in QuickBooks ↗
            </a>
            {onNavigateToPayments && (
              <button
                type="button"
                onClick={onNavigateToPayments}
                className="text-xs text-white bg-emerald-700 hover:bg-emerald-600 px-2 py-0.5 rounded transition-colors"
              >
                Pay this bill → Payments
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleClearAll}
          className="px-3 py-2 text-xs text-red-600 border border-red-300 hover:bg-red-50/20 rounded-lg transition-colors"
        >
          Clear All
        </button>
        <button
          type="button"
          onClick={canSyncDirectly ? () => void handleSync() : () => void handleSubmitForApproval()}
          disabled={syncing || !hasHeader || !allMapped || !hasAmount}
          className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-200 disabled:text-gray-600 text-white text-sm font-bold rounded-lg transition-colors"
        >
          {syncing
            ? (canSyncDirectly ? 'Syncing Bill…' : 'Submitting…')
            : !hasHeader
              ? '⚠️ Vendor and AP account required'
              : !hasAmount
                ? '⚠️ Add bill amounts'
                : !allMapped
                  ? '⚠️ Assign all line accounts'
                  : (canSyncDirectly ? '⚡ Sync Bill to QuickBooks' : '📋 Submit for Approval')}
        </button>
      </div>
    </div>
  );
}
