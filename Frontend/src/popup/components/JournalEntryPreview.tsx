import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, ApiError } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import { useQuickBooks } from '../hooks/useQuickBooks';
import { useQBContext } from '../contexts/QBContext';
import SearchableSelect from './SearchableSelect';
import SmartDatePicker from './SmartDatePicker';
import ErrorCard from './shared/ErrorCard';
import type { ScanData, ScanEntry, Mapping } from '../../types';
import type { SelectOption } from './SearchableSelect';
import type { QBAccount } from '../types/qb';
import { guessPostingType, decodeMapping } from '../lib/je-builder';
import { resolveMapping } from '../lib/mapping-conditions';
import { parseNumericValue } from '../lib/parse-numeric-value';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItem {
  localId: string;
  accountId: string;
  accountName: string;
  entityVal: string; // "customer:ID" | "vendor:ID" | "employee:ID" | ""
  description: string;
  classId: string;
  taxCodeId: string;
  debit: string;
  credit: string;
  keepSeparate: boolean;
}

type ColKey = 'account' | 'name' | 'description' | 'class' | 'taxCode' | 'debit' | 'credit';

const ALL_COLUMNS: { key: ColKey; label: string }[] = [
  { key: 'account', label: 'Account' },
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'class', label: 'Class' },
  { key: 'taxCode', label: 'Tax Code' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Credit' },
];

const LS_COL_KEY = 'nest_je_col_vis';

