import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../lib/api';
import { useLocations } from '../hooks/useLocations';
import SearchableSelect, { type SelectOption } from './SearchableSelect';
import type { Rule } from '../../types';

interface RulesViewProps {
  jwt: string;
  selectedLocationId: string;
  onLocationChange: (id: string) => void;
  scanData?: Record<string, number> | null;
}

// ------------------------------------------------------------------
// Type-narrowing helper — required because Rule.config is
// Record<string, unknown> and strict mode forbids direct property access
// ------------------------------------------------------------------
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
  COMBINE: 'bg-blue-900 text-blue-300',
  DEDUCT: 'bg-orange-900 text-orange-300',
  THRESHOLD: 'bg-purple-900 text-purple-300',
  FORMULA: 'bg-green-900 text-green-300',
};

// ------------------------------------------------------------------
// Config summary renderer
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// Toggle switch component
// ------------------------------------------------------------------
function ToggleSwitch({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
        value ? 'bg-green-600' : 'bg-gray-600'
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

// ------------------------------------------------------------------
// Main component
// ------------------------------------------------------------------
export default function RulesView({ jwt, selectedLocationId, onLocationChange, scanData }: RulesViewProps) {
  const { locations } = useLocations(jwt);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form visibility & edit state
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formRuleType, setFormRuleType] = useState<Rule['ruleType']>('COMBINE');
  const [sourceFields, setSourceFields] = useState<string[]>(['', '']);
  const [thresholdSource, setThresholdSource] = useState('');
  const [thresholdValue, setThresholdValue] = useState<number>(0);
  const [formulaText, setFormulaText] = useState('');
  const [targetField, setTargetField] = useState('');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const formulaInputRef = useRef<HTMLInputElement>(null);

  const locId = selectedLocationId || locations[0]?.id || '';

  // ------------------------------------------------------------------
  // Available fields
  // ------------------------------------------------------------------
  const availableFields = useMemo(() => {
    return scanData
      ? [...new Set([...Object.keys(scanData), ...TEMPLATE_FIELDS])]
      : TEMPLATE_FIELDS;
  }, [scanData]);

  const fieldOptions: SelectOption[] = useMemo(() => {
    return availableFields.map((field) => ({
      value: field,
      label: field,
      subtitle: scanData && scanData[field] != null ? `$${Number(scanData[field]).toFixed(2)}` : undefined,
    }));
  }, [availableFields, scanData]);

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  const loadRules = useCallback(async () => {
    if (!locId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getRules(jwt, locId);
      setRules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }, [jwt, locId]);

  useEffect(() => { void loadRules(); }, [loadRules]);

  useEffect(() => {
    if (!selectedLocationId && locations[0]) onLocationChange(locations[0].id);
  }, [locations, selectedLocationId, onLocationChange]);

  // ------------------------------------------------------------------
  // Form helpers
  // ------------------------------------------------------------------
  const resetForm = () => {
    setFormName('');
    setFormRuleType('COMBINE');
    setSourceFields(['', '']);
    setThresholdSource('');
    setThresholdValue(0);
    setFormulaText('');
    setTargetField('');
    setValidationErrors({});
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
  };

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const openEditForm = (r: Rule) => {
    setFormName(r.name);
    setFormRuleType(r.ruleType);
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

  // ------------------------------------------------------------------
  // Formula field chip insertion
  // ------------------------------------------------------------------
  const appendFormulaField = (field: string) => {
    setFormulaText((prev) => prev + `{${field}}`);
    formulaInputRef.current?.focus();
  };

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // Save / Toggle / Delete
  // ------------------------------------------------------------------
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    let config: Record<string, unknown>;
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
      if (editingRule) {
        await api.updateRule(jwt, editingRule.id, { name: formName, ruleType: formRuleType, config });
      } else {
        await api.createRule(jwt, locId, { name: formName, ruleType: formRuleType, config, isActive: true });
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

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this rule?')) return;
    try {
      await api.deleteRule(jwt, id);
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule');
    }
  };

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------
  const inputClass = 'w-full bg-gray-900 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-cyan-500 focus:outline-none';
  const labelClass = 'block text-xs text-gray-400 mb-1';
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
                    options={fieldOptions}
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
                    className="text-gray-500 hover:text-red-400 text-xs px-1"
                  >✕</button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setSourceFields([...sourceFields, ''])}
              className="text-xs text-cyan-400 hover:text-cyan-300 mt-1"
            >+ Add another field</button>
            {validationErrors['sourceFields'] && (
              <p className="text-red-400 text-xs">{validationErrors['sourceFields']}</p>
            )}
          </div>
        );

      case 'DEDUCT':
        return (
          <div className="space-y-2">
            <div className={fieldGroupClass}>
              <label className={labelClass}>Base Field</label>
              <SearchableSelect
                options={fieldOptions}
                value={sourceFields[0] ?? ''}
                onChange={(v) => { const n = [...sourceFields]; n[0] = v; setSourceFields(n); }}
                placeholder="Select base field…"
              />
            </div>
            <div className={fieldGroupClass}>
              <label className={labelClass}>Deduct This Field</label>
              <SearchableSelect
                options={fieldOptions}
                value={sourceFields[1] ?? ''}
                onChange={(v) => { const n = [...sourceFields]; n[1] = v; setSourceFields(n); }}
                placeholder="Select field to deduct…"
              />
            </div>
            {validationErrors['sourceFields'] && (
              <p className="text-red-400 text-xs">{validationErrors['sourceFields']}</p>
            )}
          </div>
        );

      case 'THRESHOLD':
        return (
          <div className="space-y-2">
            <div className={fieldGroupClass}>
              <label className={labelClass}>Source Field</label>
              <SearchableSelect
                options={fieldOptions}
                value={thresholdSource}
                onChange={setThresholdSource}
                placeholder="Select source field…"
              />
              {validationErrors['thresholdSource'] && (
                <p className="text-red-400 text-xs">{validationErrors['thresholdSource']}</p>
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
                <p className="text-red-400 text-xs">{validationErrors['thresholdValue']}</p>
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
              placeholder='{Revenue.Net sales} + {Revenue.Tax amount}'
            />
            {validationErrors['formula'] && (
              <p className="text-red-400 text-xs">{validationErrors['formula']}</p>
            )}
            <p className="text-gray-500 text-xs mt-1">Click a field to append it:</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {availableFields.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => appendFormulaField(f)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded"
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        );
    }
  };

  // ------------------------------------------------------------------
  // JSX
  // ------------------------------------------------------------------
  return (
    <div className="p-3">
      {/* Location selector + New Rule button */}
      <div className="flex items-center gap-2 mb-3">
        <select
          value={locId}
          onChange={(e) => onLocationChange(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <button
          onClick={openCreateForm}
          className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-2 py-1.5 rounded-lg whitespace-nowrap"
        >
          + New Rule
        </button>
      </div>

      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

      {/* Form card */}
      {showForm && (
        <div ref={formRef} className="bg-gray-800 border border-gray-600 rounded-lg p-3 mb-3">
          <h3 className="text-sm font-semibold text-white mb-3">
            {editingRule ? 'Edit Rule' : 'Create Rule'}
          </h3>
          <form onSubmit={(e) => { void handleSave(e); }} className="space-y-3">
            {/* Rule name */}
            <div className={fieldGroupClass}>
              <label className={labelClass}>Rule Name</label>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Net Revenue Combine"
                className={inputClass}
              />
              {validationErrors['name'] && (
                <p className="text-red-400 text-xs">{validationErrors['name']}</p>
              )}
            </div>

            {/* Rule type */}
            <div className={fieldGroupClass}>
              <label className={labelClass}>Rule Type</label>
              <select
                value={formRuleType}
                onChange={(e) => handleRuleTypeChange(e.target.value as Rule['ruleType'])}
                className="w-full bg-gray-900 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-cyan-500 focus:outline-none"
              >
                {(['COMBINE', 'DEDUCT', 'THRESHOLD', 'FORMULA'] as const).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <p className="text-gray-500 text-xs mt-0.5">{RULE_DESCRIPTIONS[formRuleType]}</p>
            </div>

            {/* Type-specific fields */}
            {renderFormFields()}

            {/* Target field */}
            <div className={fieldGroupClass}>
              <label className={labelClass}>Target Field Name</label>
              <input
                value={targetField}
                onChange={(e) => setTargetField(e.target.value)}
                placeholder="e.g. Combined Revenue"
                className={inputClass}
              />
              {validationErrors['targetField'] && (
                <p className="text-red-400 text-xs">{validationErrors['targetField']}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={resetForm}
                className="text-xs text-gray-400 hover:text-white px-2 py-1"
              >Cancel</button>
              <button
                type="submit"
                disabled={!isFormValid()}
                className="text-xs bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1 rounded"
              >
                {editingRule ? 'Update Rule' : 'Save Rule'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rules list */}
      {loading ? (
        <div className="text-gray-500 text-xs text-center py-8">Loading…</div>
      ) : rules.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-2xl mb-2">⚙️</div>
          <p className="text-gray-500 text-xs">No rules yet. Create your first rule above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 space-y-1.5">
              {/* Header row */}
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${ruleTypeColor[r.ruleType]}`}>
                  {r.ruleType}
                </span>
                <span className="flex-1 text-white text-xs font-semibold truncate">{r.name}</span>
                <ToggleSwitch value={r.isActive} onChange={() => void handleToggle(r)} />
                <button
                  type="button"
                  onClick={() => openEditForm(r)}
                  className="text-gray-500 hover:text-cyan-400 text-xs ml-1"
                  title="Edit"
                >✏️</button>
                <button
                  type="button"
                  onClick={() => void handleDelete(r.id)}
                  className="text-gray-500 hover:text-red-400 text-xs"
                  title="Delete"
                >🗑️</button>
              </div>

              {/* Config summary */}
              {isConfigValid(r) ? (
                <p className="text-gray-400 text-xs font-mono leading-relaxed">
                  {renderConfigSummary(r)}
                </p>
              ) : (
                <details className="text-xs">
                  <summary className="text-yellow-500 cursor-pointer">Show raw config</summary>
                  <pre className="text-gray-400 mt-1 bg-gray-900 rounded p-2 text-xs overflow-auto">
                    {JSON.stringify(r.config, null, 2)}
                  </pre>
                </details>
              )}

              {/* Created date */}
              <p className="text-gray-600 text-xs">
                Created {new Date(r.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
