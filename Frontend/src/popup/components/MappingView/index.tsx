import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../../lib/api';
import { useLocations } from '../../hooks/useLocations';
import { useQBContext } from '../../contexts/QBContext';
import { useQuickBooks } from '../../hooks/useQuickBooks';
import { useToast } from '../Toast';
import { ConfirmDialog, ErrorCard, DashboardSkeleton, EmptyState } from '../shared';
import MappingFilters from './MappingFilters';
import MappingTable from './MappingTable';
import ProductMappingSection from './ProductMappingSection';
import PayeeMappingSection from './PayeeMappingSection';
import ValueMappingSection from './ValueMappingSection';
import TemplateWizard from '../TemplateWizard';
import SearchableSelect from '../SearchableSelect';
import RuleFormSection from './RuleFormSection';
import type { SelectOption } from '../SearchableSelect';
import { sourceToScanMode, getScanModeDisplay, isSectionVisible } from '../../lib/scan-mode-utils';
import { BILL_FIELD_LABELS, TRANSACTION_TYPE_LABELS, VENDOR_CREDIT_FIELD_LABELS, CHEQUE_FIELD_LABELS } from '../../../types';
import type { ColumnMapping, ExcelParseResult, Mapping, MappingCondition, MappingSuggestion, Rule, RuleFormData, ScanData, ScanEntry, TabId, ExportTemplate, Template } from '../../../types';
import type { QBAccount } from '../../types/qb';

/**
 * Validates that a posting type is consistent with an account type.
 * Returns null if valid, or a warning string if potentially incorrect.
 *
 * Basic accounting rules:
 * - Debit INCREASES: Asset, Expense
 * - Credit INCREASES: Liability, Equity, Income
 *
 * This is advisory only — some edge cases (contra accounts, draws, voids) are valid exceptions.
 */
export function validateMappingAccountType(
  accountType: string | undefined,
  postingType: 'Debit' | 'Credit',
): string | null {
  if (!accountType) return null;

  const debitIncreases = ['Asset', 'Expense'];
  const creditIncreases = ['Liability', 'Equity', 'Income'];

  if (postingType === 'Debit' && creditIncreases.includes(accountType)) {
    return `Debit decreases ${accountType} accounts — typically you'd Credit ${accountType} accounts.`;
  }

  if (postingType === 'Credit' && debitIncreases.includes(accountType)) {
    return `Credit decreases ${accountType} accounts — typically you'd Debit ${accountType} accounts.`;
  }

  return null;
}

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
  priority: number;
  conditions?: MappingCondition[] | null;
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

const LINE_ITEM_COLUMN_ROLES = [
  { key: 'productColumn', label: 'Product / Item Name', required: true },
  { key: 'amountColumn', label: 'Amount', required: true },
  { key: 'descriptionColumn', label: 'Description', required: false },
  { key: 'classColumn', label: 'Class', required: false },
  { key: 'taxCodeColumn', label: 'Tax Code', required: false },
] as const;

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
  initialTemplate?: Template | null;
  showExcelImportModal?: boolean;
  setShowExcelImportModal?: (open: boolean) => void;
}

