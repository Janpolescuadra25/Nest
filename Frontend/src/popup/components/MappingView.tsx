import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  keepSeparate: boolean;
  isDirty: boolean;
  expanded: boolean;
}

function encodeToApi(m: LocalMapping, priority: number): Omit<Mapping, 'id' | 'locationId' | 'createdAt'> {
  return {
    sourceField: m.sourceField,
    targetAccount: m.accountId,
    postingType: m.postingType,
    keepSeparate: m.keepSeparate,
    targetClass: m.classId || undefined,
    targetDescription: m.description || undefined,
    targetMemo: JSON.stringify({
      amountRule: m.amountRule,
      taxCodeId: m.taxCodeId || undefined,
      entityType: m.entityType || undefined,
      entityId: m.entityId || undefined,
    }),
    priority,
  };
}

function decodeFromApi(m: Mapping): LocalMapping {
  let postingType: 'Debit' | 'Credit' = (m.postingType === 'Debit' || m.postingType === 'Credit') ? m.postingType : 'Credit';
  let keepSeparate: boolean = m.keepSeparate ?? false;
  let extra: {
    postingType?: string;
    amountRule?: string;
    keepSeparate?: boolean;
    taxCodeId?: string;
    entityType?: string;
    entityId?: string;
  } = {};

  try {
    if (m.targetMemo) {
      extra = JSON.parse(m.targetMemo) as typeof extra;
      if (m.postingType === undefined && (extra.postingType === 'Debit' || extra.postingType === 'Credit')) {
        postingType = extra.postingType;
      }
      if (m.keepSeparate === undefined && extra.keepSeparate !== undefined) {
        keepSeparate = extra.keepSeparate;
      }
    }
  } catch { /* ignore */ }

  return {
    localId: m.id,
    remoteId: m.id,
    sourceField: m.sourceField,
    accountId: m.targetAccount,
    postingType,
    description: m.targetDescription ?? '',
    classId: m.targetClass ?? '',
    taxCodeId: extra.taxCodeId ?? '',
    entityType: (extra.entityType as LocalMapping['entityType']) ?? '',
    entityId: extra.entityId ?? '',
    amountRule: extra.amountRule ?? 'Direct Amount',
    keepSeparate,
    isDirty: false,
    expanded: false,
  };
}

