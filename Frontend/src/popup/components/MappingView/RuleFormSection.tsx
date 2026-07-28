import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { api } from '../../lib/api';
import SearchableSelect, { type SelectOption } from '../SearchableSelect';
import { ConfirmDialog } from '../shared';
import type { Rule, RuleFormData } from '../../../types';

interface RuleFormSectionProps {
  jwt: string;
  locationId: string;
  templateId: string;
  fieldOptions: SelectOption[];
}

function cfg(config: Record<string, unknown>, key: string): unknown {
  return config[key];
}

const TEMPLATE_FIELDS = [
  'Revenue.Net sales',
  'Revenue.Gratuity',
  'Revenue.Tax amount',
  'Tips.Credit/non-cash tips',
  'Tips.Cash tips',
  'Discount.Total discounts.Amount',
  'Payments.Credit/debit.Total',
  'Payments.Cash.Total',
  'Payments.Gift Card.Total',
  'Service Charge.Total',
  'Void.Total',
  'Unpaid Orders.Total',
];

const RULE_DESCRIPTIONS: Record<string, string> = {
  COMBINE: 'Add multiple fields together into one total',
  DEDUCT: 'Subtract one field from another',
  THRESHOLD: 'Apply a rule when a field exceeds a value',
  FORMULA: 'Create a custom calculation using multiple fields',
};

const ruleTypeColor: Record<Rule['ruleType'], string> = {
  COMBINE: 'bg-emerald-50 text-emerald-600',
  DEDUCT: 'bg-orange-50 text-orange-600',
  THRESHOLD: 'bg-gray-50 text-gray-600',
  FORMULA: 'bg-emerald-50 text-emerald-600',
};

