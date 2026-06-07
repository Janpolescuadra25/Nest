import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../../lib/api';
import { useLocations } from '../../hooks/useLocations';
import { useQBContext } from '../../contexts/QBContext';
import { useQuickBooks } from '../../hooks/useQuickBooks';
import { useToast } from '../Toast';
import { ErrorCard, DashboardSkeleton, EmptyState } from '../shared';
import MappingFilters from './MappingFilters';
import MappingTable from './MappingTable';
import { BILL_FIELD_LABELS, TRANSACTION_TYPE_LABELS, TRANSACTION_TYPES, VENDOR_CREDIT_FIELD_LABELS } from '../../../types';
import type { ExcelParseResult, Mapping, ScanData, ScanEntry, TabId, ExportTemplate, Template } from '../../../types';
import type { SelectOption } from '../SearchableSelect';

export interface LocalMapping {
  localId: string;
  remoteId?: string;
  templateId?: string | null;
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
  scanEntries?: ScanEntry[];
  activeScanEntry?: ScanEntry | null;
  activeScanEntryId?: string | null;
  onActiveScanEntryIdChange?: (id: string) => void;
  onTabChange: (tab: TabId) => void;
  onboardingStep?: number;
  onHasMappings?: () => void;
  onSelectedTemplateChange?: (template: Template | null) => void;
  showExcelImportModal?: boolean;
  setShowExcelImportModal?: (open: boolean) => void;
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
    templateId: m.templateId || undefined,
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
    templateId: m.templateId ?? undefined,
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
  scanEntries,
  activeScanEntry,
  activeScanEntryId,
  onActiveScanEntryIdChange,
  onTabChange,
  onboardingStep = 0,
  onHasMappings,
  onSelectedTemplateChange,
  showExcelImportModal: showExcelImportModalProp,
  setShowExcelImportModal: setShowExcelImportModalProp,
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
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [billDefaults, setBillDefaults] = useState<Record<string, { value: string; name: string } | null>>({});
  const [billDefaultsDirty, setBillDefaultsDirty] = useState(false);
  const [vendorCreditDefaults, setVendorCreditDefaults] = useState<Record<string, { value: string; name: string } | null>>({});
  const [vendorCreditDefaultsDirty, setVendorCreditDefaultsDirty] = useState(false);
  const [showNewTemplateForm, setShowNewTemplateForm] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateType, setNewTemplateType] = useState<keyof typeof TRANSACTION_TYPE_LABELS>('JOURNAL_ENTRY');
  const [editingType, setEditingType] = useState(false);
  const [editingTypeValue, setEditingTypeValue] = useState<keyof typeof TRANSACTION_TYPE_LABELS>('JOURNAL_ENTRY');
  const memoTextareaRef = useRef<HTMLTextAreaElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [pendingImport, setPendingImport] = useState<ExportTemplate | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [excelSheets, setExcelSheets] = useState<ExcelParseResult['sheets']>([]);
  const [selectedExcelSheetName, setSelectedExcelSheetName] = useState<string>('');
  const [excelColumnMappings, setExcelColumnMappings] = useState<Record<string, string>>({});
  const [localExcelImportModalOpen, setLocalExcelImportModalOpen] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);

  const locId = selectedLocationId || locations[0]?.id || '';
  const showExcelImportModal = showExcelImportModalProp ?? localExcelImportModalOpen;
  const setShowExcelImportModal = setShowExcelImportModalProp ?? setLocalExcelImportModalOpen;

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
    if (activeScanEntry) {
      const fieldMap = new Map<string, string>();

      Object.entries(activeScanEntry.header).forEach(([key, value]) => {
        if (!fieldMap.has(key)) {
          fieldMap.set(key, value);
        }
      });

      if (activeScanEntry.lineItems.length > 0) {
        Object.entries(activeScanEntry.lineItems[0]).forEach(([key, value]) => {
          fieldMap.set(key, value);
        });
      }

      return Array.from(fieldMap.entries()).map(([key, value]) => ({
        value: key,
        label: key,
        subtitle: isNaN(Number(value)) || value.trim() === ''
          ? value
          : `$${Number(value).toFixed(2)}`,
      }));
    }

    if (!scanData) return [];

    return Object.entries(scanData).map(([field, amount]) => ({
      value: field,
      label: field,
      subtitle: `$${Number(amount).toFixed(2)}`,
    }));
  }, [activeScanEntry, scanData]);

  const scanFieldChips = useMemo(() => {
    if (!scanData) return [];
    return Object.keys(scanData).map((field) => ({
      original: field,
      normalized: field.toLowerCase().replace(/\s+/g, '_'),
    }));
  }, [scanData]);

  const memoPreview = useMemo(() => resolveMemoTemplate(memoTemplate, scanData), [memoTemplate, scanData]);
  const docPreview = useMemo(() => resolveMemoTemplate(docNumberTemplate, scanData), [docNumberTemplate, scanData]);
  const selectedTemplate = useMemo(() => templates.find((t) => t.id === selectedTemplateId) ?? null, [templates, selectedTemplateId]);
  const isBill = selectedTemplate?.transactionType === 'BILL';
  const isVendorCredit = selectedTemplate?.transactionType === 'VENDOR_CREDIT';
  const isComingSoonType = selectedTemplate?.transactionType === 'BILL_PAYMENT';
  const hidePostingType = isBill || isVendorCredit;
  const showMappingControls = !isComingSoonType;
  const isExcelMode = activeScanEntry?.source === 'excel';
  const activeEntryIndex = scanEntries?.findIndex((entry) => entry.id === activeScanEntryId) ?? -1;
  const totalEntries = scanEntries?.length ?? 0;
  const showEntryNav = totalEntries > 1 && activeScanEntry?.source === 'excel';

  const columnMappingFields = useMemo(() => {
    if (selectedTemplate?.transactionType === 'BILL') {
      return ['vendorRef', 'apAccountRef', 'termsRef', 'dueDate', 'memo', 'docNumber'];
    }
    if (selectedTemplate?.transactionType === 'VENDOR_CREDIT') {
      return ['vendorRef', 'apAccountRef', 'memo', 'docNumber'];
    }
    return ['memo', 'docNumber'];
  }, [selectedTemplate?.transactionType]);

  const getColumnFieldLabel = (field: string) => {
    return BILL_FIELD_LABELS[field] ?? VENDOR_CREDIT_FIELD_LABELS[field] ?? (field === 'memo' ? 'Memo' : field === 'docNumber' ? 'Doc Number' : field);
  };

  useEffect(() => {
    if (selectedTemplate?.transactionType === 'BILL') {
      setBillDefaults((selectedTemplate.defaults as Record<string, { value: string; name: string }> | null) ?? {});
      setBillDefaultsDirty(false);
      setVendorCreditDefaults({});
      setVendorCreditDefaultsDirty(false);
    } else if (selectedTemplate?.transactionType === 'VENDOR_CREDIT') {
      setVendorCreditDefaults((selectedTemplate.defaults as Record<string, { value: string; name: string }> | null) ?? {});
      setVendorCreditDefaultsDirty(false);
      setBillDefaults({});
      setBillDefaultsDirty(false);
    } else {
      setBillDefaults({});
      setBillDefaultsDirty(false);
      setVendorCreditDefaults({});
      setVendorCreditDefaultsDirty(false);
    }
  }, [selectedTemplate]);

  const updateBillDefault = (key: string, value: string) => {
    setBillDefaults((prev) => ({
      ...prev,
      [key]: { value, name: value },
    }));
    setBillDefaultsDirty(true);
  };

  const saveBillDefaults = async () => {
    if (!selectedTemplateId || !jwt) return;
    setTemplatesLoading(true);
    try {
      await api.updateTemplate(jwt, selectedTemplateId, { defaults: billDefaults });
      await loadTemplates();
      setBillDefaultsDirty(false);
      showToast('Bill defaults saved', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save bill defaults', 'error');
    } finally {
      setTemplatesLoading(false);
    }
  };

  const updateVendorCreditDefault = (key: string, value: string) => {
    setVendorCreditDefaults((prev) => ({
      ...prev,
      [key]: { value, name: value },
    }));
    setVendorCreditDefaultsDirty(true);
  };

  const saveVendorCreditDefaults = async () => {
    if (!selectedTemplateId || !jwt) return;
    setTemplatesLoading(true);
    try {
      await api.updateTemplate(jwt, selectedTemplateId, { defaults: vendorCreditDefaults });
      await loadTemplates();
      setVendorCreditDefaultsDirty(false);
      showToast('Vendor Credit defaults saved', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save vendor credit defaults', 'error');
    } finally {
      setTemplatesLoading(false);
    }
  };

  const renderBillHeader = () => (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-3">
      <div className="text-xs font-semibold text-white">Bill Defaults</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs text-gray-400 mb-1">{BILL_FIELD_LABELS.vendorRef}</div>
          <input
            type="text"
            value={billDefaults.vendorRef?.value ?? ''}
            onChange={(e) => updateBillDefault('vendorRef', e.target.value)}
            placeholder="e.g. ABC Vendor"
            className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">{BILL_FIELD_LABELS.apAccountRef}</div>
          <input
            type="text"
            value={billDefaults.apAccountRef?.value ?? ''}
            onChange={(e) => updateBillDefault('apAccountRef', e.target.value)}
            placeholder="e.g. 33"
            className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">{BILL_FIELD_LABELS.termsRef}</div>
          <input
            type="text"
            value={billDefaults.termsRef?.value ?? ''}
            onChange={(e) => updateBillDefault('termsRef', e.target.value)}
            placeholder="e.g. Net 30"
            className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">{BILL_FIELD_LABELS.dueDate}</div>
          <input
            type="text"
            value={billDefaults.dueDate?.value ?? ''}
            onChange={(e) => updateBillDefault('dueDate', e.target.value)}
            placeholder="e.g. 30"
            className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!billDefaultsDirty || templatesLoading}
          onClick={saveBillDefaults}
          className="text-xs bg-cyan-700 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-40 text-white rounded px-3 py-1.5"
        >
          Save Defaults
        </button>
      </div>
    </div>
  );

  const renderVendorCreditHeader = () => (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-3">
      <div className="text-xs font-semibold text-white">Vendor Credit Defaults</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs text-gray-400 mb-1">{VENDOR_CREDIT_FIELD_LABELS.vendorRef}</div>
          <input
            type="text"
            value={vendorCreditDefaults.vendorRef?.value ?? ''}
            onChange={(e) => updateVendorCreditDefault('vendorRef', e.target.value)}
            placeholder="e.g. ABC Vendor"
            className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">{VENDOR_CREDIT_FIELD_LABELS.apAccountRef}</div>
          <input
            type="text"
            value={vendorCreditDefaults.apAccountRef?.value ?? ''}
            onChange={(e) => updateVendorCreditDefault('apAccountRef', e.target.value)}
            placeholder="e.g. 33"
            className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div className="sm:col-span-2">
          <div className="text-xs text-gray-400 mb-1">{VENDOR_CREDIT_FIELD_LABELS.docNumber}</div>
          <input
            type="text"
            value={vendorCreditDefaults.docNumber?.value ?? ''}
            onChange={(e) => updateVendorCreditDefault('docNumber', e.target.value)}
            placeholder="e.g. VC-001"
            className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!vendorCreditDefaultsDirty || templatesLoading}
          onClick={saveVendorCreditDefaults}
          className="text-xs bg-cyan-700 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-40 text-white rounded px-3 py-1.5"
        >
          Save Defaults
        </button>
      </div>
    </div>
  );

  const renderComingSoon = (type: string) => (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 text-center">
      <p className="text-sm text-gray-300">{TRANSACTION_TYPE_LABELS[type] ?? type} form layout is coming soon.</p>
    </div>
  );

  const selectedTemplateHasMappings = useMemo(
    () => selectedTemplateId !== '' && localMappings.some((mapping) => mapping.templateId === selectedTemplateId),
    [localMappings, selectedTemplateId],
  );

  useEffect(() => {
    if (!selectedTemplate) {
      setEditingType(false);
    }
    onSelectedTemplateChange?.(selectedTemplate);
  }, [selectedTemplate, onSelectedTemplateChange]);

  const loadTemplates = useCallback(async () => {
    if (!locId || !jwt) return;
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const data = await api.getTemplates(jwt, locId);
      setTemplates(data);
      setSelectedTemplateId((current) => {
        if (current && data.some((t) => t.id === current)) return current;
        return data[0]?.id ?? '';
      });
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setTemplatesLoading(false);
    }
  }, [jwt, locId]);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  useEffect(() => {
    if (!selectedTemplate) {
      setMemoTemplate('');
      setDocNumberTemplate('');
      return;
    }
    setMemoTemplate(selectedTemplate.memoTemplate ?? '');
    setDocNumberTemplate(selectedTemplate.docNumberTemplate ?? '');
  }, [selectedTemplate]);

  const debouncedSaveTemplates = useCallback((memo: string, doc: string) => {
    if (!selectedTemplateId || !jwt) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.updateTemplate(jwt, selectedTemplateId, { memoTemplate: memo || undefined, docNumberTemplate: doc || undefined })
        .catch(() => { /* silent — will retry on next change */ });
    }, 1500);
  }, [selectedTemplateId, jwt]);

  useEffect(() => {
    if (!listsLoaded && !listsLoading && !listsError) void syncAllLists();
  }, [listsLoaded, listsLoading, listsError, syncAllLists]);

  const loadMappings = useCallback(async () => {
    if (!locId || !selectedTemplateId) {
      setLocalMappings([]);
      return;
    }
    setLoading(true);
    try {
      const data = await api.getMappings(jwt, locId);
      const filtered = data.filter((mapping) => mapping.templateId === selectedTemplateId);
      setLocalMappings(filtered.map(decodeFromApi));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mappings');
    } finally {
      setLoading(false);
    }
  }, [jwt, locId, selectedTemplateId]);

  useEffect(() => {
    if (!locId || !selectedTemplateId) {
      setLocalMappings([]);
      return;
    }
    void loadMappings();
  }, [loadMappings, locId, selectedTemplateId]);

  const handleTemplateChange = (templateId: string) => {
    if (localMappings.some((mapping) => mapping.isDirty)) {
      if (!window.confirm('You have unsaved mapping changes. Switch templates anyway?')) {
        return;
      }
    }
    setSelectedTemplateId(templateId);
  };

  const resetNewTemplateForm = () => {
    setShowNewTemplateForm(false);
    setNewTemplateName('');
    setNewTemplateType('JOURNAL_ENTRY');
  };

  const openNewTemplateForm = () => {
    setEditingType(false);
    setNewTemplateName('');
    setNewTemplateType('JOURNAL_ENTRY');
    setShowNewTemplateForm(true);
  };

  const handleSubmitNewTemplate = async () => {
    if (!locId || !jwt || !newTemplateName.trim()) return;
    setTemplatesLoading(true);
    try {
      const created = await api.createTemplate(jwt, locId, {
        name: newTemplateName.trim(),
        transactionType: newTemplateType,
      });
      setTemplates((prev) => [...prev, created]);
      setSelectedTemplateId(created.id);
      await loadTemplates();
      showToast('Template created', 'success');
      resetNewTemplateForm();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create template', 'error');
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleNewTemplateKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (newTemplateName.trim()) {
        await handleSubmitNewTemplate();
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      resetNewTemplateForm();
    }
  };

  const handleToggleEditingType = () => {
    if (!selectedTemplate) return;
    setEditingType((current) => {
      const next = !current;
      if (!current) {
        setEditingTypeValue(selectedTemplate.transactionType as keyof typeof TRANSACTION_TYPE_LABELS);
      }
      return next;
    });
  };

  const handleEditTemplateTypeChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (!jwt || !selectedTemplateId) return;
    const newType = event.target.value as keyof typeof TRANSACTION_TYPE_LABELS;
    const oldType = editingTypeValue;
    setEditingTypeValue(newType);

    try {
      await api.updateTemplate(jwt, selectedTemplateId, { transactionType: newType });
      await loadTemplates();
      setEditingType(false);
    } catch (err) {
      setEditingTypeValue(oldType);
      showToast(err instanceof Error ? err.message : 'Failed to update template type', 'error');
    }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId || templates.length <= 1) return;
    if (!window.confirm('Delete this template and ALL its mappings? This cannot be undone.')) return;

    setTemplatesLoading(true);
    try {
      await api.deleteTemplate(jwt, selectedTemplateId);
      const remaining = templates.filter((t) => t.id !== selectedTemplateId);
      setTemplates(remaining);
      setSelectedTemplateId(remaining[0]?.id ?? '');
      showToast('Template deleted', 'success');
      if (remaining[0]?.id) {
        void loadMappings();
      } else {
        setLocalMappings([]);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete template', 'error');
    } finally {
      setTemplatesLoading(false);
    }
  };

  const hasReportedMappings = useRef(false);
  useEffect(() => {
    if (localMappings.length > 0 && !hasReportedMappings.current) {
      hasReportedMappings.current = true;
      onHasMappings?.();
    }
  }, [localMappings.length, onHasMappings]);

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
    if (!selectedTemplateId) return;
    const newMapping: LocalMapping = {
      localId: `new-${Date.now()}`,
      remoteId: undefined,
      templateId: selectedTemplateId || undefined,
      sourceField: '',
      accountId: '',
      postingType: selectedTemplate?.transactionType === 'VENDOR_CREDIT' ? 'Debit' : 'Credit',
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
    if (!selectedTemplateId) {
      setAutoMsg('Select a template first before using Auto-Detect.');
      return;
    }
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
        entityType: '' as LocalMapping['entityType'],
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
    if (!selectedTemplateId) {
      setAutoMsg('Select a template first before applying a preset.');
      return;
    }
    const matchingTemplates: Record<string, { field: string; postingType: 'Debit' | 'Credit'; accountHint: string }[]> = {
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

    const tpl = matchingTemplates[templateName];
    if (!tpl || accounts.length === 0) return;

    const newMappings: LocalMapping[] = tpl
      .filter((item) => !localMappings.some((mapping) => mapping.sourceField === item.field))
      .map((item) => {
        const matchedAccount = accounts.find(
          (account) => account.Active && account.FullyQualifiedName.toLowerCase().includes(item.accountHint.toLowerCase()),
        );
        return {
          localId: `tpl-${Date.now()}-${item.field}`,
          remoteId: undefined,
          templateId: selectedTemplateId || undefined,
          sourceField: item.field,
          accountId: matchedAccount?.Id ?? '',
          postingType: item.postingType,
          description: item.field,
          classId: '',
          taxCodeId: '',
          entityType: '' as LocalMapping['entityType'],
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

  const saveExcelColumnMappings = useCallback(async () => {
    if (!selectedTemplateId || !jwt) return;
    try {
      await api.updateTemplate(jwt, selectedTemplateId, {
        columnMappings: excelColumnMappings,
      });
      await loadTemplates();
      showToast('Excel column mappings saved', 'success');
      setShowExcelImportModal(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save Excel mappings', 'error');
    }
  }, [excelColumnMappings, jwt, selectedTemplateId, loadTemplates, showToast]);

  const getAmountForField = (field: string): number => {
    if (activeScanEntry?.lineItems?.[0]) {
      const raw = activeScanEntry.lineItems[0][field];
      if (raw !== undefined && raw !== '') {
        const parsed = Number(raw);
        if (!Number.isNaN(parsed)) return Math.abs(parsed);
      }
    }
    if (activeScanEntry?.header) {
      const raw = activeScanEntry.header[field];
      if (raw !== undefined && raw !== '') {
        const parsed = Number(raw);
        if (!Number.isNaN(parsed)) return Math.abs(parsed);
      }
    }
    return Math.abs(scanData?.[field] ?? 0);
  };

  const totalDebits = localMappings
    .filter((mapping) => mapping.postingType === 'Debit')
    .reduce((sum, mapping) => sum + getAmountForField(mapping.sourceField), 0);
  const totalCredits = localMappings
    .filter((mapping) => mapping.postingType === 'Credit')
    .reduce((sum, mapping) => sum + getAmountForField(mapping.sourceField), 0);
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
      {showEntryNav && (
        <div className="flex items-center justify-between px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg mb-3">
          <button
            type="button"
            onClick={() => {
              const prev = activeEntryIndex - 1;
              if (prev >= 0 && scanEntries) onActiveScanEntryIdChange?.(scanEntries[prev].id);
            }}
            disabled={activeEntryIndex <= 0}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-300 font-medium">
            Entry {activeEntryIndex + 1} of {totalEntries}
          </span>
          <button
            type="button"
            onClick={() => {
              const next = activeEntryIndex + 1;
              if (next < totalEntries && scanEntries) onActiveScanEntryIdChange?.(scanEntries[next].id);
            }}
            disabled={activeEntryIndex >= totalEntries - 1}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
      <MappingFilters
        locId={locId}
        locations={locations}
        onLocationChange={onLocationChange}
        onExport={handleExport}
        onImport={() => fileInputRef.current?.click()}
        onAutoDetect={autoDetect}
        onApplyTemplate={applyTemplate}
        onSyncLists={() => void syncAllLists()}
        listsLoading={listsLoading}
        accountsLoaded={accounts.length > 0}
        showImportButton={showMappingControls}
        disableAutoDetect={isExcelMode}
        disablePresets={isExcelMode}
      />

      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <label className="block text-xs text-gray-400 mb-1">Template</label>
            <select
              value={selectedTemplateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              disabled={templatesLoading}
              className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({TRANSACTION_TYPE_LABELS[template.transactionType] ?? template.transactionType})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!showNewTemplateForm && (
              <button
                type="button"
                onClick={openNewTemplateForm}
                className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded px-3 py-1.5"
              >
                + New
              </button>
            )}
            {selectedTemplate && !showNewTemplateForm && (
              <button
                type="button"
                onClick={handleToggleEditingType}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-white rounded px-3 py-1.5"
              >
                {editingType ? 'Cancel' : 'Edit Type'}
              </button>
            )}
            {editingType && selectedTemplate && (
              <select
                value={editingTypeValue}
                onChange={handleEditTemplateTypeChange}
                className="bg-gray-900 border border-gray-700 text-white text-xs rounded px-2 py-1.5"
              >
                {TRANSACTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TRANSACTION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            )}
            {templates.length > 1 && (
              <button
                type="button"
                onClick={handleDeleteTemplate}
                disabled={templatesLoading}
                className="text-xs bg-red-800 hover:bg-red-700 text-white rounded px-3 py-1.5"
              >
                ✕ Delete
              </button>
            )}
          </div>
        </div>
        {selectedTemplateHasMappings && (
          <div className="text-xs text-orange-300">Changing type may affect existing mappings.</div>
        )}
        {showNewTemplateForm && (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-[1.6fr_1fr]">
              <input
                type="text"
                autoFocus
                placeholder="Template name"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                onKeyDown={handleNewTemplateKeyDown}
                className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
              />
              <select
                value={newTemplateType}
                onChange={(e) => setNewTemplateType(e.target.value as keyof typeof TRANSACTION_TYPE_LABELS)}
                className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
              >
                {TRANSACTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TRANSACTION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!newTemplateName.trim() || templatesLoading}
                onClick={handleSubmitNewTemplate}
                className="text-xs bg-cyan-700 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50 text-white rounded px-3 py-1.5"
              >
                Create
              </button>
              <button
                type="button"
                onClick={resetNewTemplateForm}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-white rounded px-3 py-1.5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {templatesError ? (
          <div className="text-xs text-red-400">{templatesError}</div>
        ) : null}
        {templatesLoading ? (
          <div className="text-xs text-gray-400">Loading templates…</div>
        ) : null}
      </div>

      {!templatesLoading && templates.length === 0 && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 text-center">
          <p className="text-sm text-gray-300 mb-3">No templates yet. Create your first template to start mapping.</p>
          <button
            type="button"
            onClick={openNewTemplateForm}
            className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded px-3 py-1.5"
          >
            Create Default Template
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        aria-label="Import template JSON file"
        className="hidden"
        onChange={handleFileSelect}
      />

      {showExcelImportModal && excelSheets.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-full max-w-3xl space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Excel Column Mappings</h3>
                <p className="text-xs text-gray-400 max-w-2xl">
                  Map the imported spreadsheet columns to fields used by the selected template.
                </p>
                {selectedTemplate?.columnMappings && Object.keys(selectedTemplate.columnMappings).length > 0 && (
                  <p className="text-sm text-gray-500 mt-2">
                    This template has an existing column mapping. Upload a new file to reconfigure it.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowExcelImportModal(false)}
                className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded px-3 py-1.5"
              >
                Close
              </button>
            </div>

            {excelSheets.length > 1 && (
              <div className="space-y-2">
                <div className="text-xs text-gray-400">Worksheet</div>
                <select
                  value={selectedExcelSheetName}
                  onChange={(e) => setSelectedExcelSheetName(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
                >
                  {excelSheets.map((sheet) => (
                    <option key={sheet.name} value={sheet.name}>{sheet.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              {columnMappingFields.map((field) => (
                <div key={field}>
                  <div className="text-xs text-gray-400 mb-1">{getColumnFieldLabel(field)}</div>
                  <select
                    value={excelColumnMappings[field] ?? ''}
                    onChange={(e) => setExcelColumnMappings((prev) => ({ ...prev, [field]: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">Select column</option>
                    {(excelSheets.find((sheet) => sheet.name === selectedExcelSheetName)?.headers ?? []).map((header) => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div>
              <div className="text-xs text-gray-400 mb-2">Preview</div>
              <div className="overflow-x-auto border border-gray-700 rounded-lg bg-gray-950">
                <table className="min-w-full text-left text-xs text-gray-200">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-900 text-gray-300">
                      {(excelSheets.find((sheet) => sheet.name === selectedExcelSheetName)?.headers ?? []).map((header) => (
                        <th key={header} className="px-2 py-2">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(excelSheets.find((sheet) => sheet.name === selectedExcelSheetName)?.rows ?? []).map((row, rowIndex) => (
                      <tr key={rowIndex} className="odd:bg-gray-950 even:bg-gray-900">
                        {(excelSheets.find((sheet) => sheet.name === selectedExcelSheetName)?.headers ?? []).map((header) => (
                          <td key={header} className="px-2 py-2 text-gray-300 truncate max-w-[10rem]">{row[header]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowExcelImportModal(false)}
                className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveExcelColumnMappings()}
                disabled={excelLoading}
                className="text-xs bg-cyan-700 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50 text-white rounded px-3 py-1.5"
              >
                {excelLoading ? 'Saving…' : 'Save Mappings'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {isBill && renderBillHeader()}
      {isVendorCredit && renderVendorCreditHeader()}
      {isComingSoonType ? renderComingSoon(selectedTemplate.transactionType) : (
        loading ? (
          <DashboardSkeleton type="list" rows={3} />
        ) : localMappings.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="No mappings yet"
            description={onboardingStep === 3
              ? 'Create a mapping template to translate your POS data into QuickBooks journal entries'
              : 'Add a mapping or use Auto-Detect to get started.'}
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
            onAddMapping={addMapping}
            isBill={isBill}
            isVendorCredit={isVendorCredit}
          />
        )
      )}

      {!isComingSoonType && selectedTemplate?.transactionType !== 'BILL' && selectedTemplate?.transactionType !== 'VENDOR_CREDIT' && localMappings.length > 0 && (
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
