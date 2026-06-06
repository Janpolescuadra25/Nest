import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../../lib/api';
import { useLocations } from '../../hooks/useLocations';
import { useQBContext } from '../../contexts/QBContext';
import { useQuickBooks } from '../../hooks/useQuickBooks';
import { useToast } from '../Toast';
import { ErrorCard, DashboardSkeleton, EmptyState } from '../shared';
import MappingFilters from './MappingFilters';
import MappingTable from './MappingTable';
import type { Mapping, ScanData, TabId, ExportTemplate } from '../../types';
import type { SelectOption } from '../SearchableSelect';

export interface LocalMapping {
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

const AUTO_DETECT: { patterns: RegExp; postingType: 'Debit' | 'Credit'; accountHint: string }[] = [
  { patterns: /Revenue\.Net Sales/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Revenue\.Gratuity/i, postingType: 'Credit', accountHint: 'Tips' },
  { patterns: /Revenue\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Net Sales\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Tips\./i, postingType: 'Credit', accountHint: 'Tips' },
  { patterns: /Cash Activity\.Cash tips/i, postingType: 'Debit', accountHint: 'Cash' },
  { patterns: /Cash Activity\.Credit/i, postingType: 'Credit', accountHint: 'Tips' },
  { patterns: /Cash Activity\./i, postingType: 'Debit', accountHint: 'Cash' },
  { patterns: /Cash Summary\./i, postingType: 'Debit', accountHint: 'Cash' },
  { patterns: /Payments\.Cash\./i, postingType: 'Debit', accountHint: 'Cash' },
  { patterns: /Payments\.(Credit|Amex|Discover|Mastercard|Visa)\./i, postingType: 'Debit', accountHint: 'Undeposited' },
  { patterns: /Payments\.Gift Card\./i, postingType: 'Debit', accountHint: 'Gift Card' },
  { patterns: /Payments\.House Account\./i, postingType: 'Debit', accountHint: 'Accounts Receivable' },
  { patterns: /Payments\.Other\./i, postingType: 'Debit', accountHint: 'Undeposited' },
  { patterns: /Payments\./i, postingType: 'Debit', accountHint: 'Undeposited' },
  { patterns: /Sales Category\.Food/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Sales Category\.(Liquor|Beer|Wine|Beverage|Bar)/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Sales Category\.Merchandise/i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Sales Category\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Tax\./i, postingType: 'Credit', accountHint: 'Sales Tax' },
  { patterns: /Discount\./i, postingType: 'Debit', accountHint: 'Discounts' },
  { patterns: /Service Charge\./i, postingType: 'Credit', accountHint: 'Other Income' },
  { patterns: /Void\./i, postingType: 'Debit', accountHint: 'Discounts' },
  { patterns: /Unpaid Orders\./i, postingType: 'Debit', accountHint: 'Accounts Receivable' },
  { patterns: /Revenue Center\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Service Daypart\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Dining Option\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Service Mode\./i, postingType: 'Credit', accountHint: 'Sales of Product' },
  { patterns: /Deferred\./i, postingType: 'Credit', accountHint: 'Deferred Revenue' },
];

interface Props {
  jwt: string;
  selectedLocationId: string;
  onLocationChange: (id: string) => void;
  scanData: ScanData | null;
  onTabChange: (tab: TabId) => void;
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
  let keepSeparate = m.keepSeparate ?? false;
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
  } catch {
    // ignore
  }

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
  const { status: qbStatus } = useQuickBooks(jwt);
  const { showToast } = useToast();

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

  const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [pendingImport, setPendingImport] = useState<ExportTemplate | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const locId = selectedLocationId || locations[0]?.id || '';

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