function loadColVis(): Record<ColKey, boolean> {
  try {
    const raw = localStorage.getItem(LS_COL_KEY);
    if (raw) return JSON.parse(raw) as Record<ColKey, boolean>;
  } catch { /* ignore */ }
  return { account: true, name: true, description: true, class: true, taxCode: true, debit: true, credit: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function newLine(overrides?: Partial<LineItem>): LineItem {
  return {
    localId: `line-${Date.now()}-${Math.random()}`,
    accountId: '',
    accountName: '',
    entityVal: '',
    description: '',
    classId: '',
    taxCodeId: '',
    debit: '',
    credit: '',
    keepSeparate: false,
    ...overrides,
  };
}

function toYMD(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function resolveMemoTemplate(template: string, data: ScanData | null): string {
  if (!template || !data) return '';
  return template.replace(/\{(\w+)\}/g, (match, field: string) => {
    const key = Object.keys(data).find(
      (k) => k.toLowerCase().replace(/\s+/g, '_') === field.toLowerCase(),
    );
    return key !== undefined ? String(data[key]) : match;
  });
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  jwt: string;
  scanData: ScanData | null;
  scanEntries: ScanEntry[];
  activeScanEntry?: ScanEntry | null;
  activeScanEntryId: string | null;
  onActiveScanEntryIdChange: (id: string) => void;
  selectedLocationId: string;
  scanRecordId?: string | null;
}

export default function JournalEntryPreview({ jwt, scanData, scanEntries, activeScanEntry, activeScanEntryId, onActiveScanEntryIdChange, selectedLocationId, scanRecordId }: Props) {
  const { status, connect } = useQuickBooks(jwt);
  const { locations } = useLocations(jwt);
  const {
    accounts, classes, employees, vendors, customers, taxCodes,
    listsLoaded, listsLoading, listsError, syncAllLists,
  } = useQBContext();

  const today = toYMD(new Date());
  const [txnDate, setTxnDate] = useState(today);
  const [docNumber, setDocNumber] = useState('');
  const [privateNote, setPrivateNote] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [lines, setLines] = useState<LineItem[]>([newLine(), newLine()]);
  const [colVis, setColVis] = useState<Record<ColKey, boolean>>(loadColVis);
  const [showColMenu, setShowColMenu] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ id: string; txnDate: string; skipped?: boolean; docNumber?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [autoBalancePending, setAutoBalancePending] = useState(false);
  const [savedMappings, setSavedMappings] = useState<Mapping[]>([]);
  const [mappingsLoaded, setMappingsLoaded] = useState(false);
  const [ruleTransformedData, setRuleTransformedData] = useState<Record<string, number> | null>(null);
  const [ruleTransformedLineItems, setRuleTransformedLineItems] = useState<Record<string, string>[] | null>(null);
  const rulesAppliedRef = useRef(false);
  const [consolidate, setConsolidate] = useState(false);

  // Keep a stable ref to accounts to avoid re-render loops in the scan effect
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  // Track which ScanEntry has been auto-populated (prevent overwrite on re-render)
  const autoPopulatedForRef = useRef<string | null>(null);

  // Persist column visibility
  useEffect(() => {
    localStorage.setItem(LS_COL_KEY, JSON.stringify(colVis));
  }, [colVis]);

  // Load QB lists on mount
  useEffect(() => {
    if (!listsLoaded && !listsLoading && !listsError) void syncAllLists();
  }, [listsLoaded, listsLoading, listsError, syncAllLists]);

  const locId = selectedLocationId || locations[0]?.id || '';

  // Load saved mappings for this location
  useEffect(() => {
    if (!jwt || !locId) return;
    setMappingsLoaded(false);
    api.getMappings(jwt, locId)
      .then((mappings) => {
        setSavedMappings(mappings);
        setMappingsLoaded(true);
      })
      .catch((err) => {
        console.error('[JE Preview] Failed to load mappings:', err);
        setMappingsLoaded(true);
      });
  }, [jwt, locId]);

  // Apply memo/docNumber templates from location data when scan data loads
  useEffect(() => {
    if (!scanData || !locId) return;
    const loc = locations.find(l => l.id === locId);
    if (!loc) return;
    if (loc.memoTemplate) setPrivateNote(resolveMemoTemplate(loc.memoTemplate, scanData));
    if (loc.docNumberTemplate) setDocNumber(resolveMemoTemplate(loc.docNumberTemplate, scanData));
  }, [scanData, locId, locations]);

  useEffect(() => {
    rulesAppliedRef.current = false;
    setRuleTransformedData(null);
    setRuleTransformedLineItems(null);
  }, [activeScanEntryId, scanData]);

  // Fetch and apply active rules to current scan data or line item rows
  useEffect(() => {
    if (rulesAppliedRef.current || !jwt || !locId) return;
    rulesAppliedRef.current = true;

    const applyRulesToScan = async () => {
      try {
        const rules = await api.getRules(jwt, locId);
        const activeRules = rules.filter((r) => r.isActive);
        if (activeRules.length === 0) return;

        if (activeScanEntry?.lineItems?.length) {
          const result = await api.applyRules(jwt, {
            lineItems: activeScanEntry.lineItems,
            rules: activeRules,
          });
          if (result.type === 'lineItems') {
            setRuleTransformedLineItems(result.data);
          }
          return;
        }

        if (scanData) {
          const result = await api.applyRules(jwt, {
            scanData,
            rules: activeRules,
          });
          if (result.type === 'flat') {
            setRuleTransformedData(result.data);
          }
        }
      } catch (err) {
        console.error('[JE Preview] Failed to apply rules:', err);
      }
    };

    void applyRulesToScan();
  }, [jwt, locId, activeScanEntry, scanData]);

  // Auto-populate header fields from non-POS ScanEntry using mapping-based detection
  useEffect(() => {
    if (!activeScanEntry || activeScanEntry.source === 'pos' || !mappingsLoaded) return;
    if (autoPopulatedForRef.current === activeScanEntry.id) return;

    const header = activeScanEntry.header;
    if (!header || Object.keys(header).length === 0) return;

    const shouldPopulateTxnDate = txnDate === today;
    const shouldPopulatePrivateNote = privateNote.trim() === '';
    const shouldPopulateDocNumber = docNumber.trim() === '';

    // Detect date field via mapping sourceField matching date pattern
    const dateMapping = savedMappings.find(m =>
      /date|txn/i.test(m.sourceField) && Object.prototype.hasOwnProperty.call(header, m.sourceField)
    );
    if (dateMapping && header[dateMapping.sourceField] && shouldPopulateTxnDate) {
      const parsed = new Date(header[dateMapping.sourceField]);
      if (!isNaN(parsed.getTime())) {
        setTxnDate(parsed.toISOString().split('T')[0]);
      }
    }

    // Detect memo/description field
    const memoMapping = savedMappings.find(m =>
      /memo|description|note/i.test(m.sourceField) && Object.prototype.hasOwnProperty.call(header, m.sourceField)
    );
    if (memoMapping && header[memoMapping.sourceField] && shouldPopulatePrivateNote) {
      setPrivateNote(header[memoMapping.sourceField]);
    } else if (shouldPopulatePrivateNote) {
      const vendorMapping = savedMappings.find(m =>
        /vendor|name|payee/i.test(m.sourceField) && Object.prototype.hasOwnProperty.call(header, m.sourceField)
      );
      if (vendorMapping && header[vendorMapping.sourceField]) {
        setPrivateNote(header[vendorMapping.sourceField]);
      }
    }

    // Detect doc/reference field
    const docMapping = savedMappings.find(m =>
      /doc|number|reference|invoice\s*no/i.test(m.sourceField) && Object.prototype.hasOwnProperty.call(header, m.sourceField)
    );
    if (docMapping && header[docMapping.sourceField] && shouldPopulateDocNumber) {
      setDocNumber(header[docMapping.sourceField]);
    }

    autoPopulatedForRef.current = activeScanEntry.id;
  }, [activeScanEntry, savedMappings, mappingsLoaded, txnDate, privateNote, docNumber, today]);

  // Build lines from the current active scan entry when available
  useEffect(() => {
    if (!activeScanEntry || !mappingsLoaded) return;
    const decoded = savedMappings.map(decodeMapping);
    const currentLineItem = (ruleTransformedLineItems?.[0] ?? activeScanEntry.lineItems?.[0]) ?? {};
    const scanFields: ScanData = Object.fromEntries(
      Object.entries(currentLineItem)
        .map(([key, value]) => [key, parseNumericValue(value)])
        .filter(([, v]) => !Number.isNaN(v)),
    ) as ScanData;
    const scanLines: LineItem[] = Object.entries(currentLineItem)
      .map(([field, rawValue]) => ({ field, amount: parseNumericValue(rawValue) }))
      .filter((entry) => !Number.isNaN(entry.amount) && entry.amount !== 0)
      .map(({ field, amount }) => {
        const mapping = resolveMapping(decoded, field, scanFields);
        const rawSide = mapping
          ? mapping.postingType.toLowerCase() as 'debit' | 'credit'
          : guessPostingType(field);
        const side = amount < 0
          ? (rawSide === 'debit' ? 'credit' : 'debit')
          : rawSide;
        const accountName = mapping
          ? (accountsRef.current.find((a) => a.Id === mapping.accountId)?.FullyQualifiedName ?? '')
          : '';
        return newLine({
          description: mapping?.description ?? field,
          accountId: mapping?.accountId ?? '',
          accountName,
          classId: mapping?.classId ?? '',
          keepSeparate: mapping?.keepSeparate ?? false,
          debit: side === 'debit' ? Math.abs(amount).toFixed(2) : '',
          credit: side === 'credit' ? Math.abs(amount).toFixed(2) : '',
        });
      });
    if (scanLines.length > 0) setLines(scanLines);
  }, [activeScanEntry, savedMappings, mappingsLoaded]);

  // Build lines from scan data, applying saved mappings
  useEffect(() => {
    if (activeScanEntry) return;
    const data = ruleTransformedData ?? scanData;
    if (!data || !mappingsLoaded) return;
    const decoded = savedMappings.map(decodeMapping);
    const scanLines: LineItem[] = Object.entries(data)
      .filter(([, v]) => v !== 0)
      .map(([field, amount]) => {
        const mapping = resolveMapping(decoded, field, data);
        const rawSide = mapping
          ? mapping.postingType.toLowerCase() as 'debit' | 'credit'
          : guessPostingType(field);
        // Negative amount flips the posting side: a negative Credit is a Debit, and vice versa
        const side = amount < 0
          ? (rawSide === 'debit' ? 'credit' : 'debit')
          : rawSide;
        const accountName = mapping
          ? (accountsRef.current.find((a) => a.Id === mapping.accountId)?.FullyQualifiedName ?? '')
          : '';
        return newLine({
          description: mapping?.description ?? field,
          accountId: mapping?.accountId ?? '',
          accountName,
          classId: mapping?.classId ?? '',
          keepSeparate: mapping?.keepSeparate ?? false,
          debit: side === 'debit' ? Math.abs(amount).toFixed(2) : '',
          credit: side === 'credit' ? Math.abs(amount).toFixed(2) : '',
        });
      });
    if (scanLines.length > 0) setLines(scanLines);
  }, [scanData, savedMappings, mappingsLoaded]); // NOTE: no `accounts` dep — uses accountsRef

  // Account options grouped by classification
  const accountOptions = useMemo((): SelectOption[] =>
    accounts
      .filter((a) => a.Active)
      .map((a) => ({
        value: a.Id,
        label: a.FullyQualifiedName,
        subtitle: a.AccountSubType,
        group: a.Classification || a.AccountType,
      }))
      .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.label.localeCompare(b.label)),
    [accounts],
  );

  const entityOptions = useMemo((): SelectOption[] => [
    ...customers.filter((c) => c.Active).map((c) => ({
      value: `customer:${c.Id}`,
      label: c.DisplayName,
      subtitle: c.CompanyName ?? undefined,
      group: 'Customers',
    })),
    ...vendors.filter((v) => v.Active).map((v) => ({
      value: `vendor:${v.Id}`,
      label: v.DisplayName,
      subtitle: v.CompanyName ?? undefined,
      group: 'Vendors',
    })),
    ...employees.filter((e) => e.Active).map((e) => ({
      value: `employee:${e.Id}`,
      label: e.DisplayName,
      group: 'Employees',
    })),
  ], [customers, vendors, employees]);

  const classOptions = useMemo((): SelectOption[] =>
    classes.filter((c) => c.Active).map((c) => ({ value: c.Id, label: c.FullyQualifiedName })),
    [classes],
  );

  const taxCodeOptions = useMemo((): SelectOption[] =>
    taxCodes.filter((t) => t.Active).map((t) => ({ value: t.Id, label: t.Name, subtitle: t.Description })),
    [taxCodes],
  );

  const updateLine = (localId: string, patch: Partial<LineItem>) =>
    setLines((prev) => prev.map((l) => (l.localId === localId ? { ...l, ...patch } : l)));

  const removeLine = (localId: string) =>
    setLines((prev) => prev.filter((l) => l.localId !== localId));

  // Consolidate lines that share the same accountId + side + classId
  const consolidateLines = useCallback((rawLines: LineItem[]): LineItem[] => {
    const groups: Record<string, LineItem[]> = {};
    const separate: LineItem[] = [];

    rawLines.forEach((line) => {
      if (line.keepSeparate || !line.accountId) {
        separate.push(line);
        return;
      }
      const debitAmt = parseFloat(line.debit) || 0;
      const side = debitAmt > 0 ? 'debit' : 'credit';
      const key = `${line.accountId}|${side}|${line.classId}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(line);
    });

    const merged: LineItem[] = Object.values(groups).map((group) => {
      if (group.length === 1) return group[0];
      const totalDebit = group.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
      const totalCredit = group.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
      const descriptions = group.map((l) => l.description).filter(Boolean);
      return newLine({
        accountId: group[0].accountId,
        accountName: group[0].accountName,
        classId: group[0].classId,
        description: descriptions.length <= 3
          ? descriptions.join(' + ')
          : `${descriptions.slice(0, 3).join(' + ')} +${descriptions.length - 3} more`,
        keepSeparate: false,
        debit: totalDebit ? totalDebit.toFixed(2) : '',
        credit: totalCredit ? totalCredit.toFixed(2) : '',
      });
    });

    return [...separate, ...merged];
  }, []);

  // Auto-balance: if rounding caused a tiny imbalance (≤ $0.02), adjust the largest line
  const rawDisplayLines = consolidate ? consolidateLines(lines) : lines;
  const rawTotalDebits = rawDisplayLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const rawTotalCredits = rawDisplayLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const rawDiff = rawTotalDebits - rawTotalCredits;

  let autoBalancedDisplayLines = rawDisplayLines;
  let autoBalancedThisRender: { amount: number; lineId: string } | null = null;

  if (Math.abs(rawDiff) > 0.001 && Math.abs(rawDiff) <= 0.02) {
    const shortSide = rawDiff > 0 ? 'credit' : 'debit';
    const candidates = rawDisplayLines.filter((l) => {
      const val = parseFloat(shortSide === 'debit' ? l.debit : l.credit) || 0;
      return val > 0;
    });
    if (candidates.length > 0) {
      const largest = candidates.reduce((best, l) => {
        const val = parseFloat(shortSide === 'debit' ? l.debit : l.credit) || 0;
        const bestVal = parseFloat(shortSide === 'debit' ? best.debit : best.credit) || 0;
        return val > bestVal ? l : best;
      });
      const adjustment = Math.abs(rawDiff);
      autoBalancedDisplayLines = rawDisplayLines.map((l) => {
        if (l.localId !== largest.localId) return l;
        if (shortSide === 'debit') {
          return { ...l, debit: ((parseFloat(l.debit) || 0) + adjustment).toFixed(2) };
        } else {
          return { ...l, credit: ((parseFloat(l.credit) || 0) + adjustment).toFixed(2) };
        }
      });
      autoBalancedThisRender = { amount: adjustment, lineId: largest.localId };
    }
  }

  const autoBalanced = autoBalancedThisRender;
  const effectiveDisplayLines = autoBalancedDisplayLines;

  const totalDebits = effectiveDisplayLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredits = effectiveDisplayLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const diff = totalDebits - totalCredits;
  const isBalanced = Math.abs(diff) < 0.01;

  const unmappedCount = effectiveDisplayLines.filter((l) => !l.accountId).length;
  const allMapped = unmappedCount === 0;

  const handleClearAll = () => {
    setLines([newLine(), newLine()]);
    setDocNumber('');
    setPrivateNote('');
    setIsAdjusting(false);
    setError(null);
    setSyncResult(null);
  };

  const handleSync = useCallback(async (skipDedupCheck = false) => {
    if (!isBalanced) return;
    setSyncing(true);
    setError(null);
    setDuplicateWarning(null);
    setSyncResult(null);
    try {
      const jeLines = effectiveDisplayLines
        .filter((l) => parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0)
        .flatMap((l) => {
          const debitAmt = parseFloat(l.debit) || 0;
          const creditAmt = parseFloat(l.credit) || 0;
          let entityRef: { value: string; name?: string; type?: string } | undefined;
          if (l.entityVal) {
            const parts = l.entityVal.split(':');
            const eType = parts[0];
            const eId = parts[1];
            const opt = entityOptions.find((o) => o.value === l.entityVal);
            if (eId) entityRef = {
              value: eId,
              name: opt?.label,
              type: eType === 'vendor' ? 'Vendor' : eType === 'employee' ? 'Employee' : 'Customer',
            };
          }
          const items = [];
          if (debitAmt > 0) {
            items.push({
              amount: debitAmt,
              postingType: 'Debit',
              accountRef: { value: l.accountId, name: l.accountName },
              description: l.description || undefined,
              classRef: l.classId ? { value: l.classId } : undefined,
              entityRef,
            });
          }
          if (creditAmt > 0) {
            items.push({
              amount: creditAmt,
              postingType: 'Credit',
              accountRef: { value: l.accountId, name: l.accountName },
              description: l.description || undefined,
              classRef: l.classId ? { value: l.classId } : undefined,
              entityRef,
            });
          }
          return items;
        });

      const result = await api.createJournalEntry(
        jwt,
        txnDate,
        jeLines,
        scanRecordId ?? undefined,
        privateNote || `Nest sync — ${txnDate} — ${locations[0]?.name ?? ''}`,
        docNumber || undefined,
        skipDedupCheck,
      ) as { journalEntryId?: string; qbJournalEntryId?: string; txnDate?: string; skipped?: boolean; docNumber?: string };

      setSyncResult({
        id: result.journalEntryId ?? result.qbJournalEntryId ?? '',
        txnDate: result.txnDate ?? txnDate,
        skipped: Boolean(result.skipped),
        docNumber: result.docNumber,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDuplicateWarning(err.payload?.error ?? err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Sync failed');
      }
    } finally {
      setSyncing(false);
    }
  }, [jwt, effectiveDisplayLines, txnDate, docNumber, privateNote, locations, entityOptions, isBalanced, consolidate]);

  const handleForceSync = useCallback(() => {
    if (!isBalanced) return;
    void handleSync(true);
  }, [handleSync, isBalanced]);

  if (!status.connected) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <div className="text-4xl mb-3">🔗</div>
        <p className="text-gray-400 text-sm mb-1">QuickBooks not connected</p>
        <p className="text-gray-600 text-xs mb-4">Connect QuickBooks in Settings to sync journal entries</p>
        <button onClick={connect} className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-4 py-2 rounded-lg">
          Connect QuickBooks
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-3">
      {/* QB Status */}
      <div className="flex items-center gap-2 text-xs px-3 py-1.5 bg-green-900/20 border border-green-800 rounded-lg">
        <span className="text-green-400">✅ QB Connected</span>
        <span className="text-gray-600 truncate">{status.realmId}</span>
        {isAdjusting && (
          <span className="ml-1 px-1.5 py-0.5 bg-yellow-900/40 border border-yellow-700 text-yellow-400 rounded text-xs">
            Adjusting Entry
          </span>
        )}
        <button
          onClick={() => void syncAllLists()}
          disabled={listsLoading}
          className="ml-auto text-gray-500 hover:text-gray-300 transition-colors"
          title="Refresh QB lists"
        >
          {listsLoading ? '…' : '↻'}
        </button>
      </div>

      {scanEntries.length > 1 && activeScanEntry && (
        <div className="flex items-center justify-between px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg">
          <button
            type="button"
            onClick={() => {
              const idx = scanEntries.findIndex((e) => e.id === activeScanEntryId);
              if (idx > 0) onActiveScanEntryIdChange(scanEntries[idx - 1].id);
            }}
            disabled={scanEntries.findIndex((e) => e.id === activeScanEntryId) <= 0}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Prev Row
          </button>
          <span className="text-xs text-gray-300 font-medium">
            Row {activeScanEntry.rowNumber ?? '?'} of {scanEntries.length}
            {activeScanEntry.fileName && ` · ${activeScanEntry.fileName}`}
          </span>
          <button
            type="button"
            onClick={() => {
              const idx = scanEntries.findIndex((e) => e.id === activeScanEntryId);
              if (idx < scanEntries.length - 1) onActiveScanEntryIdChange(scanEntries[idx + 1].id);
            }}
            disabled={scanEntries.findIndex((e) => e.id === activeScanEntryId) >= scanEntries.length - 1}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next Row →
          </button>
        </div>
      )}

      {/* Header fields */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-gray-500 mb-1">Transaction Date</div>
          <SmartDatePicker value={txnDate} onChange={setTxnDate} />
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Doc Number <span className="text-gray-600">(optional)</span></div>
          <input
            className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
            value={docNumber}
            onChange={(e) => setDocNumber(e.target.value)}
            placeholder="Auto-generated by QB"
          />
        </div>
        <div className="col-span-2">
          <div className="text-xs text-gray-500 mb-1">Memo / Private Note</div>
          <input
            className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
            value={privateNote}
            onChange={(e) => setPrivateNote(e.target.value)}
            placeholder={`Nest sync — ${txnDate}`}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="je-adjusting"
            checked={isAdjusting}
            onChange={(e) => setIsAdjusting(e.target.checked)}
            className="rounded border-gray-600"
          />
          <label htmlFor="je-adjusting" className="text-xs text-gray-400 cursor-pointer">
            Adjusting Entry (period-end)
          </label>
        </div>
      </div>

      {/* Balance bar + column toggle */}
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg flex-1 ${
          isBalanced
            ? 'bg-green-900/30 border border-green-800 text-green-400'
            : 'bg-red-900/30 border border-red-800 text-red-400'
        }`}>
          <span>{isBalanced ? '✅ Balanced' : '⚠️ Unbalanced'}</span>
          <span className="font-mono text-gray-400">
            Dr ${fmt(totalDebits)} / Cr ${fmt(totalCredits)}
          </span>
          {!isBalanced && (
            <span className="font-mono text-red-400">diff ${fmt(Math.abs(diff))}</span>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none shrink-0">
          <input
            type="checkbox"
            checked={consolidate}
            onChange={(e) => setConsolidate(e.target.checked)}
            className="rounded border-gray-600"
          />
          <span className={consolidate ? 'text-cyan-400' : 'text-gray-500'}>
            🔗 Consolidate
          </span>
        </label>
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowColMenu((x) => !x)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 px-2.5 py-1.5 rounded transition-colors"
          >
            <span>☰</span>
            <span>Columns</span>
          </button>
          {showColMenu && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-gray-800 border border-gray-600 rounded-lg shadow-lg p-2 min-w-36">
              {ALL_COLUMNS.map((col) => (
                <label key={col.key} className="flex items-center gap-2 py-1 px-1 hover:bg-gray-700/50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={colVis[col.key]}
                    onChange={(e) => setColVis((prev) => ({ ...prev, [col.key]: e.target.checked }))}
                    className="rounded border-gray-600"
                  />
                  <span className="text-xs text-gray-300">{col.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      {unmappedCount > 0 && (
        <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-amber-900/30 border border-amber-700 text-amber-300">
          <span>⚠️ {unmappedCount} unmapped line{unmappedCount !== 1 ? 's' : ''}</span>
          <span className="text-amber-500">— assign QB accounts before syncing</span>
        </div>
      )}

      {consolidate && rawDisplayLines.length < lines.length && (
        <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-cyan-900/20 border border-cyan-800 text-cyan-400">
          <span>🔗 Consolidated {lines.length} lines → {rawDisplayLines.length} lines</span>
          <span className="text-cyan-600">— {lines.length - rawDisplayLines.length} merged</span>
        </div>
      )}

      {autoBalanced && (
        <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-yellow-900/20 border border-yellow-700 text-yellow-300">
          <span>⚖️ Auto-balanced ${autoBalanced.amount.toFixed(2)} rounding difference</span>
          <span className="text-yellow-500">— adjusted largest line to make debits = credits</span>
        </div>
      )}

      {/* Full column table — scrollable container */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 380 }}>
          <table className="w-full text-xs border-collapse" style={{ minWidth: 580 }}>
            <thead>
              <tr className="border-b border-gray-700 bg-gray-700/50">
                <th className="text-gray-400 font-medium text-left px-2 py-2" style={{ width: 32 }}>#</th>
                {colVis.account && (
                  <th className="text-gray-400 font-medium text-left px-2 py-2" style={{ minWidth: 160 }}>Account</th>
                )}
                {colVis.name && (
                  <th className="text-gray-400 font-medium text-left px-2 py-2" style={{ minWidth: 120 }}>Name</th>
                )}
                {colVis.description && (
                  <th className="text-gray-400 font-medium text-left px-2 py-2" style={{ minWidth: 130 }}>Description</th>
                )}
                {colVis.class && (
                  <th className="text-gray-400 font-medium text-left px-2 py-2" style={{ minWidth: 100 }}>Class</th>
                )}
                {colVis.taxCode && (
                  <th className="text-gray-400 font-medium text-left px-2 py-2" style={{ minWidth: 90 }}>Tax Code</th>
                )}
                {colVis.debit && (
                  <th className="text-gray-400 font-medium text-right px-2 py-2" style={{ width: 96 }}>Debit</th>
                )}
                {colVis.credit && (
                  <th className="text-gray-400 font-medium text-right px-2 py-2" style={{ width: 96 }}>Credit</th>
                )}
                <th className="text-gray-400 font-medium text-center px-1 py-2" style={{ width: 32 }}></th>
              </tr>
            </thead>
            <tbody>
              {effectiveDisplayLines.map((line, idx) => (
                <TableRow
                  key={line.localId}
                  line={line}
                  index={idx}
                  colVis={colVis}
                  accountOptions={accountOptions}
                  entityOptions={entityOptions}
                  classOptions={classOptions}
                  taxCodeOptions={taxCodeOptions}
                  accounts={accounts}
                  onChange={(patch) => updateLine(line.localId, patch)}
                  onRemove={() => removeLine(line.localId)}
                  canRemove={effectiveDisplayLines.length > 1}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-600 bg-gray-700/30 font-semibold">
                <td className="px-2 py-2 text-gray-500">{effectiveDisplayLines.length}</td>
                {colVis.account && <td></td>}
                {colVis.name && <td></td>}
                {colVis.description && (
                  <td className="px-2 py-2 text-gray-500">
                    {effectiveDisplayLines.length} line{effectiveDisplayLines.length !== 1 ? 's' : ''}
                  </td>
                )}
                {colVis.class && <td></td>}
                {colVis.taxCode && <td></td>}
                {colVis.debit && (
                  <td className="px-2 py-2 text-right font-mono text-blue-300 font-bold">
                    ${fmt(totalDebits)}
                  </td>
                )}
                {colVis.credit && (
                  <td className="px-2 py-2 text-right font-mono text-emerald-300 font-bold">
                    ${fmt(totalCredits)}
                  </td>
                )}
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Add line */}
      <button
        type="button"
        onClick={() => setLines((prev) => [...prev, newLine()])}
        className="w-full text-xs text-gray-500 hover:text-gray-300 border border-dashed border-gray-700 hover:border-gray-500 py-1.5 rounded-lg transition-colors"
      >
        + Add Line
      </button>

      {/* Messages */}
      {duplicateWarning && (
        <ErrorCard
          variant="warning"
          message={duplicateWarning}
          onDismiss={() => setDuplicateWarning(null)}
          onRetry={handleForceSync}
        />
      )}
      {autoBalancePending && (
        <ErrorCard
          variant="warning"
          message="Journal entry requires auto-balance adjustment to sync. Proceed with adjusted amounts?"
          onRetry={() => {
            setAutoBalancePending(false);
            void handleSync();
          }}
          onDismiss={() => setAutoBalancePending(false)}
        />
      )}
      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {syncResult && (
        <div className="bg-green-900/40 border border-green-700 text-green-300 text-xs rounded-lg px-3 py-2 space-y-1.5">
          <div>
            {syncResult.skipped ? '✅ Journal Entry already synced' : '✅ Journal Entry created'} —
            <span className="font-mono">{syncResult.id}</span> ({syncResult.txnDate})
          </div>
          {syncResult.docNumber && (
            <div className="text-green-200 text-[11px]">Doc #: {syncResult.docNumber}</div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(syncResult.id).catch(() => {})}
              className="text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-800 hover:border-cyan-600 px-2 py-0.5 rounded transition-colors"
            >
              Copy ID
            </button>
            <a
              href={`${status.environment === 'sandbox' ? 'https://app.sandbox.qbo.intuit.com' : 'https://app.qbo.intuit.com'}/app/journal?txnId=${syncResult.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-cyan-400 hover:underline"
            >
              View in QuickBooks ↗
            </a>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleClearAll}
          className="px-3 py-2 text-xs text-red-400 border border-red-800 hover:bg-red-900/20 rounded-lg transition-colors"
        >
          Clear All
        </button>
        <button
          onClick={() => {
            if (autoBalanced && !autoBalancePending) {
              setAutoBalancePending(true);
              return;
            }
            void handleSync();
          }}
          disabled={syncing || !isBalanced || !allMapped || effectiveDisplayLines.every((l) => !l.accountId)}
          className="flex-1 py-2.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-bold rounded-lg transition-colors"
        >
          {syncing
            ? 'Syncing to QuickBooks…'
            : !isBalanced
              ? '⚠️ Journal Entry is Unbalanced'
              : !allMapped
                ? `⚠️ ${unmappedCount} unmapped line${unmappedCount !== 1 ? 's' : ''} — assign all accounts`
                : '⚡ Sync to QuickBooks'}
        </button>
      </div>
    </div>
  );
}

// ── TableRow ──────────────────────────────────────────────────────────────────

interface TableRowProps {
  line: LineItem;
  index: number;
  colVis: Record<ColKey, boolean>;
  accountOptions: SelectOption[];
  entityOptions: SelectOption[];
  classOptions: SelectOption[];
  taxCodeOptions: SelectOption[];
  accounts: QBAccount[];
  onChange: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function TableRow({
  line, index, colVis,
  accountOptions, entityOptions, classOptions, taxCodeOptions, accounts,
  onChange, onRemove, canRemove,
}: TableRowProps) {
  return (
    <tr className={`border-b border-gray-700/60 ${index % 2 === 1 ? 'bg-gray-800/40' : ''}`}>
      <td className="px-2 py-1 text-gray-600 text-center text-xs">{index + 1}</td>

      {colVis.account && (
        <td className="px-1 py-1" style={{ minWidth: 160, maxWidth: 220 }}>
          <div className="relative">
            {!line.accountId && (
              <span className="absolute -top-3 left-0 text-[10px] bg-amber-900 text-amber-300 px-1 rounded z-10">
                ⚠️ UNMAPPED
              </span>
            )}
            <SearchableSelect
              options={accountOptions}
              value={line.accountId}
              onChange={(v) => {
                const acct = accounts.find((a) => a.Id === v);
                onChange({ accountId: v, accountName: acct?.FullyQualifiedName ?? '' });
              }}
              placeholder="Account…"
            />
          </div>
        </td>
      )}

      {colVis.name && (
        <td className="px-1 py-1" style={{ minWidth: 120, maxWidth: 180 }}>
          <SearchableSelect
            options={entityOptions}
            value={line.entityVal}
            onChange={(v) => onChange({ entityVal: v })}
            placeholder="Name…"
          />
        </td>
      )}

      {colVis.description && (
        <td className="px-1 py-1" style={{ minWidth: 130 }}>
          <input
            className="w-full bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
            value={line.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Description…"
            maxLength={4000}
          />
        </td>
      )}

      {colVis.class && (
        <td className="px-1 py-1" style={{ minWidth: 100, maxWidth: 140 }}>
          <SearchableSelect
            options={classOptions}
            value={line.classId}
            onChange={(v) => onChange({ classId: v })}
            placeholder={classOptions.length === 0 ? '—' : 'Class…'}
            disabled={classOptions.length === 0}
          />
        </td>
      )}

      {colVis.taxCode && (
        <td className="px-1 py-1" style={{ minWidth: 90, maxWidth: 130 }}>
          <SearchableSelect
            options={taxCodeOptions}
            value={line.taxCodeId}
            onChange={(v) => onChange({ taxCodeId: v })}
            placeholder={taxCodeOptions.length === 0 ? '—' : 'Tax…'}
            disabled={taxCodeOptions.length === 0}
          />
        </td>
      )}

      {colVis.debit && (
        <td className="px-1 py-1" style={{ width: 96 }}>
          <input
            type="number"
            min="0"
            step="0.01"
            className="w-full bg-gray-900 border border-gray-700 text-blue-300 text-xs rounded px-2 py-1 text-right focus:border-blue-500 focus:outline-none font-mono"
            value={line.debit}
            placeholder="0.00"
            onChange={(e) => onChange({ debit: e.target.value, credit: e.target.value ? '' : line.credit })}
          />
        </td>
      )}

      {colVis.credit && (
        <td className="px-1 py-1" style={{ width: 96 }}>
          <input
            type="number"
            min="0"
            step="0.01"
            className="w-full bg-gray-900 border border-gray-700 text-emerald-300 text-xs rounded px-2 py-1 text-right focus:border-emerald-500 focus:outline-none font-mono"
            value={line.credit}
            placeholder="0.00"
            onChange={(e) => onChange({ credit: e.target.value, debit: e.target.value ? '' : line.debit })}
          />
        </td>
      )}

      <td className="px-1 py-1 text-center" style={{ width: 32 }}>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-gray-600 hover:text-red-400 transition-colors"
            title="Remove line"
          >
            🗑️
          </button>
        )}
      </td>
    </tr>
  );
}

