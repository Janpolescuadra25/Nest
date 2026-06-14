import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { extractLineItems, getAutoFillSummary } from '../lib/column-extractor';
import { useLocations } from '../hooks/useLocations';
import { useQuickBooks } from '../hooks/useQuickBooks';
import { useQBContext } from '../contexts/QBContext';
import SearchableSelect from './SearchableSelect';
import SmartDatePicker from './SmartDatePicker';
import ErrorCard from './shared/ErrorCard';
import type { ExtractedLineItem, ScanData, ScanEntry, Mapping, Template } from '../../types';
import type { SelectOption } from './SearchableSelect';
import type { QBAccount } from '../types/qb';
import { decodeMapping } from '../lib/je-builder';
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
}

export default function BillPreviewForm({
  jwt,
  scanData,
  activeScanEntry,
  selectedLocationId,
  scanRecordId,
  selectedTemplate,
  onNavigateToPayments,
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
  const [apAccountRef, setApAccountRef] = useState<{ value: string; name?: string }>({ value: '' });
  const [termsRef, setTermsRef] = useState<{ value: string; name?: string }>({ value: '' });
  const [dueDate, setDueDate] = useState(today);
  const [memo, setMemo] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [lines, setLines] = useState<BillLine[]>([newLine(), newLine()]);
  const [savedMappings, setSavedMappings] = useState<Mapping[]>([]);
  const [mappingsLoaded, setMappingsLoaded] = useState(false);
  const [ruleTransformedLineItems, setRuleTransformedLineItems] = useState<Record<string, string>[] | null>(null);
  const [autoFillSummary, setAutoFillSummary] = useState<{ total: number; mapped: number; unmapped: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ id: string; txnDate: string; docNumber?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  useEffect(() => {
    if (!listsLoaded && !listsLoading && !listsError) {
      void syncAllLists();
    }
  }, [listsLoaded, listsLoading, listsError, syncAllLists]);

  const locId = selectedLocationId || locations[0]?.id || '';

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
  }, [selectedTemplate]);

  useEffect(() => {
    if (!activeScanEntry) return;
    if (activeScanEntry.source !== 'image' && activeScanEntry.source !== 'pdf') return;
    const h = activeScanEntry.header;
    if (!h || !Object.keys(h).length) return;

    setVendorRef((prev) => {
      if (prev.value) return prev;
      const vendorName = (h.vendor || '').trim();
      if (!vendorName) return prev;
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
  }, [activeScanEntry, vendors]);

  useEffect(() => {
    if (!mappingsLoaded) return;
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
        const mapping = decoded.find((m) => m.sourceField === field);
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
      .filter((account) => account.Active)
      .map((account) => ({ value: account.Id, label: account.FullyQualifiedName, subtitle: account.AccountSubType })),
    [accounts],
  );

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

  const updateLine = (localId: string, patch: Partial<BillLine>) =>
    setLines((prev) => prev.map((line) => (line.localId === localId ? { ...line, ...patch } : line)));

  const removeLine = (localId: string) =>
    setLines((prev) => prev.filter((line) => line.localId !== localId));

  const addLine = () => setLines((prev) => [...prev, newLine()]);

  const effectiveLines = lines;
  const totalAmount = effectiveLines.reduce((sum, line) => sum + (parseFloat(line.amount) || 0), 0);
  const unmappedCount = effectiveLines.filter((line) => parseFloat(line.amount) > 0 && !line.accountId).length;
  const hasAmount = effectiveLines.some((line) => parseFloat(line.amount) > 0);
  const allMapped = unmappedCount === 0 && hasAmount;
  const hasHeader = Boolean(vendorRef.value && apAccountRef.value);

  const handleClearAll = () => {
    setTxnDate(today);
    setVendorRef({ value: '' });
    setApAccountRef({ value: '' });
    setTermsRef({ value: '' });
    setDueDate(today);
    setMemo('');
    setDocNumber('');
    setLines([newLine(), newLine()]);
    setError(null);
    setSyncResult(null);
    setAutoFillSummary(null);
    setRuleTransformedLineItems(null);
  };

  const handleAutoFill = useCallback(async () => {
    if (!activeScanEntry?.lineItems?.length) {
      setError('No scan line items available to auto-fill');
      return;
    }
    if (!selectedTemplate?.columnMappings) {
      setError('Template column mappings are required for auto-fill');
      return;
    }
    if (!selectedTemplate?.id) return;

    setError(null);

    try {
      const productMappings = await api.getProductMappings(jwt, selectedTemplate.id);
      const itemsToExtract = ruleTransformedLineItems ?? activeScanEntry.lineItems ?? [];
      const extracted = extractLineItems({
        lineItems: itemsToExtract,
        columnMappings: selectedTemplate.columnMappings,
        productMappings,
        defaultPostingType: 'Credit',
      });

      const billLines = extracted.map((item) => newLine({
        accountId: item.accountId,
        accountName: item.accountName || accounts.find((a) => a.Id === item.accountId)?.FullyQualifiedName || '',
        description: item.description,
        classId: item.classId ?? '',
        taxCodeId: item.taxCodeId ?? '',
        amount: item.amount.toFixed(2),
      }));

      setLines(billLines);
      setAutoFillSummary(getAutoFillSummary(extracted));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-fill failed');
    }
  }, [activeScanEntry, accounts, jwt, selectedTemplate]);

  const handleSync = useCallback(async () => {
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
      ) as { billId: string; txnDate: string; docNumber?: string };

        setSyncResult({ id: result.billId, txnDate: result.txnDate, docNumber: result.docNumber });
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

  const handleForceSync = useCallback(async () => {
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
        true,
      ) as { billId: string; txnDate: string; docNumber?: string };

      setSyncResult({ id: result.billId, txnDate: result.txnDate, docNumber: result.docNumber });
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

  if (!status.connected) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <div className="text-4xl mb-3">🔗</div>
        <p className="text-gray-400 text-sm mb-1">QuickBooks not connected</p>
        <p className="text-gray-600 text-xs mb-4">Connect QuickBooks in Settings to sync bills</p>
        <button onClick={connect} className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-4 py-2 rounded-lg">
          Connect QuickBooks
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs px-3 py-1.5 bg-green-900/20 border border-green-800 rounded-lg">
        <span className="text-green-400">✅ QB Connected</span>
        <span className="text-gray-600 truncate">{status.realmId}</span>
        <button
          onClick={() => void syncAllLists()}
          disabled={listsLoading}
          className="ml-auto text-gray-500 hover:text-gray-300 transition-colors"
          title="Refresh QB lists"
        >
          {listsLoading ? '…' : '↻'}
        </button>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-gray-500 mb-1">Transaction Date</div>
          <SmartDatePicker value={txnDate} onChange={setTxnDate} />
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Vendor</div>
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
          <div className="text-xs text-gray-500 mb-1">AP Account</div>
          <SearchableSelect
            options={apAccountOptions}
            value={apAccountRef.value}
            onChange={(value) => {
              const selected = accounts.find((a) => a.Id === value);
              setApAccountRef({ value, name: selected?.FullyQualifiedName });
            }}
            placeholder="Select AP account…"
          />
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Due Date</div>
          <SmartDatePicker value={dueDate} onChange={setDueDate} />
        </div>
        <div className="col-span-2">
          <div className="text-xs text-gray-500 mb-1">Terms</div>
          {terms.length > 0 ? (
            <select
              className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
              value={termsRef.value}
              onChange={(e) => {
                const selected = terms.find((term) => term.Id === e.target.value);
                setTermsRef({ value: e.target.value, name: selected?.Name });
              }}
            >
              <option value="">Select terms...</option>
              {terms.map((term) => (
                <option key={term.Id} value={term.Id}>{term.Name}</option>
              ))}
            </select>
          ) : (
            <input
              className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
              value={termsRef.value}
              onChange={(e) => setTermsRef({ value: e.target.value })}
              placeholder="Terms reference…"
            />
          )}
        </div>
        <div className="col-span-2">
          <div className="text-xs text-gray-500 mb-1">Memo / Private Note</div>
          <input
            className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={`Nest sync — ${txnDate}`}
          />
        </div>
        <div className="col-span-2">
          <div className="text-xs text-gray-500 mb-1">Bill No.</div>
          <input
            className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
            value={docNumber}
            onChange={(e) => setDocNumber(e.target.value)}
            placeholder="Optional bill number"
          />
        </div>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div className="flex flex-col gap-2 px-3 py-3 border-b border-gray-700/60 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => void handleAutoFill()}
            disabled={!activeScanEntry?.lineItems?.length || !selectedTemplate?.columnMappings}
            className="text-xs bg-cyan-700 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50 text-white rounded px-3 py-1.5"
          >
            Auto-fill from Scan
          </button>
          {autoFillSummary ? (
            <div className="text-xs text-gray-300">
              {autoFillSummary.total} items: {autoFillSummary.mapped} mapped, {autoFillSummary.unmapped} unmapped
            </div>
          ) : null}
        </div>
        <div className="overflow-x-auto overflow-y-auto max-h-[320px]">
          <table className="w-full text-xs border-collapse min-w-[680px]">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-700/50">
                <th className="text-gray-400 font-medium text-left px-2 py-2 w-8">#</th>
                <th className="text-gray-400 font-medium text-left px-2 py-2 min-w-[180px]">Account</th>
                <th className="text-gray-400 font-medium text-left px-2 py-2 min-w-[160px]">Description</th>
                <th className="text-gray-400 font-medium text-left px-2 py-2 min-w-[120px]">Class</th>
                <th className="text-gray-400 font-medium text-left px-2 py-2 min-w-[120px]">Tax Code</th>
                <th className="text-gray-400 font-medium text-right px-2 py-2 w-24">Amount</th>
                <th className="text-gray-400 font-medium text-center px-1 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {effectiveLines.map((line, idx) => (
                <tr key={line.localId} className={`border-b border-gray-700/60 ${idx % 2 === 1 ? 'bg-gray-800/40' : ''}`}>
                  <td className="px-2 py-1 text-gray-600 text-center text-xs">{idx + 1}</td>
                  <td className="px-1 py-1 min-w-[180px] max-w-[240px]">
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
                  <td className="px-1 py-1 min-w-[160px]">
                    <input
                      className="w-full bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
                      value={line.description}
                      onChange={(e) => updateLine(line.localId, { description: e.target.value })}
                      placeholder="Description…"
                      maxLength={4000}
                    />
                  </td>
                  <td className="px-1 py-1 min-w-[120px] max-w-[160px]">
                    <SearchableSelect
                      options={classOptions}
                      value={line.classId}
                      onChange={(value) => updateLine(line.localId, { classId: value })}
                      placeholder="Class…"
                    />
                  </td>
                  <td className="px-1 py-1 min-w-[120px] max-w-[160px]">
                    <SearchableSelect
                      options={taxCodeOptions}
                      value={line.taxCodeId}
                      onChange={(value) => updateLine(line.localId, { taxCodeId: value })}
                      placeholder="Tax Code…"
                    />
                  </td>
                  <td className="px-1 py-1 text-right w-24">
                    <input
                      className="w-full bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1 text-right focus:border-cyan-500 focus:outline-none"
                      value={line.amount}
                      onChange={(e) => updateLine(line.localId, { amount: e.target.value })}
                      placeholder="0.00"
                      inputMode="decimal"
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => removeLine(line.localId)}
                      className="text-gray-400 hover:text-red-400"
                      disabled={effectiveLines.length <= 1}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-600 bg-gray-700/30 font-semibold">
                <td className="px-2 py-2 text-gray-500">{effectiveLines.length}</td>
                <td colSpan={4} className="px-2 py-2 text-gray-500">Total</td>
                <td className="px-2 py-2 text-right font-mono text-blue-300">${fmt(totalAmount)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <button
        type="button"
        onClick={addLine}
        className="w-full text-xs text-gray-500 hover:text-gray-300 border border-dashed border-gray-700 hover:border-gray-500 py-1.5 rounded-lg transition-colors"
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
      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {syncResult && (
        <div className="bg-green-900/40 border border-green-700 text-green-300 text-xs rounded-lg px-3 py-2 space-y-1.5">
          <div>✅ Bill created — <span className="font-mono">{syncResult.id}</span></div>
          {syncResult.docNumber && <div>Bill # {syncResult.docNumber}</div>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(syncResult.id).catch(() => {})}
              className="text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-800 hover:border-cyan-600 px-2 py-0.5 rounded transition-colors"
            >
              Copy ID
            </button>
            <a
              href={`${status.environment === 'sandbox' ? 'https://app.sandbox.qbo.intuit.com' : 'https://app.qbo.intuit.com'}/app/bill?txnId=${syncResult.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-cyan-400 hover:underline"
            >
              View in QuickBooks ↗
            </a>
            {onNavigateToPayments && (
              <button
                type="button"
                onClick={onNavigateToPayments}
                className="text-xs text-white bg-cyan-700 hover:bg-cyan-600 px-2 py-0.5 rounded transition-colors"
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
          className="px-3 py-2 text-xs text-red-400 border border-red-800 hover:bg-red-900/20 rounded-lg transition-colors"
        >
          Clear All
        </button>
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={syncing || !hasHeader || !allMapped || !hasAmount}
          className="flex-1 py-2.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-bold rounded-lg transition-colors"
        >
          {syncing
            ? 'Syncing Bill…'
            : !hasHeader
              ? '⚠️ Vendor and AP account required'
              : !hasAmount
                ? '⚠️ Add bill amounts'
                : !allMapped
                  ? '⚠️ Assign all line accounts'
                  : '⚡ Sync Bill to QuickBooks'}
        </button>
      </div>
    </div>
  );
}