function encodeToApi(m: LocalMapping): Omit<Mapping, 'id' | 'locationId' | 'createdAt'> {
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
    conditions: m.conditions ?? null,
    priority: m.priority,
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
    priority: m.priority ?? 0,
    conditions: (m.conditions as MappingCondition[] | null) ?? null,
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
  initialTemplate,
  showExcelImportModal: showExcelImportModalProp,
  setShowExcelImportModal: setShowExcelImportModalProp,
}: Props) {
  const { locations } = useLocations(jwt);
  const {
    accounts,
    classes,
    taxCodes,
    vendors,
    terms,
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
  const [bankDefault, setBankDefault] = useState<{ value: string; name?: string }>({ value: '' });
  const [payeeDefault, setPayeeDefault] = useState<{ value: string; name?: string }>({ value: '' });
  const [apAccountDefault, setApAccountDefault] = useState<{ value: string; name?: string }>({ value: '' });
  const [termsDefault, setTermsDefault] = useState<{ value: string; name?: string }>({ value: '' });
  const [taxCodeDefault, setTaxCodeDefault] = useState<{ value: string; name?: string }>({ value: '' });
  const [memoDefault, setMemoDefault] = useState<{ value: string; name?: string }>({ value: '' });
  const [docNumberDefault, setDocNumberDefault] = useState<{ value: string; name?: string }>({ value: '' });
  const [memoOpen, setMemoOpen] = useState(true);
  const [fieldsExpanded, setFieldsExpanded] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(initialTemplate?.id ?? '');
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [showNewTemplateForm, setShowNewTemplateForm] = useState(false);
  const memoTextareaRef = useRef<HTMLTextAreaElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const templateReadyRef = useRef(false);
  const [pendingSwitchTemplateId, setPendingSwitchTemplateId] = useState<string | null>(null);
  const [showSwitchTemplateConfirm, setShowSwitchTemplateConfirm] = useState(false);
  const [showDeleteTemplateConfirm, setShowDeleteTemplateConfirm] = useState(false);
  const [showDeleteMappingConfirm, setShowDeleteMappingConfirm] = useState(false);
  const [pendingDeleteMapping, setPendingDeleteMapping] = useState<LocalMapping | null>(null);

  const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [pendingImport, setPendingImport] = useState<ExportTemplate | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [excelSheets, setExcelSheets] = useState<ExcelParseResult['sheets']>([]);
  const [selectedExcelSheetName, setSelectedExcelSheetName] = useState<string>('');
  const [excelColumnMappings, setExcelColumnMappings] = useState<Record<string, string>>({});
  const [localColMap, setLocalColMap] = useState<Record<string, string>>({});
  const [lineItemMappingOpen, setLineItemMappingOpen] = useState(true);
  const [lineItemFieldsOpen, setLineItemFieldsOpen] = useState(false);
  const [localExcelImportModalOpen, setLocalExcelImportModalOpen] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [mappingSuggestions, setMappingSuggestions] = useState<MappingSuggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const locId = selectedLocationId || locations[0]?.id || '';
  if (!locId) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#F5F5F7] p-4">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-center">
          <div className="text-sm font-semibold text-gray-900">Select a location first to start mapping.</div>
          <div className="mt-2 text-xs text-gray-600">Once you select a location, your mapping workflow will appear here.</div>
        </div>
      </div>
    );
  }

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
        subtitle: isNaN(Number(value)) || String(value).trim() === ''
          ? String(value)
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

  const selectedTemplate = useMemo(() => templates.find((t) => t.id === selectedTemplateId) ?? null, [templates, selectedTemplateId]);

  const scanFieldChips = useMemo(() => {
    const chips: Array<{ original: string; normalized: string }> = [];
    if (scanData) {
      chips.push(...Object.keys(scanData).map((field) => ({
        original: field,
        normalized: field.toLowerCase().replace(/\s+/g, '_'),
      })));
    }
    if (activeScanEntry?.header && selectedTemplate?.transactionType !== 'JOURNAL_ENTRY') {
      Object.keys(activeScanEntry.header).forEach((field) => {
        const normalized = field.toLowerCase().replace(/\s+/g, '_');
        if (!chips.some((c) => c.normalized === normalized)) {
          chips.push({ original: field, normalized });
        }
      });
    }
    return chips;
  }, [scanData, activeScanEntry, selectedTemplate?.transactionType]);

  const unmappedCount = useMemo(() => {
    if (!scanData) return 0;
    return Object.keys(scanData).filter(
      (field) => !localMappings.some((mapping) => mapping.sourceField === field),
    ).length;
  }, [scanData, localMappings]);

  const memoPreview = useMemo(() => resolveMemoTemplate(memoTemplate, scanData), [memoTemplate, scanData]);
  const docPreview = useMemo(() => resolveMemoTemplate(docNumberTemplate, scanData), [docNumberTemplate, scanData]);
  const activeScanMode = useMemo(() => {
    if (activeScanEntry?.source) return sourceToScanMode(activeScanEntry.source);
    if (selectedTemplate?.scanModes?.[0]) return selectedTemplate.scanModes[0];
    return 'IMAGE' as const;
  }, [selectedTemplate?.scanModes, activeScanEntry?.source]);
  const hasProductNameColumn = useMemo(() => {
    if (!selectedTemplate?.columnMappings) return false;
    try {
      const mappings = typeof selectedTemplate.columnMappings === 'string'
        ? JSON.parse(selectedTemplate.columnMappings)
        : selectedTemplate.columnMappings;

      return Object.values(mappings).some((v: any) => v && typeof v === 'string' && (
        v === 'productName' ||
        v === 'productColumn' ||
        v.toLowerCase().includes('product')
      ));
    } catch {
      return false;
    }
  }, [selectedTemplate?.columnMappings]);

  const scanProductNames = useMemo(() => {
    try {
      if (!activeScanEntry || activeScanEntry.lineItems.length === 0) return [];

      const lineItems = activeScanEntry.lineItems;
      const mapping = selectedTemplate?.columnMappings;
      const columnMappings = typeof mapping === 'string' ? JSON.parse(mapping) : mapping;
      const productColumn = columnMappings && typeof columnMappings === 'object'
        ? String((columnMappings as Record<string, unknown>).productColumn ?? '').trim()
        : '';

      if (productColumn) {
        return lineItems
          .map((row) => String(row[productColumn] ?? '').trim())
          .filter((value) => value !== '');
      }

      return [];
    } catch {
      return [];
    }
  }, [activeScanEntry, selectedTemplate?.columnMappings]);

  const chequeBankOptions = useMemo(() =>
    accounts
      .filter((a) => a.Active && a.AccountType === 'Bank')
      .map((a) => ({ value: a.Id, label: a.FullyQualifiedName, subtitle: a.AccountSubType ?? undefined })),
    [accounts],
  );

  const chequePayeeOptions = useMemo(() =>
    vendors
      .filter((v) => v.Active)
      .map((v) => ({ value: v.Id, label: v.DisplayName, subtitle: v.CompanyName ?? undefined })),
    [vendors],
  );

  const apAccountOptions = useMemo(() =>
    accounts
      .filter((a) => a.Active && a.AccountType === 'Accounts Payable')
      .map((a) => ({ value: a.Id, label: a.FullyQualifiedName })),
    [accounts],
  );

  const termsOptions = useMemo(() =>
    terms
      .filter((t) => t.Active !== false)
      .map((t) => ({ value: t.Id, label: t.Name, subtitle: t.DueDays ? `Net ${t.DueDays}` : undefined })),
    [terms],
  );

  const isBill = selectedTemplate?.transactionType === 'BILL';
  const isVendorCredit = selectedTemplate?.transactionType === 'VENDOR_CREDIT';
  const isCheque = selectedTemplate?.transactionType === 'CHEQUE';
  const isJE = selectedTemplate?.transactionType === 'JOURNAL_ENTRY';

  const getPreviewLabel = () => {
    switch (selectedTemplate?.transactionType) {
      case 'BILL':
        return 'Bill';
      case 'VENDOR_CREDIT':
        return 'VC';
      case 'CHEQUE':
        return 'Check';
      default:
        return 'JE';
    }
  };

  useEffect(() => {
    setMappingSuggestions([]);
    setSuggestionError(null);
  }, [selectedTemplateId]);
  const hidePostingType = isBill || isVendorCredit;
  const showMappingControls = true;
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
    if (selectedTemplate?.transactionType === 'CHEQUE') {
      return ['bankAccountRef', 'payeeRef', 'memo', 'docNumber'];
    }
    return ['memo', 'docNumber'];
  }, [selectedTemplate?.transactionType]);

  const lineItemHeaders = useMemo(() => {
    const headers = excelSheets.find((sheet) => sheet.name === selectedExcelSheetName)?.headers;
    if (headers && headers.length > 0) {
      return headers;
    }
    if (activeScanEntry?.lineItems?.[0]) {
      return Object.keys(activeScanEntry.lineItems[0]);
    }
    return [] as string[];
  }, [activeScanEntry, excelSheets, selectedExcelSheetName]);

  useEffect(() => {
    if (!selectedTemplate?.columnMappings) {
      setLocalColMap({});
      return;
    }
    const cm = selectedTemplate.columnMappings as Record<string, unknown>;
    const lineItemKeys = Object.keys(cm).filter((key) => !key.startsWith('_header_'));
    const parsed: Record<string, string> = {};
    for (const key of lineItemKeys) {
      parsed[key] = String(cm[key] ?? '');
    }
    setLocalColMap(parsed);
  }, [selectedTemplate]);

  const getColumnFieldLabel = (field: string) => {
    if (selectedTemplate?.transactionType === 'CHEQUE') {
      return CHEQUE_FIELD_LABELS[field] ?? (field === 'memo' ? 'Memo' : field === 'docNumber' ? 'Doc Number' : field);
    }
    if (selectedTemplate?.transactionType === 'VENDOR_CREDIT') {
      return VENDOR_CREDIT_FIELD_LABELS[field] ?? (field === 'memo' ? 'Memo' : field === 'docNumber' ? 'Doc Number' : field);
    }
    return BILL_FIELD_LABELS[field] ?? (field === 'memo' ? 'Memo' : field === 'docNumber' ? 'Doc Number' : field);
  };

  const selectedTemplateHasMappings = useMemo(
    () => selectedTemplateId !== '' && localMappings.some((mapping) => mapping.templateId === selectedTemplateId),
    [localMappings, selectedTemplateId],
  );

  useEffect(() => {
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
      templateReadyRef.current = false;
      return;
    }
    setMemoTemplate(selectedTemplate.memoTemplate ?? '');
    setDocNumberTemplate(selectedTemplate.docNumberTemplate ?? '');

    // Cheque defaults
    const chequeDefaults = selectedTemplate.defaults as Record<string, { value: string; name?: string }> | null | undefined;
    if (chequeDefaults?.bankAccountRef) setBankDefault(chequeDefaults.bankAccountRef);
    if (chequeDefaults?.payeeRef) setPayeeDefault(chequeDefaults.payeeRef);
    if (chequeDefaults?.apAccountRef) setApAccountDefault(chequeDefaults.apAccountRef);
    if (chequeDefaults?.termsRef) setTermsDefault(chequeDefaults.termsRef);
    if (chequeDefaults?.taxCodeRef) setTaxCodeDefault(chequeDefaults.taxCodeRef);
    if (chequeDefaults?.memo) setMemoDefault(chequeDefaults.memo);
    if (chequeDefaults?.docNumber) setDocNumberDefault(chequeDefaults.docNumber);

    templateReadyRef.current = true;
  }, [selectedTemplate]);

  useEffect(() => {
    templateReadyRef.current = false;
  }, [selectedTemplateId, activeScanEntry?.id]);

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
    if (!templateReadyRef.current) return;
    if (!locId || !selectedTemplateId) {
      setLocalMappings([]);
      return;
    }
    void loadMappings();
  }, [loadMappings, locId, selectedTemplateId, selectedTemplate]);

  const handleTemplateChange = (templateId: string) => {
    if (localMappings.some((mapping) => mapping.isDirty)) {
      setPendingSwitchTemplateId(templateId);
      setShowSwitchTemplateConfirm(true);
      return;
    }
    setSelectedTemplateId(templateId);
  };

  const confirmSwitchTemplate = () => {
    if (!pendingSwitchTemplateId) return;
    setShowSwitchTemplateConfirm(false);
    setSelectedTemplateId(pendingSwitchTemplateId);
    setPendingSwitchTemplateId(null);
  };

  const openNewTemplateForm = () => {
    setShowNewTemplateForm(true);
  };


  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId || templates.length <= 1) return;
    setShowDeleteTemplateConfirm(true);
  };

  const confirmDeleteTemplate = async () => {
    if (!selectedTemplateId) return;
    setShowDeleteTemplateConfirm(false);

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
      priority: 0,
      conditions: null,
    };
    setLocalMappings((prev) => [...prev, newMapping]);
  };

  const saveMapping = async (mapping: LocalMapping) => {
    if (!mapping.sourceField || !mapping.accountId) {
      setError('Source field and QB Account are required');
      return;
    }
    setSaving(mapping.localId);
    setError(null);
    try {
      const payload = encodeToApi(mapping);
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
    if (!mapping.remoteId) {
      setLocalMappings((prev) => prev.filter((item) => item.localId !== mapping.localId));
      return;
    }
    setPendingDeleteMapping(mapping);
    setShowDeleteMappingConfirm(true);
  };

  const confirmDeleteMapping = async () => {
    if (!pendingDeleteMapping?.remoteId) {
      setShowDeleteMappingConfirm(false);
      setPendingDeleteMapping(null);
      return;
    }
    const mapping = pendingDeleteMapping;
    setShowDeleteMappingConfirm(false);
    setPendingDeleteMapping(null);
    setDeleting(mapping.localId);
    try {
      await api.deleteMapping(jwt, mapping.remoteId as string);
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
      const expectedTypesForPostingType = (postingType: 'Debit' | 'Credit'): string[] =>
        postingType === 'Debit'
          ? ['Asset', 'Expense']
          : ['Liability', 'Equity', 'Income'];

      const matchedAccount = accounts.find(
        (account) =>
          account.Active &&
          account.FullyQualifiedName.toLowerCase().includes(rule.accountHint.toLowerCase()) &&
          expectedTypesForPostingType(rule.postingType).includes(account.AccountType),
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
        priority: 0,
        conditions: null,
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

  const suggestMappings = async () => {
    if (!selectedTemplateId) {
      setSuggestionError('Select a template first before using AI Suggest.');
      return;
    }
    if (accounts.length === 0) {
      setSuggestionError('No QuickBooks accounts are loaded. Refresh QB lists first.');
      return;
    }

    const sourceFields = scanFieldOptions.map((option) => option.value).filter((value) =>
      !localMappings.some((mapping) => mapping.sourceField === value),
    );
    if (sourceFields.length === 0) {
      setSuggestionError('No unmapped scan fields are available for suggestion.');
      return;
    }

    setSuggesting(true);
    setSuggestionError(null);
    setMappingSuggestions([]);

    try {
      const result = await api.suggestMappings(jwt, locId, sourceFields, selectedTemplate?.transactionType);
      const suggestions = result.suggestions ?? [];
      if (suggestions.length === 0) {
        setSuggestionError('AI did not return any mapping suggestions.');
        return;
      }
      setMappingSuggestions(suggestions);
      setAutoMsg(`🤖 ${suggestions.length} AI suggestion${suggestions.length !== 1 ? 's' : ''} ready`);
      setTimeout(() => setAutoMsg(null), 4000);
    } catch (err: any) {
      const msg = err?.message || 'Failed to fetch AI suggestions';
      if (msg.includes('rate limited') || msg.includes('429')) {
        setSuggestionError('⚠️ AI is busy right now. Please wait about 30 seconds, then try again.');
      } else {
        setSuggestionError(msg);
      }
    } finally {
      setSuggesting(false);
    }
  };

  const applySuggestions = () => {
    if (mappingSuggestions.length === 0) return;

    const existingFields = new Set(localMappings.map((m) => m.sourceField));
    const fresh = mappingSuggestions.filter((s) => !existingFields.has(s.sourceField));
    const skipped = mappingSuggestions.length - fresh.length;

    if (fresh.length === 0) {
      setAutoMsg(`All ${skipped} suggestion${skipped !== 1 ? 's' : ''} already mapped`);
      setMappingSuggestions([]);
      setTimeout(() => setAutoMsg(null), 4000);
      return;
    }

    const newMappings: LocalMapping[] = fresh.map((suggestion) => ({
      localId: `ai-${Date.now()}-${suggestion.sourceField}`,
      remoteId: undefined,
      sourceField: suggestion.sourceField,
      accountId: suggestion.accountId || '',
      postingType: suggestion.postingType,
      description: suggestion.sourceField,
      classId: '',
      taxCodeId: '',
      entityType: '' as LocalMapping['entityType'],
      entityId: '',
      amountRule: 'Direct Amount',
      keepSeparate: false,
      isDirty: true,
      expanded: false,
      priority: 0,
      conditions: null,
    }));

    setLocalMappings((prev) => [...prev, ...newMappings]);
    setMappingSuggestions([]);
    const msg = skipped > 0
      ? `✅ ${fresh.length} applied, ${skipped} already mapped`
      : `✅ ${fresh.length} AI suggestion${fresh.length !== 1 ? 's' : ''} applied`;
    setAutoMsg(msg);
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
          priority: 0,
          conditions: null,
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
          conditions: mapping.conditions ?? null,
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

  const saveLineItemColumnMappings = useCallback(async () => {
    if (!selectedTemplateId || !jwt || !selectedTemplate) return;
    try {
      const merged = {
        ...(selectedTemplate.columnMappings ?? {}),
        ...localColMap,
      };
      if (taxCodeDefault.value) {
        merged.taxCodeRef = { value: taxCodeDefault.value, name: taxCodeDefault.name };
      } else {
        delete merged.taxCodeRef;
      }
      await api.updateTemplate(jwt, selectedTemplateId, {
        columnMappings: merged,
      });
      await loadTemplates();
      showToast('Line item column roles saved', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save line item column roles', 'error');
    }
  }, [jwt, selectedTemplateId, selectedTemplate, localColMap, loadTemplates, showToast]);

  const handleSaveBillDefaults = useCallback(async () => {
    try {
      const existing = (selectedTemplate?.defaults ?? {}) as Record<string, unknown>;
      const merged = { ...existing };
      if (apAccountDefault.value) {
        merged.apAccountRef = { value: apAccountDefault.value, name: apAccountDefault.name };
      } else {
        delete merged.apAccountRef;
      }
      if (termsDefault.value) {
        merged.termsRef = { value: termsDefault.value, name: termsDefault.name };
      } else {
        delete merged.termsRef;
      }
      if (taxCodeDefault.value) {
        merged.taxCodeRef = { value: taxCodeDefault.value, name: taxCodeDefault.name };
      } else {
        delete merged.taxCodeRef;
      }
      if (memoDefault.value) {
        merged.memo = { value: memoDefault.value };
      } else {
        delete merged.memo;
      }
      if (docNumberDefault.value) {
        merged.docNumber = { value: docNumberDefault.value };
      } else {
        delete merged.docNumber;
      }
      await api.updateTemplate(jwt, selectedTemplateId!, { defaults: merged });
      await loadTemplates();
      showToast('Bill defaults saved', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save bill defaults', 'error');
    }
  }, [jwt, selectedTemplateId, selectedTemplate, apAccountDefault, termsDefault, taxCodeDefault, memoDefault, docNumberDefault, loadTemplates, showToast]);

  const handleSaveVendorCreditDefaults = useCallback(async () => {
    try {
      const existing = (selectedTemplate?.defaults ?? {}) as Record<string, unknown>;
      const merged = { ...existing };
      if (apAccountDefault.value) {
        merged.apAccountRef = { value: apAccountDefault.value, name: apAccountDefault.name };
      } else {
        delete merged.apAccountRef;
      }
      if (taxCodeDefault.value) {
        merged.taxCodeRef = { value: taxCodeDefault.value, name: taxCodeDefault.name };
      } else {
        delete merged.taxCodeRef;
      }
      if (memoDefault.value) {
        merged.memo = { value: memoDefault.value };
      } else {
        delete merged.memo;
      }
      if (docNumberDefault.value) {
        merged.docNumber = { value: docNumberDefault.value };
      } else {
        delete merged.docNumber;
      }
      await api.updateTemplate(jwt, selectedTemplateId!, { defaults: merged });
      await loadTemplates();
      showToast('Vendor credit defaults saved', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save vendor credit defaults', 'error');
    }
  }, [jwt, selectedTemplateId, selectedTemplate, apAccountDefault, taxCodeDefault, memoDefault, docNumberDefault, loadTemplates, showToast]);

  const handleSaveChequeDefaults = useCallback(async () => {
    try {
      const existing = (selectedTemplate?.defaults ?? {}) as Record<string, unknown>;
      const merged = { ...existing };
      if (bankDefault.value) {
        merged.bankAccountRef = { value: bankDefault.value, name: bankDefault.name };
      } else {
        delete merged.bankAccountRef;
      }
      if (payeeDefault.value) {
        merged.payeeRef = { value: payeeDefault.value, name: payeeDefault.name };
      } else {
        delete merged.payeeRef;
      }
      if (taxCodeDefault.value) {
        merged.taxCodeRef = { value: taxCodeDefault.value, name: taxCodeDefault.name };
      } else {
        delete merged.taxCodeRef;
      }
      await api.updateTemplate(jwt, selectedTemplateId!, { defaults: merged });
      await loadTemplates();
      showToast('Cheque defaults saved', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save cheque defaults', 'error');
    }
  }, [jwt, selectedTemplateId, selectedTemplate, bankDefault, payeeDefault, taxCodeDefault, loadTemplates, showToast]);

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
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg mb-3">
          <button
            type="button"
            onClick={() => {
              const prev = activeEntryIndex - 1;
              if (prev >= 0 && scanEntries) onActiveScanEntryIdChange?.(scanEntries[prev].id);
            }}
            disabled={activeEntryIndex <= 0}
            className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-600 font-medium">
            Entry {activeEntryIndex + 1} of {totalEntries}
          </span>
          <button
            type="button"
            onClick={() => {
              const next = activeEntryIndex + 1;
              if (next < totalEntries && scanEntries) onActiveScanEntryIdChange?.(scanEntries[next].id);
            }}
            disabled={activeEntryIndex >= totalEntries - 1}
            className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
      {activeScanEntry && (
        <div className="flex items-center gap-2 px-3 py-1.5 mb-3 rounded-md bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          <span className="font-medium">Scan Mode:</span>
          <span className="font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{getScanModeDisplay(activeScanMode)}</span>
          {selectedTemplate?.posSystem && (
            <span className="text-emerald-600 inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap">({selectedTemplate.posSystem})</span>
          )}
        </div>
      )}
      <MappingFilters
        locId={locId}
        locations={locations}
        onLocationChange={onLocationChange}
        onExport={handleExport}
        onImport={() => fileInputRef.current?.click()}
        onAutoDetect={autoDetect}
        onAISuggest={suggestMappings}
        suggesting={suggesting}
        onApplyTemplate={applyTemplate}
        onSyncLists={() => void syncAllLists()}
        listsLoading={listsLoading}
        accountsLoaded={accounts.length > 0}
        showImportButton={showMappingControls}
        disableAutoDetect={isExcelMode}
        disablePresets={isExcelMode}
      />

      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <label className="block text-xs text-gray-600 mb-1">Template</label>
            <select
              value={selectedTemplateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              disabled={templatesLoading}
              className="w-full bg-[#F5F5F7] border border-gray-200 text-gray-900 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({TRANSACTION_TYPE_LABELS[template.transactionType] ?? template.transactionType}) [{template.scanModes?.join('/') ?? ''}{template.posSystem && template.posSystem !== 'generic' ? ` · ${template.posSystem}` : ''}]
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!showNewTemplateForm && (
              <button
                type="button"
                onClick={openNewTemplateForm}
                className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-1.5"
              >
                + New
              </button>
            )}
            {selectedTemplate && !showNewTemplateForm && (
              <div className="text-xs text-gray-600 px-3 py-1.5 rounded border border-gray-200 overflow-hidden text-ellipsis whitespace-nowrap">
                {TRANSACTION_TYPE_LABELS[selectedTemplate.transactionType] ?? selectedTemplate.transactionType}
              </div>
            )}
            {unmappedCount > 0 && (
              <div className="text-xs bg-amber-50 text-amber-900 border border-amber-200 px-3 py-1.5 rounded-lg">
                {unmappedCount} field{unmappedCount !== 1 ? 's' : ''} unmapped
              </div>
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
          <div className="text-xs text-orange-600">Changing type may affect existing mappings.</div>
        )}
        <TemplateWizard
          isOpen={showNewTemplateForm}
          onClose={() => setShowNewTemplateForm(false)}
          onTemplateCreated={(template) => {
            setTemplates((prev) => [...prev, template]);
            setShowNewTemplateForm(false);
            setSelectedTemplateId(template.id);
            showToast('Template created', 'success');
          }}
          jwt={jwt}
          locationId={locId}
        />
        {templatesError ? (
          <div className="text-xs text-red-600 truncate overflow-hidden text-ellipsis whitespace-nowrap">{templatesError}</div>
        ) : null}
        {templatesLoading ? (
          <div className="text-xs text-gray-600">Loading templates…</div>
        ) : null}
      </div>

      {!templatesLoading && templates.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-[#F5F5F7] p-4 text-center">
          <p className="text-sm text-gray-600 mb-3">No templates yet. Create your first template to start mapping.</p>
          <button
            type="button"
            onClick={openNewTemplateForm}
            className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-1.5"
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
          <div className="bg-white border border-gray-200 rounded-lg p-4 w-full max-w-3xl space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Excel Column Mappings</h3>
                <p className="text-xs text-gray-600 max-w-2xl">
                  Map the imported spreadsheet columns to fields used by the selected template.
                </p>
                {selectedTemplate?.columnMappings && Object.keys(selectedTemplate.columnMappings).length > 0 && (
                  <p className="text-sm text-gray-600 mt-2">
                    This template has an existing column mapping. Upload a new file to reconfigure it.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowExcelImportModal(false)}
                className="text-xs bg-white hover:bg-gray-100 text-gray-600 rounded px-3 py-1.5"
              >
                Close
              </button>
            </div>

            {excelSheets.length > 1 && (
              <div className="space-y-2">
                <div className="text-xs text-gray-600">Worksheet</div>
                <select
                  value={selectedExcelSheetName}
                  onChange={(e) => setSelectedExcelSheetName(e.target.value)}
                  className="w-full bg-[#F5F5F7] border border-gray-200 text-gray-900 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
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
                  <div className="text-xs text-gray-600 mb-1">{getColumnFieldLabel(field)}</div>
                  <select
                    value={excelColumnMappings[field] ?? ''}
                    onChange={(e) => setExcelColumnMappings((prev) => ({ ...prev, [field]: e.target.value }))}
                    className="w-full bg-[#F5F5F7] border border-gray-200 text-gray-900 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
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
              <div className="text-xs text-gray-600 mb-2">Preview</div>
              <div className="overflow-x-auto border border-gray-200 rounded-lg bg-gray-50">
                <table className="min-w-full text-left text-xs text-gray-700">
                  <thead>
                    <tr className="border-b border-gray-200 bg-[#F5F5F7] text-gray-600">
                      {(excelSheets.find((sheet) => sheet.name === selectedExcelSheetName)?.headers ?? []).map((header) => (
                        <th key={header} className="px-2 py-2">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(excelSheets.find((sheet) => sheet.name === selectedExcelSheetName)?.rows ?? []).map((row, rowIndex) => (
                      <tr key={rowIndex} className="odd:bg-gray-50 even:bg-white">
                        {(excelSheets.find((sheet) => sheet.name === selectedExcelSheetName)?.headers ?? []).map((header) => (
                          <td key={header} className="px-2 py-2 text-gray-600 truncate max-w-[10rem] overflow-hidden text-ellipsis whitespace-nowrap">{row[header]}</td>
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
                className="text-xs bg-white hover:bg-gray-100 text-gray-600 rounded px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveExcelColumnMappings()}
                disabled={excelLoading}
                className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 text-white rounded px-3 py-1.5"
              >
                {excelLoading ? 'Saving…' : 'Save Mappings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportConfirm && pendingImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white border border-gray-200 rounded-lg p-4 w-80 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Import Template</h3>
            <p className="text-xs text-gray-600">
              Import from: <span className="text-gray-700 inline-block max-w-full truncate overflow-hidden text-ellipsis whitespace-nowrap">{pendingImport.sourceLocationName || 'Unknown'}</span>
            </p>
            <div className="text-xs text-gray-600 space-y-1">
              <p>{pendingImport.mappings.length} mappings, {pendingImport.rules.length} rules</p>
              <p>Templates: {(pendingImport.memoTemplate || pendingImport.docNumberTemplate) ? 'Yes' : 'No'}</p>
            </div>
            {importWarning && (
              <div className="bg-orange-50 border border-orange-200 text-orange-600 text-xs rounded px-3 py-2">
                ⚠️ {importWarning}
              </div>
            )}
            <div className="space-y-2">
              <div className="text-xs text-gray-600">Mode:</div>
              <div className="flex gap-2">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'merge'}
                    onChange={() => setImportMode('merge')}
                    className="accent-emerald-500"
                  />
                  Merge (add to existing)
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
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
                className="flex-1 text-xs bg-gray-200 hover:bg-gray-100 text-gray-600 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleImportConfirm()}
                className="flex-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white py-2 rounded-lg transition-colors"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {autoMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-600 text-xs rounded-lg px-3 py-2">
          {autoMsg}
        </div>
      )}
      {listsError && (
        <ErrorCard message={listsError} onRetry={() => void syncAllLists()} variant="warning" />
      )}
      {error && <ErrorCard message={error} onDismiss={() => setError(null)} />}
      {suggestionError && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2">
          {suggestionError}
        </div>
      )}
      {mappingSuggestions.length > 0 && (
        <div className="bg-[#F5F5F7] border border-gray-200 rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-gray-900">AI Mapping Suggestions</div>
              <div className="text-xs text-gray-600">Review the recommendations below before applying them.</div>
            </div>
            <button
              type="button"
              onClick={applySuggestions}
              disabled={suggesting}
              className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded px-3 py-1.5"
            >
              Apply Suggestions
            </button>
          </div>
          <div className="grid gap-2">
            {mappingSuggestions.map((suggestion) => (
              <div key={suggestion.sourceField} className="border border-gray-200 rounded-lg p-3 bg-white">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-gray-900 overflow-hidden text-ellipsis whitespace-nowrap">{suggestion.sourceField}</div>
                  <span className="text-xs text-gray-600 overflow-hidden text-ellipsis whitespace-nowrap">{suggestion.postingType}</span>
                </div>
                <div className="text-xs text-gray-600 mt-1 overflow-hidden text-ellipsis whitespace-nowrap">Account: {suggestion.accountName || suggestion.accountHint}</div>
                <div className="text-xs text-gray-600 mt-1 overflow-hidden line-clamp-2">{suggestion.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setMemoOpen((current) => !current)}
          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-100 transition-colors"
        >
          <span className="text-xs font-semibold text-gray-600">
            📝 Memo Template <span className="text-gray-600 font-normal">{
              selectedTemplate?.transactionType === 'JOURNAL_ENTRY' ? '(auto-fills Private Note on journal entry)' :
              selectedTemplate?.transactionType === 'CHEQUE' ? '(auto-fills Memo on cheque)' :
              selectedTemplate?.transactionType === 'VENDOR_CREDIT' ? '(auto-fills Memo on vendor credit)' :
              '(auto-fills Private Note on bill)'
            }</span>
          </span>
          <span className="text-gray-600 text-xs">{memoOpen ? '▲' : '▼'}</span>
        </button>
        {memoOpen && (
          <div className="px-3 pb-3 space-y-3 border-t border-gray-200 pt-3">
            <p className="text-xs text-gray-600">
              Use <code className="text-emerald-400 bg-[#F5F5F7] px-1 rounded">{'{field_name}'}</code> placeholders to insert scan values. Click a chip to insert at cursor.
            </p>

            <div>
              <div className="text-xs text-gray-600 mb-1">Private Note / Memo</div>
              <textarea
                ref={memoTextareaRef}
                className="w-full bg-[#F5F5F7] border border-gray-200 text-gray-900 text-xs rounded px-2 py-1.5 focus:border-emerald-500 focus:outline-none resize-none"
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
              <div className="text-xs text-gray-600 mb-1">
                {selectedTemplate?.transactionType === 'JOURNAL_ENTRY' ? 'Doc Number' :
                  selectedTemplate?.transactionType === 'CHEQUE' ? 'Check No.' :
                  selectedTemplate?.transactionType === 'VENDOR_CREDIT' ? 'Credit No.' :
                  'Bill No.'}
                <span className="text-gray-600">(leave blank for QB auto-generate)</span>
              </div>
              <input
                ref={docInputRef}
                className="w-full bg-[#F5F5F7] border border-gray-200 text-gray-900 text-xs rounded px-2 py-1.5 focus:border-emerald-500 focus:outline-none"
                value={docNumberTemplate}
                onChange={(e) => setDocNumberTemplate(e.target.value)}
                placeholder={
                  selectedTemplate?.transactionType === 'JOURNAL_ENTRY' ? 'e.g. JE-{location}-{report_date}' :
                  selectedTemplate?.transactionType === 'CHEQUE' ? 'e.g. CHK-{payee}-{date}' :
                  selectedTemplate?.transactionType === 'VENDOR_CREDIT' ? 'e.g. VC-{vendor}-{date}' :
                  'e.g. BILL-{vendor}-{date}'
                }
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
                  className="text-xs text-gray-600 hover:text-gray-900 cursor-pointer flex items-center gap-1 mb-1.5"
                >
                  <span className="text-xs">{fieldsExpanded ? '▾' : '▸'}</span>
                  {fieldsExpanded ? 'Hide available fields' : `Show available fields (${scanFieldChips.length})`}
                </button>
                {fieldsExpanded && (
                  <>
                    <div className="text-xs text-gray-600 mb-1.5">
                      Click to insert into Memo · <span className="text-emerald-400">#</span> to insert into Doc #:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {scanFieldChips.map((chip) => (
                        <div key={chip.normalized} className="flex rounded overflow-hidden text-xs border border-gray-300">
                          <button
                            type="button"
                            onClick={() => insertAtCursor(memoTextareaRef.current, `{${chip.normalized}}`, memoTemplate, setMemoTemplate)}
                            className="px-2 py-0.5 bg-gray-200 hover:bg-emerald-800 text-gray-600 hover:text-gray-900 transition-colors"
                            title={`Insert {${chip.normalized}} into Memo`}
                          >
                            {chip.original}
                          </button>
                          <button
                            type="button"
                            onClick={() => insertAtCursor(docInputRef.current, `{${chip.normalized}}`, docNumberTemplate, setDocNumberTemplate)}
                            className="px-1.5 py-0.5 bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-600 transition-colors border-l border-gray-300"
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
              <p className="text-xs text-gray-600">
              {selectedTemplate?.transactionType === 'JOURNAL_ENTRY'
                ? 'Scan a Toast report first to see available field chips.'
                : 'Scan a document first to see available field chips.'}
            </p>
            )}
          </div>
        )}
      </div>

      {isSectionVisible('productMatching', activeScanMode, selectedTemplate?.transactionType, { hasProductNameColumn }) && selectedTemplateId && (
        <ProductMappingSection
          jwt={jwt}
          templateId={selectedTemplateId}
          scanProductNames={scanProductNames}
        />
      )}

      {/* Cheque Defaults — bank account + payee for CHEQUE templates */}
      {isCheque && activeScanMode === 'IMAGE' && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Cheque Defaults</h3>
              <p className="text-xs text-gray-600 mb-3">
                  Set default bank account, payee/vendor, and tax code for cheques using this template. These are pre-filled when creating a new cheque.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                      <label className="block text-xs text-gray-600 mb-1">Default Bank Account</label>
                      <SearchableSelect
                          options={chequeBankOptions}
                          value={bankDefault.value}
                          onChange={(value) => {
                              const selected = accounts.find((a) => a.Id === value);
                              setBankDefault({ value, name: selected?.FullyQualifiedName });
                          }}
                          placeholder="Select bank account…"
                      />
                  </div>
                  <div>
                      <label className="block text-xs text-gray-600 mb-1">Default Payee / Vendor</label>
                      <SearchableSelect
                          options={chequePayeeOptions}
                          value={payeeDefault.value}
                          onChange={(value) => {
                              const selected = vendors.find((v) => v.Id === value);
                              setPayeeDefault({ value, name: selected?.DisplayName });
                          }}
                          placeholder="Select payee / vendor…"
                      />
                  </div>
                  <div>
                      <label className="block text-xs text-gray-600 mb-1">Default Tax Code</label>
                      <SearchableSelect
                          options={taxCodeOptions}
                          value={taxCodeDefault.value}
                          onChange={(value) => {
                              const selected = taxCodes.find((t) => t.Id === value);
                              setTaxCodeDefault({ value, name: selected?.Name });
                          }}
                          placeholder="Select tax code…"
                      />
                  </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                  <button
                      type="button"
                      onClick={() => void handleSaveChequeDefaults()}
                      className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-2"
                  >
                      Save Cheque Defaults
                  </button>
              </div>
          </div>
      )}

      {isBill && activeScanMode === 'IMAGE' && selectedTemplateId && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Bill Defaults</h3>
              <p className="text-xs text-gray-600 mb-3">
                  Set defaults for new bills created from this template. Defaults will be applied during bill creation.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                      <label className="block text-xs text-gray-600 mb-1">Default AP Account</label>
                      <SearchableSelect
                          options={apAccountOptions}
                          value={apAccountDefault.value}
                          onChange={(value) => {
                              const selected = accounts.find((a) => a.Id === value);
                              setApAccountDefault({ value, name: selected?.FullyQualifiedName });
                          }}
                          placeholder="Select AP account…"
                      />
                  </div>
                  <div>
                      <label className="block text-xs text-gray-600 mb-1">Default Terms</label>
                      <SearchableSelect
                          options={termsOptions}
                          value={termsDefault.value}
                          onChange={(value) => {
                              const selected = terms.find((t) => t.Id === value);
                              setTermsDefault({ value, name: selected?.Name });
                          }}
                          placeholder="Select terms…"
                      />
                  </div>
                  <div>
                      <label className="block text-xs text-gray-600 mb-1">Default Tax Code</label>
                      <SearchableSelect
                          options={taxCodeOptions}
                          value={taxCodeDefault.value}
                          onChange={(value) => {
                              const selected = taxCodes.find((t) => t.Id === value);
                              setTaxCodeDefault({ value, name: selected?.Name });
                          }}
                          placeholder="Select tax code…"
                      />
                  </div>
                  <div>
                      <label className="block text-xs text-gray-600 mb-1">Default Memo</label>
                      <input
                          type="text"
                          value={memoDefault.value}
                          onChange={(e) => setMemoDefault({ value: e.target.value })}
                          className="w-full bg-[#F5F5F7] border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
                          placeholder="Enter default memo"
                      />
                  </div>
                  <div>
                      <label className="block text-xs text-gray-600 mb-1">Default Doc #</label>
                      <input
                          type="text"
                          value={docNumberDefault.value}
                          onChange={(e) => setDocNumberDefault({ value: e.target.value })}
                          className="w-full bg-[#F5F5F7] border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
                          placeholder="Enter default doc number"
                      />
                  </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                  <button
                      type="button"
                      onClick={() => void handleSaveBillDefaults()}
                      className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-2"
                  >
                      Save Bill Defaults
                  </button>
              </div>
          </div>
      )}

      {isVendorCredit && activeScanMode === 'IMAGE' && selectedTemplateId && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Vendor Credit Defaults</h3>
              <p className="text-xs text-gray-600 mb-3">
                  Set defaults for new vendor credits created from this template. Defaults will be applied during vendor credit creation.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                      <label className="block text-xs text-gray-600 mb-1">Default AP Account</label>
                      <SearchableSelect
                          options={apAccountOptions}
                          value={apAccountDefault.value}
                          onChange={(value) => {
                              const selected = accounts.find((a) => a.Id === value);
                              setApAccountDefault({ value, name: selected?.FullyQualifiedName });
                          }}
                          placeholder="Select AP account…"
                      />
                  </div>
                  <div>
                      <label className="block text-xs text-gray-600 mb-1">Default Tax Code</label>
                      <SearchableSelect
                          options={taxCodeOptions}
                          value={taxCodeDefault.value}
                          onChange={(value) => {
                              const selected = taxCodes.find((t) => t.Id === value);
                              setTaxCodeDefault({ value, name: selected?.Name });
                          }}
                          placeholder="Select tax code…"
                      />
                  </div>
                  <div>
                      <label className="block text-xs text-gray-600 mb-1">Default Memo</label>
                      <input
                          type="text"
                          value={memoDefault.value}
                          onChange={(e) => setMemoDefault({ value: e.target.value })}
                          className="w-full bg-[#F5F5F7] border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
                          placeholder="Enter default memo"
                      />
                  </div>
                  <div>
                      <label className="block text-xs text-gray-600 mb-1">Default Doc #</label>
                      <input
                          type="text"
                          value={docNumberDefault.value}
                          onChange={(e) => setDocNumberDefault({ value: e.target.value })}
                          className="w-full bg-[#F5F5F7] border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
                          placeholder="Enter default doc number"
                      />
                  </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                  <button
                      type="button"
                      onClick={() => void handleSaveVendorCreditDefaults()}
                      className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-2"
                  >
                      Save Vendor Credit Defaults
                  </button>
              </div>
          </div>
      )}

      {isSectionVisible('rules', activeScanMode, selectedTemplate?.transactionType) && selectedTemplateId && (
        <RuleFormSection
          jwt={jwt}
          locationId={locId}
          templateId={selectedTemplateId}
          fieldOptions={scanFieldOptions}
        />
      )}

      {(isCheque || isBill || isVendorCredit) && activeScanMode === 'IMAGE' && selectedTemplateId && (
        <PayeeMappingSection
          jwt={jwt}
          templateId={selectedTemplateId}
        />
      )}

      {isJE && activeScanMode === 'EXCEL' && selectedTemplateId && (
        <ValueMappingSection
          jwt={jwt}
          templateId={selectedTemplateId}
        />
      )}

      {isSectionVisible('columnMapping', activeScanMode, selectedTemplate?.transactionType) && (
        isJE && activeScanMode === 'EXCEL' ? (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-4 mt-3">
            <p className="text-sm font-medium text-amber-800 mb-2">Required Excel Format for Journal Entry</p>
            <pre className="text-xs text-amber-700 whitespace-pre leading-relaxed">
{`Row 1:  Date          | (date value, e.g. 2026-07-30)
Row 2:  Journal No.   | (journal number, e.g. JE-001)
Row 3:  Adjusting     | (true or false)
Row 4:  Memo          | (memo text)
Row 5:  Account | Debit | Credit | Description | Name | Class | Tax
Row 6+: (data rows with values matching column headers)`}
            </pre>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setLineItemMappingOpen((current) => !current)}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-100 transition-colors"
            >
              <span className="text-xs font-semibold text-gray-600">Column Roles — Line Items</span>
              <span className="text-gray-600 text-xs">{lineItemMappingOpen ? '▲' : '▼'}</span>
            </button>
            {lineItemMappingOpen ? (
              <div className="px-3 pb-3 space-y-3 border-t border-gray-200 pt-3">
                <p className="text-xs text-gray-600">Tell Nest which spreadsheet columns hold product names, amounts, etc.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {LINE_ITEM_COLUMN_ROLES.map((role) => (
                    <div key={role.key}>
                      <div className="text-xs text-gray-600 mb-1">
                        {role.label}{role.required ? ' *' : ''}
                      </div>
                      <select
                        value={localColMap[role.key] ?? ''}
                        onChange={(e) => setLocalColMap((prev) => ({ ...prev, [role.key]: e.target.value }))}
                        className="w-full bg-[#F5F5F7] border border-gray-200 text-gray-900 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="">Select column</option>
                        {lineItemHeaders.map((header) => (
                          <option key={header} value={header}>{header}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    type="button"
                    onClick={() => void saveLineItemColumnMappings()}
                    className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-1.5"
                  >
                    Save Column Roles
                  </button>
                  <div className="text-xs text-gray-600">
                    Current: {Object.entries(localColMap).filter(([, value]) => value).length} selected
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-3 pb-3 pt-3 border-t border-gray-200 flex flex-wrap gap-2">
                {Object.entries(localColMap).filter(([, value]) => value).map(([key, value]) => (
                  <span key={key} className="rounded-full bg-[#F5F5F7] border border-gray-200 text-gray-600 text-[11px] px-2 py-1">
                    {LINE_ITEM_COLUMN_ROLES.find((role) => role.key === key)?.label ?? key}: {value}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {activeScanEntry && activeScanEntry.lineItems.length > 0 && (isBill || isVendorCredit || isCheque) && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-gray-100 border-b border-gray-200">
            <div className="text-xs font-semibold text-gray-600">Scanned Line Items</div>
            <div className="text-xs text-gray-600">Review all detected invoice items before mapping.</div>
          </div>
          <div className="max-h-[250px] overflow-y-auto">
            <table className="min-w-full text-left text-xs text-gray-700">
              <thead className="bg-[#F5F5F7] text-gray-600">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Unit Price</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {activeScanEntry.lineItems.map((lineItem, index) => (
                  <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 align-top text-gray-600">{index + 1}</td>
                    <td className="px-3 py-2 align-top text-gray-800 overflow-hidden line-clamp-2">{lineItem.description ?? ''}</td>
                    <td className="px-3 py-2 align-top text-gray-600 overflow-hidden text-ellipsis whitespace-nowrap">{lineItem.quantity ?? ''}</td>
                    <td className="px-3 py-2 align-top text-gray-600 overflow-hidden text-ellipsis whitespace-nowrap">{lineItem.unitPrice ?? ''}</td>
                    <td className="px-3 py-2 align-top text-gray-600 overflow-hidden text-ellipsis whitespace-nowrap">{lineItem.total ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 border-t border-gray-200 bg-gray-100 text-xs text-gray-600">
            {activeScanEntry.lineItems.length} line item{activeScanEntry.lineItems.length === 1 ? '' : 's'} detected
          </div>
        </div>
      )}

      {(isBill || isVendorCredit || isCheque) && activeScanEntry && activeScanEntry.lineItems.length > 1 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setLineItemFieldsOpen((prev) => !prev)}
            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-100 transition-colors"
          >
            <span className="text-xs font-semibold text-gray-600">
              📄 Line Item Fields ({activeScanEntry.lineItems.length} line items)
            </span>
            <span className="text-gray-600 text-xs">
              {lineItemFieldsOpen ? '▲' : '▼'}
            </span>
          </button>
          {lineItemFieldsOpen && (
            <div className="px-3 pb-3 space-y-3">
              <p className="text-xs text-gray-600">
                Each field below shows values from all scanned line items. The mapping dropdown shows one copy per field type — it applies to all line items.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['description', 'quantity', 'unitPrice', 'total'] as const).map((field) => (
                  <div key={field}>
                    <div className="text-xs text-gray-600 mb-1 capitalize">
                      {field === 'unitPrice' ? 'Unit Price' : field}
                    </div>
                    <div className="text-xs text-gray-600">
                      {activeScanEntry.lineItems
                        .map((item) => item[field])
                        .filter((v) => v && String(v).trim() !== '')
                        .map((v, i, arr) => (
                          <span key={i} className="inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                            {String(v)}
                            {i < arr.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isSectionVisible('fieldMapping', activeScanMode, selectedTemplate?.transactionType) && (
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
            accounts={accounts}
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

      {localMappings.length > 0 && (
        <div className="border-t border-gray-200 pt-3 space-y-2">
          {selectedTemplate?.transactionType === 'JOURNAL_ENTRY' && (
            <div className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${
              isBalanced ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'
            }`}>
              <span className={isBalanced ? 'text-emerald-600' : 'text-red-600'}>
                {isBalanced ? '✓ Balanced' : '⚠️ Unbalanced'}
              </span>
              <span className="text-gray-600 font-mono">
                Dr ${totalDebits.toFixed(2)} / Cr ${totalCredits.toFixed(2)}
                {!isBalanced && ` (diff: $${Math.abs(diff).toFixed(2)})`}
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => {
                localMappings.filter((mapping) => mapping.isDirty).forEach((mapping) => void saveMapping(mapping));
              }}
              disabled={!localMappings.some((mapping) => mapping.isDirty)}
              className="flex-1 text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white py-2 rounded-lg transition-colors"
            >
              💾 Save All Changes
            </button>
            <button
              onClick={() => onTabChange('preview')}
              className="flex-1 text-xs bg-gray-200 hover:bg-gray-100 text-gray-600 py-2 rounded-lg transition-colors"
            >
              📋 Preview {getPreviewLabel()} →
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={showSwitchTemplateConfirm}
        title="Unsaved Changes"
        message="You have unsaved mapping changes. Switch templates anyway?"
        confirmText="Switch"
        cancelText="Cancel"
        onConfirm={confirmSwitchTemplate}
        onCancel={() => {
          setShowSwitchTemplateConfirm(false);
          setPendingSwitchTemplateId(null);
        }}
        variant="default"
      />
      <ConfirmDialog
        open={showDeleteTemplateConfirm}
        title="Delete Template"
        message="Delete this template and ALL its mappings? This cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDeleteTemplate}
        onCancel={() => setShowDeleteTemplateConfirm(false)}
        variant="danger"
      />
      <ConfirmDialog
        open={showDeleteMappingConfirm}
        title="Delete Mapping"
        message="Delete this mapping?"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDeleteMapping}
        onCancel={() => {
          setShowDeleteMappingConfirm(false);
          setPendingDeleteMapping(null);
        }}
        variant="danger"
      />
    </div>
  );
}
