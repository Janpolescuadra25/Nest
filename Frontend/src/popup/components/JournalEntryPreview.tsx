import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import { useQuickBooks } from '../hooks/useQuickBooks';
import { useQBContext } from '../contexts/QBContext';
import SearchableSelect from './SearchableSelect';
import SmartDatePicker from './SmartDatePicker';
import type { ScanData } from '../../types';
import type { SelectOption } from './SearchableSelect';
import type { QBAccount } from '../types/qb';

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
    ...overrides,
  };
}

function toYMD(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function guessPostingType(field: string): 'debit' | 'credit' {
  const lower = field.toLowerCase();
  if (/cash|credit card|debit card|gift card|discount|comp\b|net sales|total/.test(lower)) return 'debit';
  if (/sales|revenue|tax|tip|gratuity|fee|charge/.test(lower)) return 'credit';
  return 'debit';
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  jwt: string;
  scanData: ScanData | null;
  selectedLocationId: string;
}

export default function JournalEntryPreview({ jwt, scanData, selectedLocationId: _loc }: Props) {
  const { status, connect } = useQuickBooks(jwt);
  const { locations } = useLocations(jwt);
  const {
    accounts, classes, employees, vendors, customers, taxCodes,
    listsLoaded, listsLoading, syncAllLists,
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
  const [syncResult, setSyncResult] = useState<{ id: string; txnDate: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Persist column visibility
  useEffect(() => {
    localStorage.setItem(LS_COL_KEY, JSON.stringify(colVis));
  }, [colVis]);

  // Load QB lists on mount
  useEffect(() => {
    if (!listsLoaded && !listsLoading) void syncAllLists();
  }, [listsLoaded, listsLoading, syncAllLists]);

  // Build lines from scan data
  useEffect(() => {
    if (!scanData) return;
    const scanLines: LineItem[] = Object.entries(scanData)
      .filter(([, v]) => v !== 0)
      .map(([field, amount]) => {
        const side = guessPostingType(field);
        return newLine({
          description: field,
          debit: side === 'debit' ? Math.abs(amount).toFixed(2) : '',
          credit: side === 'credit' ? Math.abs(amount).toFixed(2) : '',
        });
      });
    if (scanLines.length > 0) setLines(scanLines);
  }, [scanData]);

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

  const totalDebits = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const diff = totalDebits - totalCredits;
  const isBalanced = Math.abs(diff) < 0.01;

  const handleClearAll = () => {
    setLines([newLine(), newLine()]);
    setDocNumber('');
    setPrivateNote('');
    setIsAdjusting(false);
    setError(null);
    setSyncResult(null);
  };

  const handleSync = useCallback(async () => {
    if (!isBalanced) return;
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const jeLines = lines
        .filter((l) => parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0)
        .flatMap((l) => {
          const debitAmt = parseFloat(l.debit) || 0;
          const creditAmt = parseFloat(l.credit) || 0;
          let entityRef: { value: string; name?: string } | undefined;
          if (l.entityVal) {
            const parts = l.entityVal.split(':');
            const eId = parts[1];
            const opt = entityOptions.find((o) => o.value === l.entityVal);
            if (eId) entityRef = { value: eId, name: opt?.label };
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
        jwt, txnDate, jeLines, docNumber || undefined,
        privateNote || `Nest sync — ${txnDate} — ${locations[0]?.name ?? ''}`,
      ) as { journalEntryId: string; txnDate: string };

      setSyncResult({ id: result.journalEntryId, txnDate: result.txnDate });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [jwt, lines, txnDate, docNumber, privateNote, locations, entityOptions, isBalanced]);

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

      {/* Full column table */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
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
              {lines.map((line, idx) => (
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
                  canRemove={lines.length > 1}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-600 bg-gray-700/30 font-semibold">
                <td className="px-2 py-2 text-gray-500">{lines.length}</td>
                {colVis.account && <td></td>}
                {colVis.name && <td></td>}
                {colVis.description && (
                  <td className="px-2 py-2 text-gray-500">
                    {lines.length} line{lines.length !== 1 ? 's' : ''}
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
      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {syncResult && (
        <div className="bg-green-900/40 border border-green-700 text-green-300 text-xs rounded-lg px-3 py-2">
          ✅ Journal Entry created — ID: <span className="font-mono">{syncResult.id}</span> ({syncResult.txnDate})
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
          onClick={() => void handleSync()}
          disabled={syncing || !isBalanced || lines.every((l) => !l.accountId)}
          className="flex-1 py-2.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-bold rounded-lg transition-colors"
        >
          {syncing ? 'Syncing to QuickBooks…' : !isBalanced ? '⚠️ Journal Entry is Unbalanced' : '⚡ Sync to QuickBooks'}
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
          <SearchableSelect
            options={accountOptions}
            value={line.accountId}
            onChange={(v) => {
              const acct = accounts.find((a) => a.Id === v);
              onChange({ accountId: v, accountName: acct?.FullyQualifiedName ?? '' });
            }}
            placeholder="Account…"
          />
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