  const debouncedSaveTemplates = useCallback((memo: string, doc: string) => {
    if (!locId || !jwt) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.updateLocation(jwt, locId, { memoTemplate: memo || undefined, docNumberTemplate: doc || undefined })
        .catch(() => { /* silent — will retry on next change */ });
    }, 1500);
  }, [locId, jwt]);

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

  useEffect(() => {
    if (!locId) return;
    const loc = locations.find((l) => l.id === locId);
    if (loc) {
      setMemoTemplate(loc.memoTemplate ?? '');
      setDocNumberTemplate(loc.docNumberTemplate ?? '');
    } else {
      setMemoTemplate('');
      setDocNumberTemplate('');
    }
  }, [locId, locations]);

  useEffect(() => {
    if (!locId || !jwt) return;
    const lsKey = `nest_templates_${locId}`;
    const raw = localStorage.getItem(lsKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { memoTemplate?: string; docNumberTemplate?: string };
      const loc = locations.find((l) => l.id === locId);
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

  useEffect(() => {
    debouncedSaveTemplates(memoTemplate, docNumberTemplate);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [memoTemplate, docNumberTemplate, debouncedSaveTemplates]);

  useEffect(() => {
    if (!selectedLocationId && locations[0]) onLocationChange(locations[0].id);
  }, [locations, selectedLocationId, onLocationChange]);

  const updateMapping = (localId: string, patch: Partial<LocalMapping>) => {
    setLocalMappings((prev) => prev.map((mapping) => (
      mapping.localId === localId ? { ...mapping, ...patch, isDirty: true } : mapping
    )));
  };

  const toggleExpand = (localId: string) => {
    setLocalMappings((prev) => prev.map((mapping) => (
      mapping.localId === localId ? { ...mapping, expanded: !mapping.expanded } : mapping
    )));
  };

  const addMapping = () => {
    const newMapping: LocalMapping = {
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
    setLocalMappings((prev) => [...prev, newMapping]);
  };

  const saveMapping = async (mapping: LocalMapping, priority: number) => {
    if (!mapping.sourceField || !mapping.accountId) {
      setError('Source field and QB Account are required');
      return;
    }
    setSaving(mapping.localId);
    setError(null);
    try {
      const payload = encodeToApi(mapping, priority);
      if (mapping.remoteId) {
        await api.updateMapping(jwt, mapping.remoteId, payload);
      } else {
        const created = await api.createMapping(jwt, locId, payload);
        setLocalMappings((prev) => prev.map((item) => (
          item.localId === mapping.localId
            ? { ...item, remoteId: created.id, localId: created.id, isDirty: false }
            : item
        )));
        return;
      }
      setLocalMappings((prev) => prev.map((item) => (
        item.localId === mapping.localId ? { ...item, isDirty: false } : item
      )));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(null);
    }
  };

  const deleteMapping = async (mapping: LocalMapping) => {
    if (mapping.remoteId && !window.confirm('Delete this mapping?')) return;
    if (!mapping.remoteId) {
      setLocalMappings((prev) => prev.filter((item) => item.localId !== mapping.localId));
      return;
    }
    setDeleting(mapping.localId);
    try {
      await api.deleteMapping(jwt, mapping.remoteId);
      setLocalMappings((prev) => prev.filter((item) => item.localId !== mapping.localId));
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
    const newMappings: LocalMapping[] = [];
    const scanFields = Object.keys(scanData);

    scanFields.forEach((field) => {
      if (localMappings.some((mapping) => mapping.sourceField === field)) return;
      const rule = AUTO_DETECT.find((rule) => rule.patterns.test(field));
      if (!rule) return;
      const matchedAccount = accounts.find(
        (account) => account.Active && account.FullyQualifiedName.toLowerCase().includes(rule.accountHint.toLowerCase()),
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
      applied += 1;
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
      .filter((item) => !localMappings.some((mapping) => mapping.sourceField === item.field))
      .map((item) => {
        const matchedAccount = accounts.find(
          (account) => account.Active && account.FullyQualifiedName.toLowerCase().includes(item.accountHint.toLowerCase()),
        );
        return {
          localId: `tpl-${Date.now()}-${item.field}`,
          remoteId: undefined,
          sourceField: item.field,
          accountId: matchedAccount?.Id ?? '',
          postingType: item.postingType,
          description: item.field,
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

  const handleExport = useCallback(async () => {
    if (!locId || !jwt) return;
    try {
      const [mappings, rules] = await Promise.all([
        api.getMappings(jwt, locId),
        api.getRules(jwt, locId),
      ]);
      const loc = locations.find((l) => l.id === locId);
      const exportData: ExportTemplate = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sourceLocationName: loc?.name ?? 'Unknown',
        sourceRealmId: qbStatus?.realmId ?? '',
        memoTemplate,
        docNumberTemplate,
        mappings: mappings.map((mapping) => ({
          sourceField: mapping.sourceField,
          targetAccount: mapping.targetAccount,
          postingType: mapping.postingType ?? 'Credit',
          keepSeparate: mapping.keepSeparate ?? false,
          targetClass: mapping.targetClass ?? undefined,
          targetName: mapping.targetName ?? undefined,
          targetDescription: mapping.targetDescription ?? undefined,
          targetMemo: mapping.targetMemo ?? undefined,
          priority: mapping.priority,
        })),
        rules: rules.map((rule) => ({
          name: rule.name,
          ruleType: rule.ruleType,
          config: rule.config as Record<string, unknown>,
          isActive: rule.isActive,
        })),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `nest-template-${(loc?.name ?? 'location').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      showToast(`Exported ${mappings.length} mappings + ${rules.length} rules`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error');
    }
  }, [jwt, locId, locations, memoTemplate, docNumberTemplate, qbStatus, showToast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as ExportTemplate;
        if (!data.version || !data.mappings || !data.rules) {
          showToast('Invalid template file format', 'error');
          return;
        }
        if (data.version !== 1) {
          showToast('Unsupported template version', 'error');
          return;
        }
        const currentRealmId = qbStatus?.realmId;
        if (data.sourceRealmId && currentRealmId && data.sourceRealmId !== currentRealmId) {
          setImportWarning('This template was exported from a different QuickBooks company. Some account references may not match. Verify mappings after import.');
        } else {
          setImportWarning(null);
        }
        setPendingImport(data);
        setShowImportConfirm(true);
      } catch {
        showToast('Failed to read template file', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [qbStatus, showToast]);

  const handleImportConfirm = useCallback(async () => {
    if (!pendingImport || !locId || !jwt) return;
    try {
      const result = await api.importTemplate(jwt, locId, {
        mappings: pendingImport.mappings,
        rules: pendingImport.rules,
        memoTemplate: pendingImport.memoTemplate,
        docNumberTemplate: pendingImport.docNumberTemplate,
        mode: importMode,
      });
      showToast(`Imported ${result.createdMappings} mappings + ${result.createdRules} rules${result.templatesUpdated ? ' + templates' : ''}`, 'success');
      void loadMappings();
      const loc = locations.find((l) => l.id === locId);
      if (loc) {
        setMemoTemplate(pendingImport.memoTemplate ?? loc.memoTemplate ?? '');
        setDocNumberTemplate(pendingImport.docNumberTemplate ?? loc.docNumberTemplate ?? '');
      }
      setShowImportConfirm(false);
      setPendingImport(null);
      setImportWarning(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed', 'error');
    }
  }, [pendingImport, locId, jwt, importMode, showToast, loadMappings, locations]);

  const totalDebits = localMappings
    .filter((mapping) => mapping.postingType === 'Debit')
    .reduce((sum, mapping) => sum + Math.abs(scanData?.[mapping.sourceField] ?? 0), 0);
  const totalCredits = localMappings
    .filter((mapping) => mapping.postingType === 'Credit')
    .reduce((sum, mapping) => sum + Math.abs(scanData?.[mapping.sourceField] ?? 0), 0);
  const diff = totalCredits - totalDebits;
  const isBalanced = Math.abs(diff) < 0.01;

  const buildEntityOptions = useCallback((query: string): SelectOption[] => {
    return searchEntities(query || '').map((entity) => ({
      value: `${entity.type}:${entity.id}`,
      label: entity.displayName,
      subtitle: entity.type,
    }));
  }, [searchEntities]);

  return (
    <div className="p-3 space-y-3">
      <MappingFilters
        locId={locId}
        locations={locations}
        onLocationChange={onLocationChange}
        onExport={handleExport}
        onImport={() => fileInputRef.current?.click()}
        onAddMapping={addMapping}
        onAutoDetect={autoDetect}
        onApplyTemplate={applyTemplate}
        onSyncLists={() => void syncAllLists()}
        listsLoading={listsLoading}
        accountsLoaded={accounts.length > 0}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileSelect}
      />

      {showImportConfirm && pendingImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-80 space-y-3">
            <h3 className="text-sm font-semibold text-white">Import Template</h3>
            <p className="text-xs text-gray-400">
              Import from: <span className="text-gray-200">{pendingImport.sourceLocationName || 'Unknown'}</span>
            </p>
            <div className="text-xs text-gray-400 space-y-1">
              <p>{pendingImport.mappings.length} mappings, {pendingImport.rules.length} rules</p>
              <p>Templates: {(pendingImport.memoTemplate || pendingImport.docNumberTemplate) ? 'Yes' : 'No'}</p>
            </div>
            {importWarning && (
              <div className="bg-orange-900/30 border border-orange-700 text-orange-300 text-xs rounded px-3 py-2">
                ⚠️ {importWarning}
              </div>
            )}
            <div className="space-y-2">
              <div className="text-xs text-gray-400">Mode:</div>
              <div className="flex gap-2">
                <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'merge'}
                    onChange={() => setImportMode('merge')}
                    className="accent-cyan-500"
                  />
                  Merge (add to existing)
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'replace'}
                    onChange={() => setImportMode('replace')}
                    className="accent-red-500"
                  />
                  Replace all
                </label>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowImportConfirm(false);
                  setPendingImport(null);
                  setImportWarning(null);
                }}
                className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleImportConfirm()}
                className="flex-1 text-xs bg-cyan-700 hover:bg-cyan-600 text-white py-2 rounded-lg transition-colors"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {autoMsg && (
        <div className="bg-green-900/30 border border-green-700 text-green-300 text-xs rounded-lg px-3 py-2">
          {autoMsg}
        </div>
      )}
      {error && <ErrorCard message={error} onDismiss={() => setError(null)} />}

      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setMemoOpen((current) => !current)}
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

            {scanFieldChips.length > 0 ? (
              <div>
                <button
                  type="button"
                  onClick={() => setFieldsExpanded(!fieldsExpanded)}
                  className="text-xs text-gray-400 hover:text-white cursor-pointer flex items-center gap-1 mb-1.5"
                >
                  <span className="text-xs">{fieldsExpanded ? '▾' : '▸'}</span>
                  {fieldsExpanded ? 'Hide available fields' : `Show available fields (${scanFieldChips.length})`}
                </button>
                {fieldsExpanded && (
                  <>
                    <div className="text-xs text-gray-500 mb-1.5">
                      Click to insert into Memo · <span className="text-purple-400">#</span> to insert into Doc #:
                    </div>
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

      {loading ? (
        <DashboardSkeleton type="list" rows={3} />
      ) : localMappings.length === 0 ? (
        <EmptyState
          icon="🗂️"
          title="No mappings yet"
          description="Add a mapping or use Auto-Detect to get started."
          action={{ label: 'Add mapping', onClick: addMapping }}
        />
      ) : (
        <MappingTable
          localMappings={localMappings}
          accountOptions={accountOptions}
          classOptions={classOptions}
          taxCodeOptions={taxCodeOptions}
          scanFieldOptions={scanFieldOptions}
          entityOptions={buildEntityOptions('')}
          saving={saving}
          deleting={deleting}
          onUpdate={updateMapping}
          onSave={saveMapping}
          onDelete={deleteMapping}
          onToggleExpand={toggleExpand}
        />
      )}

      {localMappings.length > 0 && (
        <div className="border-t border-gray-700 pt-3 space-y-2">
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
                localMappings.filter((mapping) => mapping.isDirty).forEach((mapping, index) => void saveMapping(mapping, index));
              }}
              disabled={!localMappings.some((mapping) => mapping.isDirty)}
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
