import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import type { ValueMappingSuggestion } from '../../lib/api';
import { useQBContext } from '../../contexts/QBContext';
import { ConfirmDialog } from '../shared';
import SearchableSelect from '../SearchableSelect';
import { evaluateProductMatch } from '../../lib/column-extractor';
import {
  filterMappingsForColumn,
  getEffectiveFieldType,
  getEffectiveTargetOptions,
  buildValueMappingPayload,
} from '../../lib/value-mapping-column-utils';
import type { SelectOption } from '../SearchableSelect';
import type { ColumnMappingConfig, ValueMapping, ValueMappingFormData, MatchingRule, MatchingRuleType, ScanEntry } from '../../../types';

interface Props {
  jwt: string;
  templateId: string;
  columnConfig?: ColumnMappingConfig;
  scanEntries: ScanEntry[];
}

const FIELD_TYPE_OPTIONS: Array<{ value: ValueMapping['fieldType']; label: string; description: string }> = [
  { value: 'account', label: 'Account', description: 'Map scanned text to a QuickBooks account' },
  { value: 'name', label: 'Name', description: 'Map scanned text to a vendor, customer, or employee name' },
  { value: 'class', label: 'Class', description: 'Map scanned text to a QuickBooks class' },
  { value: 'taxCode', label: 'Tax Code', description: 'Map scanned text to a QuickBooks tax code' },
];

