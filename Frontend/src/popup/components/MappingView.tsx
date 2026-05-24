import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import { useQBContext } from '../contexts/QBContext';
import SearchableSelect from './SearchableSelect';
import type { Mapping, ScanData, TabId } from '../../types';
import type { SelectOption } from './SearchableSelect';

interface LocalMapping {
  localId: string;
  remoteId?: string;
  sourceField: string;
  accountId: string;
  postingType: 'Debit' | 'Credit';
  description: string;
  classId: string;
  taxCodeId: string;
  entityType: '' | 'customer' | 'vendor' | 'employee';
  entityId: string;
  amountRule: string;
  isDirty: boolean;
  expanded: boolean;
}

function encodeToApi(m: LocalMapping, priority: number): Omit<Mapping, 'id' | 'locationId' | 'createdAt'> {
  return {
    sourceField: m.sourceField,
    targetAccount: m.accountId,
    targetClass: m.classId || undefined,
    targetDescription: m.description || undefined,
    targetMemo: JSON.stringify({
      postingType: m.postingType,
      amountRule: m.amountRule,
      taxCodeId: m.taxCodeId || undefined,
      entityType: m.entityType || undefined,
      entityId: m.entityId || undefined,
    }),
    priority,
  };
}

function decodeFromApi(m: Mapping): LocalMapping {
  let extra: {
    postingType?: string;
    amountRule?: string;
    taxCodeId?: string;
    entityType?: string;
    entityId?: string;
  } = {};
  try {
    if (m.targetMemo) extra = JSON.parse(m.targetMemo) as typeof extra;
  } catch { /* ignore */ }
  return {
    localId: m.id,
    remoteId: m.id,
    sourceField: m.sourceField,
    accountId: m.targetAccount,
    postingType: (extra.postingType as 'Debit' | 'Credit') ?? 'Credit',
    description: m.targetDescription ?? '',
    classId: m.targetClass ?? '',
    taxCodeId: extra.taxCodeId ?? '',
    entityType: (extra.entityType as LocalMapping['entityType']) ?? '',
    entityId: extra.entityId ?? '',
    amountRule: extra.amountRule ?? 'Direct Amount',
    isDirty: false,
    expanded: false,
  };
}

// Auto-detect patterns: matches scan field names to QB account name fragments + posting type
const AUTO_DETECT: { patterns: RegExp; postingType: 'Debit' | 'Credit'; accountHint: string }[] = [
  { patterns: /food sales|food & bev|food rev/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /bev(erage)? sales|bar sales|drink/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /net sales|total sales|gross sales/i, postingType: 'Debit', accountHint: 'Undeposited' },
  { patterns: /tax collect|sales tax/i, postingType: 'Credit', accountHint: 'Sales Tax' },
  { patterns: /tip|gratuity/i, postingType: 'Credit', accountHint: 'Tips' },
  { patterns: /discount|comp\b/i, postingType: 'Debit', accountHint: 'Discounts' },
  { patterns: /gift card sold/i, postingType: 'Credit', accountHint: 'Gift Card' },
  { patterns: /gift card redeem/i, postingType: 'Debit', accountHint: 'Gift Card' },
  { patterns: /delivery fee|service charge/i, postingType: 'Credit', accountHint: 'Other Income' },
  { patterns: /cash$/i, postingType: 'Debit', accountHint: 'Cash' },
  { patterns: /credit card/i, postingType: 'Debit', accountHint: 'Undeposited' },
];

const AMOUNT_RULES = ['Direct Amount', 'Percentage of Total', 'Static Value'];

interface Props {
  jwt: string;
  selectedLocationId: string;
  onLocationChange: (id: string) => void;
  scanData: ScanData | null;
  onTabChange: (tab: TabId) => void;
}

