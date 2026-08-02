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
import { PreSyncChecklist } from './shared';
import type { PreSyncCheck } from './shared/PreSyncChecklist';
import type { ExtractedLineItem, ScanData, ScanEntry, Mapping, Template, PayeeMapping, ValueMapping } from '../../types';
import type { SelectOption } from './SearchableSelect';
import type { QBAccount } from '../types/qb';
import { decodeMapping } from '../lib/je-builder';
import { resolveMapping } from '../lib/mapping-conditions';
import { parseNumericValue } from '../lib/parse-numeric-value';

interface CheckLine {
  localId: string;
  accountId: string;
  accountName: string;
  description: string;
  classId: string;
  taxCodeId: string;
  amount: string;
}

function newLine(overrides?: Partial<CheckLine>): CheckLine {
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
  userRole?: string;
  attachments?: Array<{ id: string; fileName: string; fileSize: number; mimeType: string; createdAt: string }>;
}

export default function CheckPreviewForm({
  jwt,
  scanData,
  activeScanEntry,
  selectedLocationId,
  scanRecordId,
  selectedTemplate,
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
    listsLoaded,
    listsLoading,
    listsError,
    syncAllLists,
  } = useQBContext();

  const today = toYMD(new Date());
  const [txnDate, setTxnDate] = useState(today);
  const [bankAccountRef, setBankAccountRef] = useState<{ value: string; name?: string }>({ value: '' });
  const [payeeRef, setPayeeRef] = useState<{ value: string; name?: string }>({ value: '' });
  const [valueMappings, setValueMappings] = useState<ValueMapping[]>([]);
  const [payeeMappings, setPayeeMappings] = useState<PayeeMapping[]>([]);
  const [memo, setMemo] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [defaultTaxCodeId, setDefaultTaxCodeId] = useState('');
  const [lines, setLines] = useState<CheckLine[]>([newLine(), newLine()]);
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
    if (!activeScanEntry) return;
    if (activeScanEntry.source === 'pos') return;
    if (!selectedTemplate?.columnMappings || !selectedTemplate?.id) return;
    if (!jwt || !locId) return;
    if (userHasEditedLinesRef.current) return;

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
          defaultPostingType: 'Debit',
        });
        if (cancelled) return;

        const accountMappingMatches = new Map<number, string>();

        const processedExtracted = extracted.map((item, index) => {
          let { accountId, accountName, classId, taxCodeId } = item;

          if (!accountId && item.productName) {
            const vmResult = resolveValueMapping(
              item.productName,
              'account',
              valueMappings,
              (id) => accountsRef.current.find((a) => a.Id === id),
            );
            if (vmResult.matched) {
              accountId = vmResult.entityId;
              accountName = vmResult.entityName;
              if (vmResult.matchedMappingId) {
                accountMappingMatches.set(index, vmResult.matchedMappingId);
              }
            }
          }

          if (classId) {
            const isAlreadyQbId = classes.some((c) => c.Id === classId);
            if (!isAlreadyQbId) {
              const vmResult = resolveValueMapping(
                classId,
                'class',
                valueMappings,
                (id) => classes.find((c) => c.Id === id),
              );
              if (vmResult.matched) {
                classId = vmResult.entityId;
              }
            }
          }

          if (taxCodeId) {
            const isAlreadyQbId = taxCodes.some((t) => t.Id === taxCodeId);
            if (!isAlreadyQbId) {
              const vmResult = resolveValueMapping(
                taxCodeId,
                'taxCode',
                valueMappings,
                (id) => taxCodes.find((t) => t.Id === id),
              );
              if (vmResult.matched) {
                taxCodeId = vmResult.entityId;
              }
            }
          }

          return { ...item, accountId, accountName, classId, taxCodeId };
        });

        const finalExtracted: typeof processedExtracted = [];
        const combineGroups = new Map<string, number[]>();
        processedExtracted.forEach((item, idx) => {
          const mappingId = accountMappingMatches.get(idx);
          if (mappingId) {
            const mapping = valueMappings.find((vm) => vm.id === mappingId);
            if (mapping?.matchingRule?.combine) {
              if (!combineGroups.has(mappingId)) combineGroups.set(mappingId, []);
              combineGroups.get(mappingId)!.push(idx);
              return;
            }
          }
          finalExtracted.push(item);
        });

        for (const [mappingId, indices] of combineGroups) {
          const items = indices.map((idx) => processedExtracted[idx]);
          if (items.length === 1) {
            finalExtracted.push(items[0]);
          } else {
            const descriptions = items.map((i) => i.description || i.productName).filter(Boolean);
            finalExtracted.push({
              ...items[0],
              amount: items.reduce((sum, i) => sum + i.amount, 0),
              description: descriptions.join(' & '),
              matched: true,
            });
          }
        }

        setLines(finalExtracted.map((item) => newLine({
          accountId: item.accountId,
          accountName: item.accountName || accountsRef.current.find((a) => a.Id === item.accountId)?.FullyQualifiedName || '',
          description: item.description,
          classId: item.classId ?? '',
          taxCodeId: item.taxCodeId ?? '',
          amount: item.amount.toFixed(2),
        })));
        setAutoFillSummary(getAutoFillSummary(extracted));
        setUnmatchedItems(extracted.filter((item) => !item.matched).map((item) => ({ productName: item.productName })));
      } catch {
        // silent fallback
      }
    })();

    return () => { cancelled = true; };
  }, [activeScanEntry, selectedTemplate, jwt, locId, ruleTransformedLineItems, valueMappings]);

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
        console.error('[Check Preview] Failed to load mappings:', err);
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
        console.error('[Check Preview] Failed to apply rules:', err);
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
    if (!selectedTemplate || selectedTemplate.transactionType !== 'CHEQUE') return;
    const defaults = selectedTemplate.defaults as Record<string, { value: string; name?: string } | null> | null;
    if (!defaults) return;

    if (defaults.bankAccountRef) setBankAccountRef(defaults.bankAccountRef);
    if (defaults.payeeRef) setPayeeRef(defaults.payeeRef);
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

    setPayeeRef((prev) => {
      if (prev.value) return prev;
      const vendorName = (h.payeeName || h.vendor || '').trim();
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
      return (h.chequeNumber || '').trim() || prev;
    });

    const parsedDate = parseScanDate(h.date || h.chequeDate || h.invoiceDate);
    if (parsedDate) {
      setTxnDate((prev) => {
        if (prev && prev !== toYMD(new Date())) return prev;
        return parsedDate;
      });
    }

    if (h.memo) {
      setMemo((prev) => {
        if (prev) return prev;
        return String(h.memo);
      });
    }

    if (h.bankName && !bankAccountRef.value) {
      const bankName = String(h.bankName).toLowerCase();
      const match = accounts.find((a) => a.FullyQualifiedName.toLowerCase().includes(bankName));
      if (match) setBankAccountRef({ value: match.Id, name: match.FullyQualifiedName });
    }
  }, [activeScanEntry, vendors, accounts, bankAccountRef.value, payeeMappings, valueMappings]);

  useEffect(() => {
    if (!mappingsLoaded) return;
    if (activeScanEntry?.source === 'image' || activeScanEntry?.source === 'pdf') return;
    const decoded = savedMappings.map(decodeMapping);
    const scanFields: Record<string, number> = activeScanEntry
      ? Object.fromEntries(
        Object.entries(activeScanEntry.lineItems?.[0] ?? {})
          .map(([key, value]) => [key, parseNumericValue(value)])
          .filter(([, v]) => v !== 0),
      ) as Record<string, number>
      : scanData ?? {};

    const checkLines = Object.entries(scanFields)
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

    if (checkLines.length > 0) {
      setLines(checkLines);
    }
  }, [activeScanEntry, scanData, savedMappings, mappingsLoaded, accountsRef]);

  const payeeOptions = useMemo(() =>
    vendors
      .filter((vendor) => vendor.Active)
      .map((vendor) => ({ value: vendor.Id, label: vendor.DisplayName, subtitle: vendor.CompanyName ?? undefined })),
    [vendors],
  );

  const bankAccountOptions = useMemo(() =>
    accounts
      .filter((account) => account.Active && account.AccountType === 'Bank')
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
  const updateLine = (localId: string, patch: Partial<CheckLine>) => {
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
  const hasHeader = Boolean(bankAccountRef.value && payeeRef.value);

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
  if (payeeRef.value) {
    const payee = vendors.find((v) => v.Id === payeeRef.value);
    if (payee && !payee.Active) {
      inactiveWarnings.push(`Vendor "${payee.DisplayName}" is inactive`);
    }
  }

  const scannedAmount = activeScanEntry?.header?.amount
    ? parseFloat(String(activeScanEntry.header.amount).replace(/[^0-9.\-]/g, ''))
    : null;
  const totalMismatch = scannedAmount !== null && totalAmount > 0 && Math.abs(totalAmount - scannedAmount) > 0.01
    ? Math.abs(totalAmount - scannedAmount)
    : null;

  const preSyncChecks: PreSyncCheck[] = [
    {
      passed: hasHeader,
      label: 'Bank account & payee selected',
    },
    {
      passed: hasAmount,
      label: 'Has check amount',
    },
    {
      passed: allMapped,
      label: allMapped
        ? `All ${effectiveLines.length} items mapped`
        : `${unmappedCount} of ${effectiveLines.length} items unmapped`,
    },
    {
      passed: inactiveWarnings.length === 0,
      label: 'All referenced entities active',
      detail:
        inactiveWarnings.length > 0
          ? `${inactiveWarnings.length} inactive`
          : undefined,
    },
    {
      passed: totalMismatch === null,
      label: 'Amount matches scanned check',
      detail:
        totalMismatch !== null
          ? `Off by $${totalMismatch!.toFixed(2)}`
          : undefined,
    },
  ];

  const handleClearAll = () => {
    setTxnDate(today);
    setBankAccountRef({ value: '' });
    setPayeeRef({ value: '' });
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
      const checkLines = effectiveLines
        .filter((line) => parseFloat(line.amount) > 0)
        .map((line) => ({
          amount: parseFloat(line.amount),
          accountRef: { value: line.accountId, name: line.accountName || undefined },
          description: line.description || undefined,
          classRef: line.classId ? { value: line.classId } : undefined,
          taxCodeRef: line.taxCodeId ? { value: line.taxCodeId } : undefined,
        }));

      const result = await api.createCheque(
        jwt,
        txnDate,
        bankAccountRef,
        payeeRef,
        totalAmount,
        checkLines,
        scanRecordId ?? undefined,
        memo || undefined,
        docNumber || undefined,
        skipDedupCheck,
      ) as { chequeId?: string; qbJournalEntryId?: string; txnDate?: string; docNumber?: string; skipped?: boolean };

      setSyncResult({ id: result.chequeId ?? result.qbJournalEntryId ?? '', txnDate: result.txnDate ?? txnDate, skipped: Boolean(result.skipped), docNumber: result.docNumber });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDuplicateWarning(err.payload?.error ?? err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Check sync failed');
      }
    } finally {
      setSyncing(false);
    }
  }, [allMapped, bankAccountRef, docNumber, effectiveLines, hasAmount, hasHeader, jwt, memo, scanRecordId, totalAmount, txnDate, payeeRef]);

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
        <p className="text-gray-600 text-xs mb-4">Connect QuickBooks in Settings to sync checks</p>
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
          <div className="text-sm font-medium text-gray-700 mb-1">Bank Account</div>
          <SearchableSelect
            options={bankAccountOptions}
            value={bankAccountRef.value}
            onChange={(value) => {
              const selected = accounts.find((a) => a.Id === value);
              setBankAccountRef({ value, name: selected?.FullyQualifiedName });
            }}
            placeholder="Select bank account…"
          />
        </div>
        <div className="col-span-2">
          <div className="text-sm font-medium text-gray-700 mb-1">Payee</div>
          <SearchableSelect
            options={payeeOptions}
            value={payeeRef.value}
            onChange={(value) => {
              const selected = vendors.find((v) => v.Id === value);
              setPayeeRef({ value, name: selected?.DisplayName });
            }}
            placeholder="Select payee/vendor…"
          />
        </div>
        <div className="col-span-2">
          <div className="text-sm font-medium text-gray-700 mb-1">Check # / Doc Number</div>
          <input
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white text-gray-900 focus:border-emerald-500 focus:outline-none"
            value={docNumber}
            onChange={(e) => setDocNumber(e.target.value)}
            placeholder="Optional check number"
          />
        </div>
        <div className="col-span-2">
          <div className="text-sm font-medium text-gray-700 mb-1">Memo</div>
          <input
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white text-gray-900 focus:border-emerald-500 focus:outline-none"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Optional memo"
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
                <th className="text-left px-3 py-3 min-w-[140px]">Tax</th>
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
                  <td className="px-3 py-2">
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
                <td colSpan={3} className="px-3 py-3 text-gray-600">Total</td>
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
      <PreSyncChecklist checks={preSyncChecks} />
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
          <div>{syncResult.skipped ? '✅ Check already synced' : '✅ Check created'} — <span className="font-mono">{syncResult.id}</span></div>
          {syncResult.docNumber && <div>Check # {syncResult.docNumber}</div>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(syncResult.id).catch(() => {})}
              className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800 hover:border-emerald-600 px-2 py-0.5 rounded transition-colors"
            >
              Copy ID
            </button>
            <a
              href={`${status.environment === 'sandbox' ? 'https://app.sandbox.qbo.intuit.com' : 'https://app.qbo.intuit.com'}/app/expense?txnId=${syncResult.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-400 hover:underline"
            >
              View in QuickBooks ↗
            </a>
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
            ? (canSyncDirectly ? 'Syncing Check…' : 'Submitting…')
            : !hasHeader
              ? '⚠️ Bank and payee required'
              : !hasAmount
                ? '⚠️ Add check amounts'
                : !allMapped
                  ? '⚠️ Assign all line accounts'
                  : (canSyncDirectly ? '⚡ Sync Check to QuickBooks' : '📋 Submit for Approval')}
        </button>
      </div>
    </div>
  );
}