export default function ValueMappingSection({ jwt, templateId, columnConfig, scanEntries }: Props) {
  const { accounts, classes, taxCodes, vendors, customers, employees } = useQBContext();
  const [mappings, setMappings] = useState<ValueMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingMapping, setEditingMapping] = useState<ValueMapping | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState<ValueMappingFormData>({
    fieldType: 'account',
    scannedText: '',
    entityId: '',
  });
  const [useRuleEnabled, setUseRuleEnabled] = useState(false);
  const [ruleType, setRuleType] = useState<MatchingRuleType>('EXACT');
  const [ruleThreshold, setRuleThreshold] = useState(0.8);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleDirection, setRuleDirection] = useState<'input_contains_catalog' | 'catalog_contains_input' | 'either'>('either');
  const [ruleCombine, setRuleCombine] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [testResults, setTestResults] = useState<{ mappingId: string; scannedText: string; matched: boolean; confidence: number; matchType: string }[]>([]);
  const [deleteMappingDialog, setDeleteMappingDialog] = useState<{ open: boolean; mapping: ValueMapping | null }>({ open: false, mapping: null });
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<ValueMappingSuggestion[]>([]);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const accountOptions = useMemo<SelectOption[]>(() =>
    accounts
      .filter((account) => account.Active)
      .map((account) => ({ value: account.Id, label: account.FullyQualifiedName, subtitle: account.AccountType })),
    [accounts],
  );

  const classOptions = useMemo<SelectOption[]>(() =>
    classes
      .filter((klass) => klass.Active)
      .map((klass) => ({ value: klass.Id, label: klass.FullyQualifiedName })),
    [classes],
  );

  const taxCodeOptions = useMemo<SelectOption[]>(() =>
    taxCodes
      .filter((taxCode) => taxCode.Active)
      .map((taxCode) => ({ value: taxCode.Id, label: taxCode.Name, subtitle: taxCode.Description })),
    [taxCodes],
  );

  const nameOptions = useMemo<SelectOption[]>(() => {
    const items: SelectOption[] = [];
    vendors
      .filter((v) => v.Active)
      .forEach((v) => items.push({ value: `vendor:${v.Id}`, label: v.DisplayName, subtitle: 'Vendor' }));
    customers
      .filter((c) => c.Active)
      .forEach((c) => items.push({ value: `customer:${c.Id}`, label: c.DisplayName, subtitle: 'Customer' }));
    employees
      .filter((e) => e.Active)
      .forEach((e) => items.push({ value: `employee:${e.Id}`, label: e.DisplayName, subtitle: 'Employee' }));
    return items.sort((a, b) => a.label.localeCompare(b.label));
  }, [vendors, customers, employees]);

  const effectiveFieldType = getEffectiveFieldType(formData, columnConfig);

  const entityOptions = useMemo<SelectOption[]>(() => {
    switch (effectiveFieldType) {
      case 'account':
        return accountOptions;
      case 'class':
        return classOptions;
      case 'taxCode':
        return taxCodeOptions;
      case 'name':
      default:
        return nameOptions;
    }
  }, [effectiveFieldType, accountOptions, classOptions, taxCodeOptions, nameOptions]);

  useEffect(() => {
    if (!templateId) return;

    const loadMappings = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getValueMappings(jwt, templateId);
        setMappings(filterMappingsForColumn(data, columnConfig));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load value mappings');
      } finally {
        setLoading(false);
      }
    };

    loadMappings();
  }, [jwt, templateId, columnConfig]);

  useEffect(() => {
    setEditingMapping(null);
    setShowForm(false);
    resetForm();
  }, [templateId]);

  const resetForm = () => {
    setEditingMapping(null);
    setFormData({ fieldType: 'account', scannedText: '', entityId: '' });
    setUseRuleEnabled(false);
    setRuleType('EXACT');
    setRuleThreshold(0.8);
    setRulePattern('');
    setRuleDirection('either');
    setRuleCombine(false);
    setError(null);
  };

  const openAdd = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (mapping: ValueMapping) => {
    setEditingMapping(mapping);
    setFormData({
      fieldType: mapping.fieldType,
      scannedText: mapping.scannedText,
      entityId: mapping.entityId,
      matchingRule: mapping.matchingRule ?? undefined,
    });
    if (mapping.matchingRule) {
      setUseRuleEnabled(true);
      setRuleType(mapping.matchingRule.type);
      setRuleThreshold(mapping.matchingRule.threshold ?? 0.8);
      setRulePattern(mapping.matchingRule.pattern ?? '');
      setRuleDirection(mapping.matchingRule.direction ?? 'either');
      setRuleCombine(mapping.matchingRule.combine ?? false);
    } else {
      setUseRuleEnabled(false);
      setRuleType('EXACT');
      setRuleThreshold(0.8);
      setRulePattern('');
      setRuleDirection('either');
    }
    setError(null);
    setShowForm(true);
  };

  const handleCancel = () => {
    resetForm();
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!formData.scannedText.trim()) {
      setError('Scanned value is required');
      return;
    }
    if (!formData.entityId) {
      setError('Target entity is required');
      return;
    }

    setSaving(true);
    setError(null);

    const matchingRule: MatchingRule | null = useRuleEnabled
      ? {
          type: ruleType,
          threshold: ruleThreshold,
          pattern: rulePattern || undefined,
          direction: ruleDirection,
          isActive: true,
          combine: ruleCombine || undefined,
        }
      : null;

    try {
      const payload = buildValueMappingPayload(formData, matchingRule, columnConfig);

      if (editingMapping) {
        const updated = await api.updateValueMapping(jwt, editingMapping.id, payload);
        setMappings((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await api.createValueMapping(jwt, {
          templateId,
          ...payload,
        });
        setMappings((prev) => [...prev, created].sort((a, b) =>
          a.fieldType.localeCompare(b.fieldType) || a.scannedText.localeCompare(b.scannedText),
        ));
      }
      resetForm();
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save value mapping');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (mapping: ValueMapping) => {
    setDeleteMappingDialog({ open: true, mapping });
  };

  const confirmDeleteMapping = async () => {
    if (!deleteMappingDialog.mapping) return;
    const mapping = deleteMappingDialog.mapping;
    setDeleteMappingDialog({ open: false, mapping: null });

    try {
      await api.deleteValueMapping(jwt, mapping.id);
      setMappings((prev) => prev.filter((item) => item.id !== mapping.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete value mapping');
    }
  };

  const handleTestMatch = () => {
    if (!testInput.trim()) return;
    const results = mappings.map((mapping) => {
      const result = evaluateProductMatch(testInput.trim(), mapping.scannedText, mapping.matchingRule ?? undefined);
      return {
        mappingId: mapping.id,
        scannedText: mapping.scannedText,
        matched: result.matched,
        confidence: result.confidence,
        matchType: result.matchType,
      };
    }).sort((a, b) => b.confidence - a.confidence);
    setTestResults(results);
  };

  const uniqueScannedValues = useMemo(() => {
    if (!columnConfig || scanEntries.length === 0) return [];
    const field = columnConfig.sourceField;
    const values = new Set<string>();

    scanEntries.forEach((entry: ScanEntry) => {
      const headerValue = entry.header?.[field];
      if (headerValue) {
        const trimmed = headerValue.trim();
        if (trimmed) values.add(trimmed);
      }
      entry.lineItems.forEach((lineItem: Record<string, string>) => {
        const lineValue = lineItem[field];
        if (lineValue) {
          const trimmed = lineValue.trim();
          if (trimmed) values.add(trimmed);
        }
      });
    });

    return Array.from(values);
  }, [columnConfig, scanEntries]);

  const unmappedValues = useMemo(() => {
    const mappedTexts = new Set(mappings.map((mapping) => mapping.scannedText));
    return uniqueScannedValues.filter((value) => !mappedTexts.has(value));
  }, [uniqueScannedValues, mappings]);

  const handleSuggest = async () => {
    if (!columnConfig) return;
    if (unmappedValues.length === 0) {
      setSuggestionError('All scanned values already have mappings.');
      return;
    }

    setSuggesting(true);
    setSuggestionError(null);
    setSuggestions([]);

    try {
      const response = await api.suggestValueMappings(jwt, templateId, [
        {
          sourceField: columnConfig.sourceField,
          fieldType: columnConfig.fieldType,
          scannedValues: unmappedValues,
        },
      ]);
      const suggestionsResult = response.data ?? [];
      if (suggestionsResult.length === 0) {
        setSuggestionError('AI did not return any suggestions for these values.');
        return;
      }
      setSuggestions(suggestionsResult);
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

  const handleApplySuggestion = async (suggestion: ValueMappingSuggestion) => {
    setError(null);
    try {
      const payload = buildValueMappingPayload(
        {
          fieldType: suggestion.fieldType,
          scannedText: suggestion.scannedText,
          entityId: suggestion.suggestedEntityId,
          sourceField: columnConfig ? columnConfig.sourceField : suggestion.sourceField,
        },
        null,
        columnConfig,
      );

      const created = await api.createValueMapping(jwt, {
        templateId,
        ...payload,
      });

      setMappings((prev) => [...prev, created].sort((a, b) =>
        a.fieldType.localeCompare(b.fieldType) || a.scannedText.localeCompare(b.scannedText),
      ));
      setSuggestions((prev) => prev.filter((item) => item.scannedText !== suggestion.scannedText));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply suggestion');
    }
  };

  const handleApplyAll = async () => {
    for (const suggestion of [...suggestions]) {
      await handleApplySuggestion(suggestion);
    }
  };

  const getEntityLabel = (value: string) => {
    if (value.startsWith('customer:')) {
        const cId = value.replace('customer:', '');
        return customers.find((item) => item.Id === cId)?.DisplayName || value;
    }
    if (value.startsWith('vendor:')) {
        const vId = value.replace('vendor:', '');
        return vendors.find((item) => item.Id === vId)?.DisplayName || value;
    }
    if (value.startsWith('employee:')) {
        const eId = value.replace('employee:', '');
        return employees.find((item) => item.Id === eId)?.DisplayName || value;
    }
    const account = accounts.find((item) => item.Id === value);
    if (account) return account.FullyQualifiedName;
    const klass = classes.find((item) => item.Id === value);
    if (klass) return klass.FullyQualifiedName;
    const taxCode = taxCodes.find((item) => item.Id === value);
    if (taxCode) return taxCode.Name;
    // Backward compatibility: existing name mappings may have raw unprefixed IDs
    const vendor = vendors.find((item) => item.Id === value);
    if (vendor) return vendor.DisplayName;
    const customer = customers.find((item) => item.Id === value);
    if (customer) return customer.DisplayName;
    const employee = employees.find((item) => item.Id === value);
    if (employee) return employee.DisplayName;
    return value;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-100 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-600">
          ⚙️ {columnConfig ? `${columnConfig.label} Value Mappings` : 'Journal Entry Value Mappings'} ({mappings.length})
        </span>
        <span className="text-gray-600 text-xs">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3">
          <p className="text-xs text-gray-600 mb-3">
            {columnConfig ? columnConfig.description : 'Map Excel values to the correct QuickBooks account, name, class, or tax code when importing journal entries.'}
          </p>

          <div className="rounded-xl border border-gray-200 bg-[#F5F5F7] p-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">🧾 {columnConfig ? `${columnConfig.label} Excel Mappings` : 'Journal Entry Excel Mappings'}</h2>
                <p className="text-xs text-gray-600">
                  {columnConfig ? `Map your Excel ${columnConfig.label.toLowerCase()} values to QuickBooks` : 'Configure known value translations for your Excel journal entry upload.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                  {columnConfig && (
                    <button
                      type="button"
                      onClick={handleSuggest}
                      disabled={suggesting || unmappedValues.length === 0}
                      title={unmappedValues.length === 0 ? 'No unmapped values to suggest' : 'Use AI to suggest value mappings'}
                      className={`text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded transition-colors ${suggesting || unmappedValues.length === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
                    >
                      {suggesting ? 'Suggesting…' : '🤖 AI Suggest'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openAdd}
                    className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-2"
                  >
                    + Add Mapping
                  </button>
                </div>
              </div>

            {loading ? (
              <div className="text-xs text-gray-600">Loading value mappings…</div>
            ) : (
              <div className="space-y-4">
                {showForm && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {!columnConfig && (
                        <div>
                          <label className="text-xs text-gray-600">Field Type</label>
                          <select
                            value={formData.fieldType}
                            onChange={(e) => setFormData((prev) => ({ ...prev, fieldType: e.target.value as ValueMapping['fieldType'], entityId: '' }))}
                            className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                          >
                            {FIELD_TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div>
                        <label className="text-xs text-gray-600">Scanned Text</label>
                        <input
                          type="text"
                          value={formData.scannedText}
                          onChange={(e) => setFormData((prev) => ({ ...prev, scannedText: e.target.value }))}
                          className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-gray-600">Target {FIELD_TYPE_OPTIONS.find((item) => item.value === effectiveFieldType)?.label}</label>
                      <SearchableSelect
                        options={getEffectiveTargetOptions(entityOptions, columnConfig)}
                        value={formData.entityId}
                        onChange={(value) => setFormData((prev) => ({ ...prev, entityId: value }))}
                        placeholder={`Select ${FIELD_TYPE_OPTIONS.find((item) => item.value === effectiveFieldType)?.label}…`}
                      />
                    </div>

                    <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-200">
                      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={useRuleEnabled} onChange={(e) => setUseRuleEnabled(e.target.checked)} className="rounded" />
                        Custom matching rule
                      </label>
                    </div>

                    {useRuleEnabled && (
                      <div className="grid gap-3 sm:grid-cols-2 mt-3">
                        <div>
                          <label className="text-xs text-gray-600">Rule Type</label>
                          <select
                            value={ruleType}
                            onChange={(e) => setRuleType(e.target.value as MatchingRuleType)}
                            className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                          >
                            <option value="EXACT">Exact Match</option>
                            <option value="CONTAINS">Contains</option>
                            <option value="STARTS_WITH">Starts With</option>
                            <option value="REGEX">Regex</option>
                          </select>
                        </div>

                        {(ruleType === 'CONTAINS' || ruleType === 'STARTS_WITH') && (
                          <div>
                            <label className="text-xs text-gray-600">Direction</label>
                            <select
                              value={ruleDirection}
                              onChange={(e) => setRuleDirection(e.target.value as any)}
                              className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                            >
                              <option value="either">Either direction</option>
                              <option value="input_contains_catalog">Input contains catalog</option>
                              <option value="catalog_contains_input">Catalog contains input</option>
                            </select>
                          </div>
                        )}

                        {ruleType === 'REGEX' && (
                          <div>
                            <label className="text-xs text-gray-600">Pattern</label>
                            <input
                              type="text"
                              value={rulePattern}
                              onChange={(e) => setRulePattern(e.target.value)}
                              className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                            />
                          </div>
                        )}

                        {(ruleType === 'CONTAINS' || ruleType === 'STARTS_WITH') && (
                          <div>
                            <label className="text-xs text-gray-600">Threshold</label>
                            <input
                              type="number"
                              min={0}
                              max={1}
                              step={0.01}
                              value={ruleThreshold}
                              onChange={(e) => setRuleThreshold(Number(e.target.value))}
                              className="mt-1 w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                            />
                          </div>
                        )}

                        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer mt-2">
                          <input
                            type="checkbox"
                            checked={ruleCombine}
                            onChange={(e) => setRuleCombine(e.target.checked)}
                            className="rounded border-gray-300"
                          />
                          Combine matching line items into one
                        </label>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 justify-end">
                      <button
                        type="button"
                        onClick={handleCancel}
                        className="text-xs bg-white hover:bg-gray-100 text-gray-600 rounded px-3 py-1.5"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 text-white rounded px-3 py-1.5"
                      >
                        {saving ? 'Saving…' : editingMapping ? 'Save Changes' : 'Save Mapping'}
                      </button>
                    </div>
                  </div>
                )}

                {mappings.length === 0 ? (
                  <div className="text-xs text-gray-600">No value mappings configured yet.</div>
                ) : (
                  <div className="space-y-2">
                    {mappings.map((mapping) => (
                      <div key={mapping.id} className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-gray-900 truncate">{mapping.scannedText}</div>
                            <div className="text-xs text-gray-600 truncate">{FIELD_TYPE_OPTIONS.find((item) => item.value === mapping.fieldType)?.label}: {getEntityLabel(mapping.entityId)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(mapping)}
                              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded px-3 py-1.5"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(mapping)}
                              className="text-xs bg-red-50 hover:bg-red-100 text-red-700 rounded px-3 py-1.5"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {suggestionError && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    {suggestionError}
                  </div>
                )}

                {suggestions.length > 0 && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-blue-800">AI Suggestions ({suggestions.length})</div>
                      <button
                        type="button"
                        onClick={handleApplyAll}
                        className="text-xs text-blue-600 hover:text-blue-800 underline"
                      >
                        Accept All
                      </button>
                    </div>
                    <div className="space-y-2">
                      {suggestions.map((suggestion) => (
                        <div key={`${suggestion.sourceField}-${suggestion.scannedText}`} className="rounded-lg border border-blue-100 bg-white p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-gray-900 truncate">
                              “{suggestion.scannedText}” → {suggestion.suggestedEntityName}
                            </div>
                            <div className="text-xs text-gray-600">
                              <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700">
                                {suggestion.confidence}
                              </span>
                              <span className="ml-2">{suggestion.reason}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleApplySuggestion(suggestion)}
                            className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-1.5 whitespace-nowrap"
                          >
                            ✓ Apply
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="text-xs font-semibold text-gray-900">{columnConfig ? `Test ${columnConfig.label} Mapping` : 'Test Value Mapping'}</div>
                  <p className="text-xs text-gray-600 mb-2">Enter a sample scanned value to preview matching mappings.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="text"
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      placeholder="Test scanned text…"
                      className="w-full rounded border border-gray-200 bg-[#F5F5F7] px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleTestMatch}
                      className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-2"
                    >
                      Test Match
                    </button>
                  </div>
                  {testResults.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {testResults.map((result) => (
                        <div key={result.mappingId} className="rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
                          <div className="flex items-center justify-between gap-2">
                            <span>{FIELD_TYPE_OPTIONS.find((item) => item.value === mappings.find((m) => m.id === result.mappingId)?.fieldType)?.label ?? 'Mapping'}</span>
                            <span>{result.matched ? 'Matched' : 'No match'}</span>
                          </div>
                          <div className="text-xs text-gray-600">Scanned text: {mappings.find((m) => m.id === result.mappingId)?.scannedText}</div>
                          <div className="text-xs text-gray-600">Type: {result.matchType} · Confidence: {result.confidence.toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteMappingDialog.open}
        title="Delete Value Mapping"
        message="Delete this value mapping?"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDeleteMapping}
        onCancel={() => setDeleteMappingDialog({ open: false, mapping: null })}
        variant="danger"
      />
    </div>
  );
}