export default function MappingView({
  jwt,
  selectedLocationId,
  onLocationChange,
  scanData,
  onTabChange,
}: Props) {
  const { locations } = useLocations(jwt);
  const {
    accounts,
    classes,
    taxCodes,
    listsLoaded,
    listsLoading,
    syncAllLists,
    searchEntities,
  } = useQBContext();

  const [localMappings, setLocalMappings] = useState<LocalMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);

  const locId = selectedLocationId || locations[0]?.id || '';

  // Load QB lists on mount if not loaded
  useEffect(() => {
    if (!listsLoaded && !listsLoading) void syncAllLists();
  }, [listsLoaded, listsLoading, syncAllLists]);

  const loadMappings = useCallback(async () => {
    if (!locId) return;
    setLoading(true);
    try {
      const data = await api.getMappings(jwt, locId);
      setLocalMappings(data.map(decodeFromApi));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mappings');
    } finally {
      setLoading(false);
    }
  }, [jwt, locId]);

  useEffect(() => { void loadMappings(); }, [loadMappings]);

  useEffect(() => {
    if (!selectedLocationId && locations[0]) onLocationChange(locations[0].id);
  }, [locations, selectedLocationId, onLocationChange]);

  // Build account options grouped by classification
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
    classes.filter((c) => c.Active).map((c) => ({
      value: c.Id,
      label: c.FullyQualifiedName,
    })),
    [classes],
  );

  const taxCodeOptions = useMemo((): SelectOption[] =>
    taxCodes.filter((t) => t.Active).map((t) => ({
      value: t.Id,
      label: t.Name,
      subtitle: t.Description,
    })),
    [taxCodes],
  );

  // Scan field options for source dropdown
  const scanFieldOptions = useMemo((): SelectOption[] => {
    if (!scanData) return [];
    return Object.entries(scanData).map(([field, amount]) => ({
      value: field,
      label: field,
      subtitle: `$${Number(amount).toFixed(2)}`,
    }));
  }, [scanData]);

  const updateMapping = (localId: string, patch: Partial<LocalMapping>) => {
    setLocalMappings((prev) =>
      prev.map((m) => (m.localId === localId ? { ...m, ...patch, isDirty: true } : m)),
    );
  };

  const toggleExpand = (localId: string) => {
    setLocalMappings((prev) =>
      prev.map((m) => (m.localId === localId ? { ...m, expanded: !m.expanded } : m)),
    );
  };

  const addMapping = () => {
    const newM: LocalMapping = {
      localId: `new-${Date.now()}`,
      remoteId: undefined,
      sourceField: '',
      accountId: '',
      postingType: 'Credit',
      description: '',
      classId: '',
      taxCodeId: '',
      entityType: '',
      entityId: '',
      amountRule: 'Direct Amount',
      isDirty: true,
      expanded: true,
    };
    setLocalMappings((prev) => [...prev, newM]);
  };

  const saveMapping = async (m: LocalMapping, priority: number) => {
    if (!m.sourceField || !m.accountId) {
      setError('Source field and QB Account are required');
      return;
    }
    setSaving(m.localId);
    setError(null);
    try {
      const payload = encodeToApi(m, priority);
      if (m.remoteId) {
        await api.updateMapping(jwt, m.remoteId, payload);
      } else {
        const created = await api.createMapping(jwt, locId, payload);
        setLocalMappings((prev) =>
          prev.map((x) =>
            x.localId === m.localId
              ? { ...x, remoteId: created.id, localId: created.id, isDirty: false }
              : x,
          ),
        );
        return;
      }
      setLocalMappings((prev) =>
        prev.map((x) => (x.localId === m.localId ? { ...x, isDirty: false } : x)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(null);
    }
  };

  const deleteMapping = async (m: LocalMapping) => {
    if (m.remoteId && !window.confirm('Delete this mapping?')) return;
    if (!m.remoteId) {
      setLocalMappings((prev) => prev.filter((x) => x.localId !== m.localId));
      return;
    }
    setDeleting(m.localId);
    try {
      await api.deleteMapping(jwt, m.remoteId);
      setLocalMappings((prev) => prev.filter((x) => x.localId !== m.localId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleting(null);
    }
  };

  const autoDetect = () => {
    if (!scanData || accounts.length === 0) {
      setAutoMsg('No scan data or QB accounts loaded');
      return;
    }
    let applied = 0;
    const scanFields = Object.keys(scanData);
    const newMappings: LocalMapping[] = [];

    scanFields.forEach((field) => {
      if (localMappings.some((m) => m.sourceField === field)) return; // already mapped
      const rule = AUTO_DETECT.find((r) => r.patterns.test(field));
      if (!rule) return;
      const matchedAccount = accounts.find(
        (a) => a.Active && a.FullyQualifiedName.toLowerCase().includes(rule.accountHint.toLowerCase()),
      );
      if (!matchedAccount) return;
      newMappings.push({
        localId: `auto-${Date.now()}-${field}`,
        remoteId: undefined,
        sourceField: field,
        accountId: matchedAccount.Id,
        postingType: rule.postingType,
        description: field,
        classId: '',
        taxCodeId: '',
        entityType: '',
        entityId: '',
        amountRule: 'Direct Amount',
        isDirty: true,
        expanded: false,
      });
      applied++;
    });

    setLocalMappings((prev) => [...prev, ...newMappings]);
    setAutoMsg(
      applied > 0
        ? `✅ ${applied} mapping${applied !== 1 ? 's' : ''} auto-detected`
        : 'No new mappings detected',
    );
    setTimeout(() => setAutoMsg(null), 4000);
  };

  const applyTemplate = (templateName: string) => {
    const templates: Record<string, { field: string; postingType: 'Debit' | 'Credit'; accountHint: string }[]> = {
      'Standard Daily': [
        { field: 'Food Sales', postingType: 'Credit', accountHint: 'Sales of Product' },
        { field: 'Beverage Sales', postingType: 'Credit', accountHint: 'Sales of Product' },
        { field: 'Tax Collected', postingType: 'Credit', accountHint: 'Sales Tax' },
        { field: 'Tips', postingType: 'Credit', accountHint: 'Tips' },
        { field: 'Net Sales', postingType: 'Debit', accountHint: 'Undeposited' },
      ],
      'Full Service': [
        { field: 'Food Sales', postingType: 'Credit', accountHint: 'Sales of Product' },
        { field: 'Beverage Sales', postingType: 'Credit', accountHint: 'Sales of Product' },
        { field: 'Discounts', postingType: 'Debit', accountHint: 'Discounts' },
        { field: 'Tax Collected', postingType: 'Credit', accountHint: 'Sales Tax' },
        { field: 'Credit Card Tips', postingType: 'Credit', accountHint: 'Tips' },
        { field: 'Cash Tips', postingType: 'Credit', accountHint: 'Tips' },
        { field: 'Total Sales', postingType: 'Debit', accountHint: 'Undeposited' },
      ],
      'Quick Service': [
        { field: 'Sales', postingType: 'Credit', accountHint: 'Sales of Product' },
        { field: 'Tax', postingType: 'Credit', accountHint: 'Sales Tax' },
        { field: 'Total', postingType: 'Debit', accountHint: 'Undeposited' },
      ],
    };

    const tpl = templates[templateName];
    if (!tpl || accounts.length === 0) return;

    const newMappings = tpl
      .filter((t) => !localMappings.some((m) => m.sourceField === t.field))
      .map((t): LocalMapping => {
        const matchedAccount = accounts.find(
          (a) => a.Active && a.FullyQualifiedName.toLowerCase().includes(t.accountHint.toLowerCase()),
        );
        return {
          localId: `tpl-${Date.now()}-${t.field}`,
          remoteId: undefined,
          sourceField: t.field,
          accountId: matchedAccount?.Id ?? '',
          postingType: t.postingType,
          description: t.field,
          classId: '',
          taxCodeId: '',
          entityType: '',
          entityId: '',
          amountRule: 'Direct Amount',
          isDirty: true,
          expanded: false,
        };
      });

    setLocalMappings((prev) => [...prev, ...newMappings]);
    setAutoMsg(`✅ Template "${templateName}" applied — ${newMappings.length} rows added`);
    setTimeout(() => setAutoMsg(null), 4000);
  };

  // Balance indicator using scan data
  const totalDebits = localMappings
    .filter((m) => m.postingType === 'Debit')
    .reduce((sum, m) => sum + Math.abs(scanData?.[m.sourceField] ?? 0), 0);
  const totalCredits = localMappings
    .filter((m) => m.postingType === 'Credit')
    .reduce((sum, m) => sum + Math.abs(scanData?.[m.sourceField] ?? 0), 0);
  const diff = totalCredits - totalDebits;
  const isBalanced = Math.abs(diff) < 0.01;

  // Entity options (combined customers + vendors + employees)
  const buildEntityOptions = useCallback((query: string): SelectOption[] => {
    return searchEntities(query || '').map((e) => ({
      value: `${e.type}:${e.id}`,
      label: e.displayName,
      subtitle: e.type,
    }));
  }, [searchEntities]);

  return (
    <div className="p-3 space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <select
          value={locId}
          onChange={(e) => onLocationChange(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
        >
          {locations.length === 0 && <option value="">No locations</option>}
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <button
          onClick={addMapping}
          className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-2 py-1.5 rounded whitespace-nowrap transition-colors"
        >
          + Add
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={autoDetect}
          disabled={!scanData || accounts.length === 0}
          className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 px-2 py-1 rounded transition-colors"
        >
          🔍 Auto-Detect
        </button>
        {(['Standard Daily', 'Full Service', 'Quick Service'] as const).map((t) => (
          <button
            key={t}
            onClick={() => applyTemplate(t)}
            disabled={accounts.length === 0}
            className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 px-2 py-1 rounded transition-colors"
          >
            📋 {t}
          </button>
        ))}
        <button
          onClick={() => void syncAllLists()}
          disabled={listsLoading}
          className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 px-2 py-1 rounded transition-colors ml-auto"
          title="Refresh QB lists"
        >
          {listsLoading ? '…' : '↻'}
        </button>
      </div>

      {/* QB loading state */}
      {listsLoading && (
        <div className="text-xs text-cyan-400 text-center py-1 animate-pulse">
          Loading QB accounts…
        </div>
      )}
      {!listsLoaded && !listsLoading && accounts.length === 0 && (
        <div className="bg-amber-900/30 border border-amber-700 text-amber-300 text-xs rounded-lg px-3 py-2">
          ⚠️ QB accounts not loaded. Make sure QuickBooks is connected in Settings.
        </div>
      )}

      {/* Messages */}
      {autoMsg && (
        <div className="bg-green-900/30 border border-green-700 text-green-300 text-xs rounded-lg px-3 py-2">
          {autoMsg}
        </div>
      )}
      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 text-xs rounded-lg px-3 py-2 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-gray-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : localMappings.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-3xl mb-2">🗂️</div>
          <p className="text-gray-400 text-sm mb-1">No mappings yet</p>
          <p className="text-gray-600 text-xs">Add a mapping or use Auto-Detect to get started</p>
        </div>
      ) : (
        <div className="space-y-2">
          {localMappings.map((m, idx) => (
            <MappingCard
              key={m.localId}
              mapping={m}
              index={idx}
              accountOptions={accountOptions}
              classOptions={classOptions}
              taxCodeOptions={taxCodeOptions}
              scanFieldOptions={scanFieldOptions}
              entityOptions={buildEntityOptions('')}
              isSaving={saving === m.localId}
              isDeleting={deleting === m.localId}
              onUpdate={(patch) => updateMapping(m.localId, patch)}
              onSave={() => void saveMapping(m, idx)}
              onDelete={() => void deleteMapping(m)}
              onToggleExpand={() => toggleExpand(m.localId)}
            />
          ))}
        </div>
      )}

      {/* Bottom toolbar */}
      {localMappings.length > 0 && (
        <div className="border-t border-gray-700 pt-3 space-y-2">
          {/* Balance indicator */}
          <div className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${
            isBalanced ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'
          }`}>
            <span className={isBalanced ? 'text-green-400' : 'text-red-400'}>
              {isBalanced ? '✓ Balanced' : '⚠️ Unbalanced'}
            </span>
            <span className="text-gray-400 font-mono">
              Dr ${totalDebits.toFixed(2)} / Cr ${totalCredits.toFixed(2)}
              {!isBalanced && ` (diff: $${Math.abs(diff).toFixed(2)})`}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const dirty = localMappings.filter((m) => m.isDirty);
                dirty.forEach((m, i) => void saveMapping(m, i));
              }}
              disabled={!localMappings.some((m) => m.isDirty)}
              className="flex-1 text-xs bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white py-2 rounded-lg transition-colors"
            >
              💾 Save All Changes
            </button>
            <button
              onClick={() => onTabChange('preview')}
              className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg transition-colors"
            >
              📋 Preview JE →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MappingCard sub-component ─────────────────────────────────────────────────

interface CardProps {
  mapping: LocalMapping;
  index: number;
  accountOptions: SelectOption[];
  classOptions: SelectOption[];
  taxCodeOptions: SelectOption[];
  scanFieldOptions: SelectOption[];
  entityOptions: SelectOption[];
  isSaving: boolean;
  isDeleting: boolean;
  onUpdate: (patch: Partial<LocalMapping>) => void;
  onSave: () => void;
  onDelete: () => void;
  onToggleExpand: () => void;
}

function MappingCard({
  mapping: m,
  accountOptions,
  classOptions,
  taxCodeOptions,
  scanFieldOptions,
  entityOptions,
  isSaving,
  isDeleting,
  onUpdate,
  onSave,
  onDelete,
  onToggleExpand,
}: CardProps) {
  const selectedAccount = accountOptions.find((a) => a.value === m.accountId);

  return (
    <div className={`bg-gray-800 border rounded-lg overflow-hidden transition-all ${
      m.isDirty ? 'border-cyan-700' : 'border-gray-700'
    }`}>
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggleExpand}
          className="text-gray-500 hover:text-gray-300 text-xs shrink-0"
        >
          {m.expanded ? '▼' : '▶'}
        </button>
        <div className="flex-1 min-w-0">
          {scanFieldOptions.length > 0 ? (
            <SearchableSelect
              options={scanFieldOptions}
              value={m.sourceField}
              onChange={(v) => onUpdate({ sourceField: v, description: v || m.description })}
              placeholder="Toast field…"
            />
          ) : (
            <input
              className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
              value={m.sourceField}
              onChange={(e) => onUpdate({ sourceField: e.target.value })}
              placeholder="Toast field name…"
            />
          )}
        </div>
        {/* D/C toggle */}
        <div className="flex rounded overflow-hidden border border-gray-600 shrink-0">
          <button
            type="button"
            onClick={() => onUpdate({ postingType: 'Debit' })}
            className={`text-xs px-2 py-0.5 transition-colors ${
              m.postingType === 'Debit'
                ? 'bg-blue-700 text-blue-100'
                : 'bg-gray-900 text-gray-500 hover:text-gray-300'
            }`}
          >
            Dr
          </button>
          <button
            type="button"
            onClick={() => onUpdate({ postingType: 'Credit' })}
            className={`text-xs px-2 py-0.5 transition-colors ${
              m.postingType === 'Credit'
                ? 'bg-emerald-700 text-emerald-100'
                : 'bg-gray-900 text-gray-500 hover:text-gray-300'
            }`}
          >
            Cr
          </button>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={isDeleting}
          className="text-gray-600 hover:text-red-400 text-xs transition-colors shrink-0"
          title="Delete mapping"
        >
          🗑️
        </button>
      </div>

      {/* Account row (always visible) */}
      <div className="px-3 pb-2">
        <SearchableSelect
          options={accountOptions}
          value={m.accountId}
          onChange={(v) => onUpdate({ accountId: v })}
          placeholder="QB Account…"
        />
        {selectedAccount && (
          <div className="text-xs text-gray-600 mt-0.5 truncate">{selectedAccount.subtitle}</div>
        )}
      </div>

      {/* Expanded body */}
      {m.expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-700/60 pt-2">
          {/* Description */}
          <div>
            <div className="text-xs text-gray-500 mb-0.5">Description</div>
            <input
              className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
              value={m.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              placeholder="Line description…"
            />
          </div>

          {/* Class + Tax Code */}
          <div className="grid grid-cols-2 gap-2">
            <SearchableSelect
              label="Class"
              options={classOptions}
              value={m.classId}
              onChange={(v) => onUpdate({ classId: v })}
              placeholder={classOptions.length === 0 ? 'None' : 'Class…'}
              disabled={classOptions.length === 0}
            />
            <SearchableSelect
              label="Tax Code"
              options={taxCodeOptions}
              value={m.taxCodeId}
              onChange={(v) => onUpdate({ taxCodeId: v })}
              placeholder={taxCodeOptions.length === 0 ? 'None' : 'Tax code…'}
              disabled={taxCodeOptions.length === 0}
            />
          </div>

          {/* Entity + Amount Rule */}
          <div className="grid grid-cols-2 gap-2">
            <SearchableSelect
              label="Entity (opt)"
              options={entityOptions}
              value={m.entityType ? `${m.entityType}:${m.entityId}` : ''}
              onChange={(v) => {
                if (!v) { onUpdate({ entityType: '', entityId: '' }); return; }
                const [type, id] = v.split(':') as [LocalMapping['entityType'], string];
                onUpdate({ entityType: type, entityId: id });
              }}
              placeholder="Customer/Vendor…"
              disabled={entityOptions.length === 0}
            />
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Amount Rule</div>
              <select
                value={m.amountRule}
                onChange={(e) => onUpdate({ amountRule: e.target.value })}
                className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
              >
                {AMOUNT_RULES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Save button */}
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || !m.isDirty}
            className="w-full text-xs bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white py-1.5 rounded transition-colors"
          >
            {isSaving ? 'Saving…' : m.isDirty ? '💾 Save' : '✓ Saved'}
          </button>
        </div>
      )}
    </div>
  );
}