// Auto-detect patterns: matches scan field names to QB account name fragments + posting type
const AUTO_DETECT: { patterns: RegExp; postingType: 'Debit' | 'Credit'; accountHint: string }[] = [
  // Revenue section
  { patterns: /Revenue\.Net Sales/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Revenue\.Gratuity/i, postingType: 'Credit', accountHint: 'Tips' },
  { patterns: /Revenue\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  // Net Sales section
  { patterns: /Net Sales\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  // Tips section
  { patterns: /Tips\./i, postingType: 'Credit', accountHint: 'Tips' },
  // Cash Activity section
  { patterns: /Cash Activity\.Cash tips/i, postingType: 'Debit', accountHint: 'Cash' },
  { patterns: /Cash Activity\.Credit/i, postingType: 'Credit', accountHint: 'Tips' },
  { patterns: /Cash Activity\./i, postingType: 'Debit', accountHint: 'Cash' },
  // Cash Summary section
  { patterns: /Cash Summary\./i, postingType: 'Debit', accountHint: 'Cash' },
  // Payments section — debit side (money coming IN)
  { patterns: /Payments\.Cash\./i, postingType: 'Debit', accountHint: 'Cash' },
  { patterns: /Payments\.(Credit|Amex|Discover|Mastercard|Visa)\./i, postingType: 'Debit', accountHint: 'Undeposited' },
  { patterns: /Payments\.Gift Card\./i, postingType: 'Debit', accountHint: 'Gift Card' },
  { patterns: /Payments\.House Account\./i, postingType: 'Debit', accountHint: 'Accounts Receivable' },
  { patterns: /Payments\.Other\./i, postingType: 'Debit', accountHint: 'Undeposited' },
  { patterns: /Payments\./i, postingType: 'Debit', accountHint: 'Undeposited' },
  // Sales Category section
  { patterns: /Sales Category\.Food/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Sales Category\.(Liquor|Beer|Wine|Beverage|Bar)/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Sales Category\.Merchandise/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Sales Category\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  // Tax section
  { patterns: /Tax\./i, postingType: 'Credit', accountHint: 'Sales Tax' },
  // Discount section — debit (contra-revenue)
  { patterns: /Discount\./i, postingType: 'Debit', accountHint: 'Discounts' },
  // Service Charge section
  { patterns: /Service Charge\./i, postingType: 'Credit', accountHint: 'Other Income' },
  // Void section
  { patterns: /Void\./i, postingType: 'Debit', accountHint: 'Discounts' },
  // Unpaid Orders section
  { patterns: /Unpaid Orders\./i, postingType: 'Debit', accountHint: 'Accounts Receivable' },
  // Revenue Center section
  { patterns: /Revenue Center\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  // Service Daypart section
  { patterns: /Service Daypart\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  // Dining Option section
  { patterns: /Dining Option\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  // Service Mode section
  { patterns: /Service Mode\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  // Deferred section
  { patterns: /Deferred\./i, postingType: 'Credit', accountHint: 'Deferred Revenue' },
];

const AMOUNT_RULES = ['Direct Amount', 'Percentage of Total', 'Static Value'];

function resolveMemoTemplate(template: string, data: Record<string, number> | null): string {
  if (!template || !data) return '';
  return template.replace(/\{(\w+)\}/g, (match, field: string) => {
    const key = Object.keys(data).find(
      (k) => k.toLowerCase().replace(/\s+/g, '_') === field.toLowerCase(),
    );
    return key !== undefined ? String(data[key]) : match;
  });
}

function insertAtCursor(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  text: string,
  currentValue: string,
  setValue: (val: string) => void,
): void {
  if (!el) { setValue(currentValue + text); return; }
  const start = el.selectionStart ?? currentValue.length;
  const end = el.selectionEnd ?? currentValue.length;
  const newVal = currentValue.slice(0, start) + text + currentValue.slice(end);
  setValue(newVal);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
  });
}

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
    listsError,
    syncAllLists,
    searchEntities,
  } = useQBContext();

  const [localMappings, setLocalMappings] = useState<LocalMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const [memoTemplate, setMemoTemplate] = useState('');
  const [docNumberTemplate, setDocNumberTemplate] = useState('');
  const [memoOpen, setMemoOpen] = useState(true);
  const [fieldsExpanded, setFieldsExpanded] = useState(false);
  const memoTextareaRef = useRef<HTMLTextAreaElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const locId = selectedLocationId || locations[0]?.id || '';

  const debouncedSaveTemplates = useCallback((memo: string, doc: string) => {
    if (!locId || !jwt) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.updateLocation(jwt, locId, { memoTemplate: memo || undefined, docNumberTemplate: doc || undefined })
        .catch(() => { /* silent — will retry on next change */ });
    }, 1500);
  }, [locId, jwt]);

  // Load QB lists on mount if not loaded
  useEffect(() => {
    if (!listsLoaded && !listsLoading && !listsError) void syncAllLists();
  }, [listsLoaded, listsLoading, listsError, syncAllLists]);

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

  // Load templates from location data (DB-backed)
  useEffect(() => {
    if (!locId) return;
    const loc = locations.find(l => l.id === locId);
    if (loc) {
      setMemoTemplate(loc.memoTemplate ?? '');
      setDocNumberTemplate(loc.docNumberTemplate ?? '');
    } else {
      setMemoTemplate('');
      setDocNumberTemplate('');
    }
  }, [locId, locations]);

  // One-time migration: port localStorage templates → DB
  useEffect(() => {
    if (!locId || !jwt) return;
    const lsKey = `nest_templates_${locId}`;
    const raw = localStorage.getItem(lsKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { memoTemplate?: string; docNumberTemplate?: string };
      const loc = locations.find(l => l.id === locId);
      if (loc && !loc.memoTemplate && !loc.docNumberTemplate && (parsed.memoTemplate || parsed.docNumberTemplate)) {
        api.updateLocation(jwt, locId, {
          memoTemplate: parsed.memoTemplate || undefined,
          docNumberTemplate: parsed.docNumberTemplate || undefined,
        }).then(() => {
          localStorage.removeItem(lsKey);
        }).catch(() => { /* silent fail — data is safe in localStorage, will retry next load */ });
      } else {
        localStorage.removeItem(lsKey);
      }
    } catch {
      localStorage.removeItem(lsKey);
    }
  }, [locId, jwt, locations]);

  // Debounced save templates to DB
  useEffect(() => {
    debouncedSaveTemplates(memoTemplate, docNumberTemplate);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [memoTemplate, docNumberTemplate, debouncedSaveTemplates]);

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

  const scanFieldChips = useMemo(() => {
    if (!scanData) return [];
    return Object.keys(scanData).map((field) => ({
      original: field,
      normalized: field.toLowerCase().replace(/\s+/g, '_'),
    }));
  }, [scanData]);

  const memoPreview = useMemo(() => resolveMemoTemplate(memoTemplate, scanData), [memoTemplate, scanData]);
  const docPreview = useMemo(() => resolveMemoTemplate(docNumberTemplate, scanData), [docNumberTemplate, scanData]);

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
      keepSeparate: false,
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
        keepSeparate: false,
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
        { field: 'Revenue.Net sales', postingType: 'Credit', accountHint: 'Sales of Product' },
        { field: 'Revenue.Tax amount', postingType: 'Credit', accountHint: 'Sales Tax' },
        { field: 'Tips.Total tips', postingType: 'Credit', accountHint: 'Tips' },
        { field: 'Payments.Credit/debit.Total', postingType: 'Debit', accountHint: 'Undeposited' },
        { field: 'Payments.Cash.Total', postingType: 'Debit', accountHint: 'Cash' },
      ],
      'Full Service': [
        { field: 'Revenue.Net sales', postingType: 'Credit', accountHint: 'Sales of Product' },
        { field: 'Revenue.Gratuity', postingType: 'Credit', accountHint: 'Tips' },
        { field: 'Revenue.Tax amount', postingType: 'Credit', accountHint: 'Sales Tax' },
        { field: 'Tips.Credit/non-cash tips', postingType: 'Credit', accountHint: 'Tips' },
        { field: 'Tips.Cash tips', postingType: 'Credit', accountHint: 'Tips' },
        { field: 'Discount.Total discounts.Amount', postingType: 'Debit', accountHint: 'Discounts' },
        { field: 'Payments.Credit/debit.Total', postingType: 'Debit', accountHint: 'Undeposited' },
        { field: 'Payments.Cash.Total', postingType: 'Debit', accountHint: 'Cash' },
        { field: 'Payments.Gift Card.Total', postingType: 'Debit', accountHint: 'Gift Card' },
      ],
      'Quick Service': [
        { field: 'Revenue.Net sales', postingType: 'Credit', accountHint: 'Sales of Product' },
        { field: 'Revenue.Tax amount', postingType: 'Credit', accountHint: 'Sales Tax' },
        { field: 'Payments.Credit/debit.Total', postingType: 'Debit', accountHint: 'Undeposited' },
        { field: 'Payments.Cash.Total', postingType: 'Debit', accountHint: 'Cash' },
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
          keepSeparate: false,
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

      {/* Memo & Doc Number Templates */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setMemoOpen((x) => !x)}
          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-700/50 transition-colors"
        >
          <span className="text-xs font-semibold text-gray-300">
            📝 Memo Template <span className="text-gray-600 font-normal">(auto-fills Private Note on journal entry)</span>
          </span>
          <span className="text-gray-500 text-xs">{memoOpen ? '▲' : '▼'}</span>
        </button>
        {memoOpen && (
          <div className="px-3 pb-3 space-y-3 border-t border-gray-700/60 pt-3">
            <p className="text-xs text-gray-500">
              Use <code className="text-cyan-400 bg-gray-900 px-1 rounded">{'{field_name}'}</code> placeholders to insert scan values. Click a chip to insert at cursor.
            </p>

            {/* Memo textarea */}
            <div>
              <div className="text-xs text-gray-500 mb-1">Private Note / Memo</div>
              <textarea
                ref={memoTextareaRef}
                className="w-full bg-gray-900 border border-gray-700 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none resize-none"
                rows={2}
                value={memoTemplate}
                onChange={(e) => setMemoTemplate(e.target.value)}
                placeholder="e.g. Daily Sales — {location} — {report_date}"
              />
              {memoPreview && (
                <p className="text-xs text-gray-600 italic mt-1 truncate">Preview: {memoPreview}</p>
              )}
            </div>

            {/* Doc number input */}
            <div>
              <div className="text-xs text-gray-500 mb-1">
                Doc Number <span className="text-gray-600">(leave blank for QB auto-generate)</span>
              </div>
              <input
                ref={docInputRef}
                className="w-full bg-gray-900 border border-gray-700 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
                value={docNumberTemplate}
                onChange={(e) => setDocNumberTemplate(e.target.value)}
                placeholder="e.g. JE-{location}-{report_date}"
              />
              {docPreview && (
                <p className="text-xs text-gray-600 italic mt-1 truncate">Preview: {docPreview}</p>
              )}
            </div>

            {/* Field chips */}
            {scanFieldChips.length > 0 ? (
              <div>
                <button
                  type="button"
                  onClick={() => setFieldsExpanded(!fieldsExpanded)}
                  className="text-xs text-gray-400 hover:text-white cursor-pointer flex items-center gap-1 mb-1.5"
                >
                  <span className="text-xs">{fieldsExpanded ? '▾' : '▸'}</span>
                  {fieldsExpanded
                    ? 'Hide available fields'
                    : `Show available fields (${scanFieldChips.length})`
                  }
                </button>
                {fieldsExpanded && (
                  <>
                    <div className="text-xs text-gray-500 mb-1.5">Click to insert into Memo · <span className="text-purple-400">#</span> to insert into Doc #:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {scanFieldChips.map((chip) => (
                        <div key={chip.normalized} className="flex rounded overflow-hidden text-xs border border-gray-600">
                          <button
                            type="button"
                            onClick={() => insertAtCursor(memoTextareaRef.current, `{${chip.normalized}}`, memoTemplate, setMemoTemplate)}
                            className="px-2 py-0.5 bg-gray-700 hover:bg-cyan-800 text-gray-300 hover:text-white transition-colors"
                            title={`Insert {${chip.normalized}} into Memo`}
                          >
                            {chip.original}
                          </button>
                          <button
                            type="button"
                            onClick={() => insertAtCursor(docInputRef.current, `{${chip.normalized}}`, docNumberTemplate, setDocNumberTemplate)}
                            className="px-1.5 py-0.5 bg-gray-800 hover:bg-purple-900 text-gray-500 hover:text-purple-300 transition-colors border-l border-gray-600"
                            title={`Insert {${chip.normalized}} into Doc #`}
                          >
                            #
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-600">Scan a Toast report first to see available field chips.</p>
            )}
          </div>
        )}
      </div>

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

          {/* Keep separate toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={m.keepSeparate}
              onChange={(e) => onUpdate({ keepSeparate: e.target.checked, isDirty: true })}
              className="rounded border-gray-600"
            />
            <span className="text-xs text-gray-400">🔒 Keep separate</span>
            <span className="text-xs text-gray-600">— don't merge with other lines</span>
          </label>

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

