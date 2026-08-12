import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
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
import type { ColumnMappingConfig, ValueMapping, ValueMappingFormData, MatchingRule, MatchingRuleType } from '../../../types';

interface Props {
  jwt: string;
  templateId: string;
  columnConfig?: ColumnMappingConfig;
}

const FIELD_TYPE_OPTIONS: Array<{ value: ValueMapping['fieldType']; label: string; description: string }> = [
  { value: 'account', label: 'Account', description: 'Map scanned text to a QuickBooks account' },
  { value: 'name', label: 'Name', description: 'Map scanned text to a vendor, customer, or employee name' },
  { value: 'class', label: 'Class', description: 'Map scanned text to a QuickBooks class' },
  { value: 'taxCode', label: 'Tax Code', description: 'Map scanned text to a QuickBooks tax code' },
];

export default function ValueMappingSection({ jwt, templateId, columnConfig }: Props) {
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
              <button
                type="button"
                onClick={openAdd}
                className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-2"
              >
                + Add Mapping
              </button>
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-300 rounded px-3 py-2">
                {error}
              </div>
            )}

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
