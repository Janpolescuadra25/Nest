import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import { useQuickBooks } from '../hooks/useQuickBooks';
import { useQBContext } from '../contexts/QBContext';
import SearchableSelect from './SearchableSelect';
import SmartDatePicker from './SmartDatePicker';
import type { ScanData } from '../../types';
import type { SelectOption } from './SearchableSelect';

interface LineItem {
  localId: string;
  accountId: string;
  description: string;
  debit: string;
  credit: string;
  classId: string;
  taxCodeId: string;
  entityVal: string; // "type:id" or ""
}

function newLine(overrides?: Partial<LineItem>): LineItem {
  return {
    localId: `line-${Date.now()}-${Math.random()}`,
    accountId: '',
    description: '',
    debit: '',
    credit: '',
    classId: '',
    taxCodeId: '',
    entityVal: '',
    ...overrides,
  };
}

function toYMD(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

// Heuristic posting type from field name
function guessPostingType(field: string): 'debit' | 'credit' {
  const lower = field.toLowerCase();
  if (/cash|credit card|debit card|gift card|discount|comp\b|net sales|total/.test(lower))
    return 'debit';
  if (/sales|revenue|tax|tip|gratuity|fee|charge/.test(lower)) return 'credit';
  return 'debit';
}

interface Props {
  jwt: string;
  scanData: ScanData | null;
  selectedLocationId: string;
}

export default function JournalEntryPreview({ jwt, scanData, selectedLocationId: _loc }: Props) {
  const { status, connect } = useQuickBooks(jwt);
  const { locations } = useLocations(jwt);
  const {
    accounts,
    classes,
    taxCodes,
    listsLoaded,
    listsLoading,
    syncAllLists,
  } = useQBContext();

  const today = toYMD(new Date());
  const [txnDate, setTxnDate] = useState(today);
  const [privateNote, setPrivateNote] = useState('');
  const [lines, setLines] = useState<LineItem[]>([newLine(), newLine()]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ id: string; txnDate: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load QB lists if needed
  useEffect(() => {
    if (!listsLoaded && !listsLoading) void syncAllLists();
  }, [listsLoaded, listsLoading, syncAllLists]);

  // Build lines from scan data when it changes
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

  const classOptions = useMemo((): SelectOption[] =>
    classes.filter((c) => c.Active).map((c) => ({ value: c.Id, label: c.FullyQualifiedName })),
    [classes],
  );

  const taxCodeOptions = useMemo((): SelectOption[] =>
    taxCodes.filter((t) => t.Active).map((t) => ({ value: t.Id, label: t.Name, subtitle: t.Description })),
    [taxCodes],
  );

  const updateLine = (localId: string, patch: Partial<LineItem>) => {
    setLines((prev) => prev.map((l) => (l.localId === localId ? { ...l, ...patch } : l)));
  };

  const removeLine = (localId: string) => {
    setLines((prev) => prev.filter((l) => l.localId !== localId));
  };

  const totalDebits = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const diff = totalCredits - totalDebits;
  const isBalanced = Math.abs(diff) < 0.01;

  const handleSync = useCallback(async () => {
    if (!isBalanced) return;
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const jeLines = lines
        .filter((l) => parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0)
        .flatMap((l) => {
          const items = [];
          if (parseFloat(l.debit) > 0) {
            items.push({
              amount: parseFloat(l.debit),
              postingType: 'Debit',
              accountRef: { value: l.accountId },
              description: l.description || undefined,
              classRef: l.classId ? { value: l.classId } : undefined,
            });
          }
          if (parseFloat(l.credit) > 0) {
            items.push({
              amount: parseFloat(l.credit),
              postingType: 'Credit',
              accountRef: { value: l.accountId },
              description: l.description || undefined,
              classRef: l.classId ? { value: l.classId } : undefined,
            });
          }
          return items;
        });

      const result = await api.createJournalEntry(
        jwt,
        txnDate,
        jeLines,
        undefined,
        privateNote || `Nest sync — ${txnDate} — ${locations[0]?.name ?? ''}`,
      ) as { journalEntryId: string; txnDate: string };

      setSyncResult({ id: result.journalEntryId, txnDate: result.txnDate });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [jwt, lines, txnDate, privateNote, locations, isBalanced]);

  if (!status.connected) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <div className="text-3xl mb-3">🔗</div>
        <p className="text-gray-400 text-sm mb-1">QuickBooks not connected</p>
        <p className="text-gray-600 text-xs mb-3">Connect QuickBooks in Settings to sync journal entries</p>
        <button
          onClick={connect}
          className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-4 py-2 rounded-lg"
        >
          Connect QuickBooks
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {/* QB Status */}
      <div className="flex items-center gap-2 text-xs px-3 py-1.5 bg-green-900/20 border border-green-800 rounded-lg">
        <span className="text-green-400">✅ QB Connected</span>
        <span className="text-gray-600 truncate">{status.realmId}</span>
        <button
          onClick={() => void syncAllLists()}
          disabled={listsLoading}
          className="ml-auto text-gray-500 hover:text-gray-300"
          title="Refresh QB lists"
        >
          {listsLoading ? '…' : '↻'}
        </button>
      </div>

      {/* Header — date + note */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
        <div>
          <div className="text-xs text-gray-500 mb-1">Transaction Date</div>
          <SmartDatePicker value={txnDate} onChange={setTxnDate} />
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-0.5">Memo / Private Note</div>
          <input
            className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
            value={privateNote}
            onChange={(e) => setPrivateNote(e.target.value)}
            placeholder={`Nest sync — ${txnDate} — ${locations[0]?.name ?? ''}`}
          />
        </div>
      </div>

      {/* Balance status */}
      <div className={`flex items-center justify-between text-xs px-3 py-1.5 rounded-lg ${
        isBalanced
          ? 'bg-green-900/30 border border-green-800 text-green-400'
          : 'bg-red-900/30 border border-red-800 text-red-400'
      }`}>
        <span>{isBalanced ? '✓ Balanced' : '⚠️ Unbalanced'}</span>
        <span className="font-mono text-gray-400">
          Dr ${totalDebits.toFixed(2)} / Cr ${totalCredits.toFixed(2)}
          {!isBalanced && <span className="text-red-400"> (diff ${Math.abs(diff).toFixed(2)})</span>}
        </span>
      </div>

      {/* Line items table */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        {/* Column headers */}
        <div className="grid grid-cols-[1fr_auto_auto] gap-0 border-b border-gray-700">
          <div className="text-xs text-gray-500 px-3 py-1.5">Account / Description</div>
          <div className="text-xs text-gray-500 px-2 py-1.5 text-right w-20">Debit</div>
          <div className="text-xs text-gray-500 px-2 py-1.5 text-right w-20">Credit</div>
        </div>

        {lines.map((line, idx) => (
          <LineRow
            key={line.localId}
            line={line}
            index={idx}
            accountOptions={accountOptions}
            classOptions={classOptions}
            taxCodeOptions={taxCodeOptions}
            onChange={(patch) => updateLine(line.localId, patch)}
            onRemove={() => removeLine(line.localId)}
            canRemove={lines.length > 1}
          />
        ))}

        {/* Totals */}
        <div className="grid grid-cols-[1fr_auto_auto] border-t border-gray-700 bg-gray-700/30">
          <div className="px-3 py-1.5 text-xs text-gray-400 font-semibold">Total</div>
          <div className="px-2 py-1.5 text-right w-20 font-mono text-blue-300 text-xs font-bold">
            ${totalDebits.toFixed(2)}
          </div>
          <div className="px-2 py-1.5 text-right w-20 font-mono text-emerald-300 text-xs font-bold">
            ${totalCredits.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Add line button */}
      <button
        type="button"
        onClick={() => setLines((prev) => [...prev, newLine()])}
        className="w-full text-xs text-gray-500 hover:text-gray-300 border border-dashed border-gray-700 hover:border-gray-500 py-1.5 rounded-lg transition-colors"
      >
        + Add Line
      </button>

      {/* Error / result */}
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

      {/* Sync button */}
      <button
        onClick={() => void handleSync()}
        disabled={syncing || !isBalanced || lines.every((l) => !l.accountId)}
        className="w-full py-2.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-bold rounded-lg transition-colors"
      >
        {syncing
          ? 'Syncing to QuickBooks…'
          : !isBalanced
          ? 'Journal Entry is Unbalanced'
          : '⚡ Sync to QuickBooks'}
      </button>
    </div>
  );
}

// ── LineRow sub-component ─────────────────────────────────────────────────────

interface LineRowProps {
  line: LineItem;
  index: number;
  accountOptions: SelectOption[];
  classOptions: SelectOption[];
  taxCodeOptions: SelectOption[];
  onChange: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function LineRow({
  line,
  index,
  accountOptions,
  classOptions,
  taxCodeOptions,
  onChange,
  onRemove,
  canRemove,
}: LineRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border-b border-gray-700/60 ${index % 2 === 1 ? 'bg-gray-800/40' : ''}`}>
      {/* Main row */}
      <div className="grid grid-cols-[1fr_auto_auto] items-start gap-0">
        <div className="px-2 py-1.5 space-y-1">
          <SearchableSelect
            options={accountOptions}
            value={line.accountId}
            onChange={(v) => onChange({ accountId: v })}
            placeholder="Account…"
          />
          <div className="flex items-center gap-1">
            <input
              className="flex-1 bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
              value={line.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Description…"
            />
            <button
              type="button"
              onClick={() => setExpanded((x) => !x)}
              className="text-gray-600 hover:text-gray-400 text-xs px-1"
              title="More options"
            >
              {expanded ? '▲' : '⚙'}
            </button>
            {canRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="text-gray-600 hover:text-red-400 text-xs px-1"
                title="Remove line"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        {/* Debit */}
        <div className="px-1 py-1.5 w-20">
          <input
            type="number"
            min="0"
            step="0.01"
            className="w-full bg-gray-900 border border-gray-700 text-blue-300 text-xs rounded px-2 py-1 text-right focus:border-blue-500 focus:outline-none font-mono"
            value={line.debit}
            placeholder="0.00"
            onChange={(e) => onChange({ debit: e.target.value, credit: e.target.value ? '' : line.credit })}
          />
        </div>
        {/* Credit */}
        <div className="px-1 py-1.5 w-20">
          <input
            type="number"
            min="0"
            step="0.01"
            className="w-full bg-gray-900 border border-gray-700 text-emerald-300 text-xs rounded px-2 py-1 text-right focus:border-emerald-500 focus:outline-none font-mono"
            value={line.credit}
            placeholder="0.00"
            onChange={(e) => onChange({ credit: e.target.value, debit: e.target.value ? '' : line.debit })}
          />
        </div>
      </div>

      {/* Expanded — class + tax code */}
      {expanded && (
        <div className="px-2 pb-2 grid grid-cols-2 gap-2">
          <SearchableSelect
            label="Class"
            options={classOptions}
            value={line.classId}
            onChange={(v) => onChange({ classId: v })}
            placeholder={classOptions.length === 0 ? 'None' : 'Class…'}
            disabled={classOptions.length === 0}
          />
          <SearchableSelect
            label="Tax Code"
            options={taxCodeOptions}
            value={line.taxCodeId}
            onChange={(v) => onChange({ taxCodeId: v })}
            placeholder={taxCodeOptions.length === 0 ? 'None' : 'Tax…'}
            disabled={taxCodeOptions.length === 0}
          />
        </div>
      )}
    </div>
  );
}