function renderConfigSummary(r: Rule): string {
  switch (r.ruleType) {
    case 'COMBINE': {
      const fields = (cfg(r.config, 'sourceFields') ?? []) as string[];
      const target = (cfg(r.config, 'targetField') ?? '?') as string;
      return `${fields.join(' + ')} → ${target}`;
    }
    case 'DEDUCT': {
      const fields = (cfg(r.config, 'sourceFields') ?? []) as string[];
      const target = (cfg(r.config, 'targetField') ?? '?') as string;
      return `${fields[0] ?? '?'} − ${fields[1] ?? '?'} → ${target}`;
    }
    case 'THRESHOLD': {
      const source = (cfg(r.config, 'sourceField') ?? '?') as string;
      const threshold = (cfg(r.config, 'threshold') ?? 0) as number;
      const target = (cfg(r.config, 'targetField') ?? '?') as string;
      return `If ${source} > $${threshold.toLocaleString()} → ${target}`;
    }
    case 'FORMULA': {
      const formula = (cfg(r.config, 'formula') ?? '?') as string;
      const target = (cfg(r.config, 'targetField') ?? '?') as string;
      return `${formula} → ${target}`;
    }
    default:
      return JSON.stringify(r.config);
  }
}

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
        value ? 'bg-emerald-600' : 'bg-gray-600'
      }`}
      aria-pressed={value}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          value ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function isConfigValid(r: Rule): boolean {
  switch (r.ruleType) {
    case 'COMBINE':
    case 'DEDUCT':
      return Array.isArray(cfg(r.config, 'sourceFields')) && typeof cfg(r.config, 'targetField') === 'string';
    case 'THRESHOLD':
      return (
        typeof cfg(r.config, 'sourceField') === 'string' &&
        typeof cfg(r.config, 'threshold') === 'number' &&
        typeof cfg(r.config, 'targetField') === 'string'
      );
    case 'FORMULA':
      return typeof cfg(r.config, 'formula') === 'string' && typeof cfg(r.config, 'targetField') === 'string';
    default:
      return false;
  }
}

export default function RuleFormSection({ jwt, locationId, templateId, fieldOptions }: RuleFormSectionProps) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteRuleDialog, setDeleteRuleDialog] = useState<{ open: boolean; ruleId: string | null }>({ open: false, ruleId: null });
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const [formName, setFormName] = useState('');
  const [formRuleType, setFormRuleType] = useState<Rule['ruleType']>('COMBINE');
  const [formTemplateId, setFormTemplateId] = useState<string>('');
  const [sourceFields, setSourceFields] = useState<string[]>(['', '']);
  const [thresholdSource, setThresholdSource] = useState('');
  const [thresholdValue, setThresholdValue] = useState(0);
  const [formulaText, setFormulaText] = useState('');
  const [targetField, setTargetField] = useState('');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [formulaFieldsExpanded, setFormulaFieldsExpanded] = useState(false);
  const formulaInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const effectiveFieldOptions = useMemo(
    () =>
      fieldOptions.length > 0
        ? fieldOptions
        : TEMPLATE_FIELDS.map((f) => ({ value: f, label: f })),
    [fieldOptions],
  );

  const loadRules = useCallback(async () => {
    if (!locationId || !templateId) return;
    setLoading(true);
    setError(null);

    try {
      const data = await api.getRules(jwt, locationId, templateId);
      setRules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }, [jwt, locationId, templateId]);

  useEffect(() => { void loadRules(); }, [loadRules]);

  const resetForm = () => {
    setFormName('');
    setFormRuleType('COMBINE');
    setFormTemplateId('');
    setSourceFields(['', '']);
    setThresholdSource('');
    setThresholdValue(0);
    setFormulaText('');
    setTargetField('');
    setValidationErrors({});
    setFormulaFieldsExpanded(false);
    setEditingRule(null);
    setShowForm(false);
  };

  const handleRuleTypeChange = (newType: Rule['ruleType']) => {
    setFormRuleType(newType);
    setSourceFields(['', '']);
    setThresholdSource('');
    setThresholdValue(0);
    setFormulaText('');
    setValidationErrors({});
    setFormulaFieldsExpanded(false);
  };

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const openEditForm = (r: Rule) => {
    setFormName(r.name);
    setFormRuleType(r.ruleType);
    setFormTemplateId(r.templateId ?? '');
    setTargetField((cfg(r.config, 'targetField') ?? '') as string);
    setValidationErrors({});

    switch (r.ruleType) {
      case 'COMBINE':
      case 'DEDUCT':
        setSourceFields((cfg(r.config, 'sourceFields') ?? ['', '']) as string[]);
        break;
      case 'THRESHOLD':
        setThresholdSource((cfg(r.config, 'sourceField') ?? '') as string);
        setThresholdValue((cfg(r.config, 'threshold') ?? 0) as number);
        break;
      case 'FORMULA':
        setFormulaText((cfg(r.config, 'formula') ?? '') as string);
        break;
    }

    setEditingRule(r);
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const appendFormulaField = (field: string) => {
    setFormulaText((prev) => prev + `{${field}}`);
    formulaInputRef.current?.focus();
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formName.trim()) errors['name'] = 'Rule name is required';

    switch (formRuleType) {
      case 'COMBINE': {
        const filled = sourceFields.filter((f) => f.trim());
        if (filled.length < 2) errors['sourceFields'] = 'At least 2 source fields are required';
        if (!targetField.trim()) errors['targetField'] = 'Target field name is required';
        break;
      }
      case 'DEDUCT': {
        if (!sourceFields[0]?.trim()) errors['sourceFields'] = 'Base field is required';
        if (!sourceFields[1]?.trim()) errors['sourceFields'] = 'Deduction field is required';
        if (!targetField.trim()) errors['targetField'] = 'Target field name is required';
        break;
      }
      case 'THRESHOLD': {
        if (!thresholdSource.trim()) errors['thresholdSource'] = 'Source field is required';
        if (thresholdValue <= 0) errors['thresholdValue'] = 'Threshold must be greater than 0';
        if (!targetField.trim()) errors['targetField'] = 'Target field name is required';
        break;
      }
      case 'FORMULA': {
        if (!formulaText.trim()) errors['formula'] = 'Formula is required';
        else if (!formulaText.includes('{')) errors['formula'] = 'Formula must contain at least one {Field} reference';
        if (!targetField.trim()) errors['targetField'] = 'Target field name is required';
        break;
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const isFormValid = (): boolean => {
    if (!formName.trim()) return false;
    switch (formRuleType) {
      case 'COMBINE':
        return sourceFields.filter((f) => f.trim()).length >= 2 && targetField.trim() !== '';
      case 'DEDUCT':
        return !!sourceFields[0]?.trim() && !!sourceFields[1]?.trim() && targetField.trim() !== '';
      case 'THRESHOLD':
        return thresholdSource.trim() !== '' && thresholdValue > 0 && targetField.trim() !== '';
      case 'FORMULA':
        return formulaText.trim() !== '' && formulaText.includes('{') && targetField.trim() !== '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    let config: Record<string, unknown> = {};
    switch (formRuleType) {
      case 'COMBINE':
        config = { sourceFields: sourceFields.filter((f) => f.trim()), targetField };
        break;
      case 'DEDUCT':
        config = { sourceFields: [sourceFields[0], sourceFields[1]], targetField };
        break;
      case 'THRESHOLD':
        config = { sourceField: thresholdSource, threshold: thresholdValue, targetField };
        break;
      case 'FORMULA':
        config = { formula: formulaText, targetField };
        break;
    }

    try {
      const payload: RuleFormData = {
        name: formName,
        ruleType: formRuleType,
        config,
        templateId,
      };

      if (editingRule) {
        await api.updateRule(jwt, editingRule.id, payload);
      } else {
        await api.createRule(jwt, locationId, { ...payload, isActive: true });
      }
      resetForm();
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    }
  };

  const handleToggle = async (rule: Rule) => {
    try {
      await api.updateRule(jwt, rule.id, { isActive: !rule.isActive });
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rule');
    }
  };

  const handleDelete = (id: string) => {
    setDeleteRuleDialog({ open: true, ruleId: id });
  };

  const confirmDeleteRule = async () => {
    if (!deleteRuleDialog.ruleId) return;
    const id = deleteRuleDialog.ruleId;
    setDeleteRuleDialog({ open: false, ruleId: null });
    try {
      await api.deleteRule(jwt, id);
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule');
    }
  };

  const inputClass = 'w-full bg-[#F5F5F7] text-gray-900 text-xs rounded px-2 py-1.5 border border-gray-300 focus:border-emerald-500 focus:outline-none';
  const labelClass = 'block text-xs text-gray-600 mb-1';
  const fieldGroupClass = 'space-y-1';

  const renderFormFields = () => {
    switch (formRuleType) {
      case 'COMBINE':
        return (
          <div className={fieldGroupClass}>
            <label className={labelClass}>Source Fields</label>
            {sourceFields.map((val, idx) => (
              <div key={idx} className="flex gap-1 items-center">
                <div className="flex-1">
                  <SearchableSelect
                    options={effectiveFieldOptions}
                    value={val}
                    onChange={(v) => {
                      const next = [...sourceFields];
                      next[idx] = v;
                      setSourceFields(next);
                    }}
                    placeholder="Select field…"
                  />
                </div>
                {sourceFields.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setSourceFields(sourceFields.filter((_, i) => i !== idx))}
                    className="text-gray-600 hover:text-red-600 text-xs px-1"
                  >✕</button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setSourceFields([...sourceFields, ''])}
              className="text-xs text-emerald-400 hover:text-emerald-600 mt-1"
            >+ Add another field</button>
            {validationErrors['sourceFields'] && (
              <p className="text-red-600 text-xs">{validationErrors['sourceFields']}</p>
            )}
          </div>
        );
      case 'DEDUCT':
        return (
          <div className="space-y-2">
            <div className={fieldGroupClass}>
              <label className={labelClass}>Base Field</label>
              <SearchableSelect
                options={effectiveFieldOptions}
                value={sourceFields[0] ?? ''}
                onChange={(v) => { const next = [...sourceFields]; next[0] = v; setSourceFields(next); }}
                placeholder="Select base field…"
              />
            </div>
            <div className={fieldGroupClass}>
              <label className={labelClass}>Deduct This Field</label>
              <SearchableSelect
                options={effectiveFieldOptions}
                value={sourceFields[1] ?? ''}
                onChange={(v) => { const next = [...sourceFields]; next[1] = v; setSourceFields(next); }}
                placeholder="Select field to deduct…"
              />
            </div>
            {validationErrors['sourceFields'] && (
              <p className="text-red-600 text-xs">{validationErrors['sourceFields']}</p>
            )}
          </div>
        );
      case 'THRESHOLD':
        return (
          <div className="space-y-2">
            <div className={fieldGroupClass}>
              <label className={labelClass}>Source Field</label>
              <SearchableSelect
                options={effectiveFieldOptions}
                value={thresholdSource}
                onChange={setThresholdSource}
                placeholder="Select source field…"
              />
              {validationErrors['thresholdSource'] && (
                <p className="text-red-600 text-xs">{validationErrors['thresholdSource']}</p>
              )}
            </div>
            <div className={fieldGroupClass}>
              <label className={labelClass}>Threshold Value</label>
              <input
                type="number"
                value={thresholdValue}
                onChange={(e) => setThresholdValue(Number(e.target.value))}
                className={inputClass}
                placeholder="e.g. 1000"
                min={0}
              />
              {validationErrors['thresholdValue'] && (
                <p className="text-red-600 text-xs">{validationErrors['thresholdValue']}</p>
              )}
            </div>
          </div>
        );
      case 'FORMULA':
        return (
          <div className={fieldGroupClass}>
            <label className={labelClass}>Formula</label>
            <input
              ref={formulaInputRef}
              type="text"
              value={formulaText}
              onChange={(e) => setFormulaText(e.target.value)}
              className={inputClass}
              placeholder="{Revenue.Net sales} + {Revenue.Tax amount}"
            />
            {validationErrors['formula'] && (
              <p className="text-red-600 text-xs">{validationErrors['formula']}</p>
            )}
            <button
              type="button"
              onClick={() => setFormulaFieldsExpanded(!formulaFieldsExpanded)}
              className="text-xs text-gray-600 hover:text-gray-900 cursor-pointer flex items-center gap-1 mt-1"
            >
              <span className="text-xs">{formulaFieldsExpanded ? '▾' : '▸'}</span>
              {formulaFieldsExpanded ? 'Hide available fields' : `Show available fields (${effectiveFieldOptions.length})`}
            </button>
            {formulaFieldsExpanded && (
              <div className="flex flex-wrap gap-1 mt-1">
                {effectiveFieldOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => appendFormulaField(option.value)}
                    className="text-xs bg-gray-200 hover:bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded"
                  >
                    {option.value}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-100 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-600">Rules ({rules.length})</span>
        <span className="text-gray-600 text-xs">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3 pt-3 space-y-4">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Template Rules</h3>
              <p className="text-xs text-gray-600">Manage rules scoped to this template.</p>
            </div>
            <button
              type="button"
              onClick={openCreateForm}
              className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-2"
            >
              + New Rule
            </button>
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          {showForm && (
            <div ref={formRef} className="rounded-lg border border-gray-200 bg-[#F5F5F7] p-3 space-y-3">
              <h4 className="text-sm font-semibold text-gray-900">{editingRule ? 'Edit Rule' : 'Create Rule'}</h4>
              <form onSubmit={handleSave} className="space-y-3">
                <div className={fieldGroupClass}>
                  <label className={labelClass}>Rule Name</label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Net Revenue Combine"
                    className={inputClass}
                  />
                  {validationErrors['name'] && (
                    <p className="text-red-600 text-xs">{validationErrors['name']}</p>
                  )}
                </div>
                <div className={fieldGroupClass}>
                  <label className={labelClass}>Rule Type</label>
                  <select
                    value={formRuleType}
                    onChange={(e) => handleRuleTypeChange(e.target.value as Rule['ruleType'])}
                    className="w-full bg-[#F5F5F7] text-gray-900 text-xs rounded px-2 py-1.5 border border-gray-300 focus:border-emerald-500 focus:outline-none"
                  >
                    {(['COMBINE', 'DEDUCT', 'THRESHOLD', 'FORMULA'] as const).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <p className="text-gray-600 text-xs mt-0.5">{RULE_DESCRIPTIONS[formRuleType]}</p>
                </div>
                {renderFormFields()}
                <div className={fieldGroupClass}>
                  <label className={labelClass}>Target Field Name</label>
                  <input
                    value={targetField}
                    onChange={(e) => setTargetField(e.target.value)}
                    placeholder="e.g. Combined Revenue"
                    className={inputClass}
                  />
                  {validationErrors['targetField'] && (
                    <p className="text-red-600 text-xs">{validationErrors['targetField']}</p>
                  )}
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
                  >Cancel</button>
                  <button
                    type="submit"
                    disabled={!isFormValid()}
                    className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1 rounded"
                  >
                    {editingRule ? 'Update Rule' : 'Save Rule'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {loading ? (
            <div className="text-gray-600 text-xs text-center py-8">Loading…</div>
          ) : rules.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-2xl mb-2">⚙️</div>
              <p className="text-gray-600 text-xs">No rules yet. Create your first rule above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => (
                <div key={rule.id} className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${ruleTypeColor[rule.ruleType]}`}>
                      {rule.ruleType}
                    </span>
                    <span className="flex-1 text-gray-900 text-xs font-semibold truncate">{rule.name}</span>
                    <ToggleSwitch value={rule.isActive} onChange={() => void handleToggle(rule)} />
                    <button
                      type="button"
                      onClick={() => openEditForm(rule)}
                      className="text-gray-600 hover:text-emerald-400 text-xs ml-1"
                      title="Edit"
                    >✏️</button>
                    <button
                      type="button"
                      onClick={() => handleDelete(rule.id)}
                      className="text-gray-600 hover:text-red-600 text-xs"
                      title="Delete"
                    >🗑️</button>
                  </div>
                  {isConfigValid(rule) ? (
                    <p className="text-gray-600 text-xs font-mono leading-relaxed">{renderConfigSummary(rule)}</p>
                  ) : (
                    <details className="text-xs">
                      <summary className="text-amber-600 cursor-pointer">Show raw config</summary>
                      <pre className="text-gray-600 mt-1 bg-[#F5F5F7] rounded p-2 text-xs overflow-auto">
                        {JSON.stringify(rule.config, null, 2)}
                      </pre>
                    </details>
                  )}
                  <p className="text-gray-600 text-xs">Created {new Date(rule.createdAt).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
          <ConfirmDialog
            open={deleteRuleDialog.open}
            title="Delete Rule"
            message="Delete this rule? This cannot be undone."
            confirmText="Delete"
            cancelText="Cancel"
            onConfirm={confirmDeleteRule}
            onCancel={() => setDeleteRuleDialog({ open: false, ruleId: null })}
            variant="danger"
          />
        </div>
      )}
    </div>
  );
}
