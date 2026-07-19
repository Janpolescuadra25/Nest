import React, { useState } from 'react';
import SearchableSelect from '../SearchableSelect';
import type { LocalMapping } from './index';
import type { MappingCondition } from '../../../types';
import type { SelectOption } from '../SearchableSelect';

const AMOUNT_RULES = ['Direct Amount', 'Percentage of Total', 'Static Value'] as const;

interface Props {
  mapping: LocalMapping;
  classOptions: SelectOption[];
  taxCodeOptions: SelectOption[];
  entityOptions: SelectOption[];
  scanFieldOptions: SelectOption[];
  onUpdate: (patch: Partial<LocalMapping>) => void;
  onSave: () => void;
  isSaving: boolean;
}

export default function MappingEditModal({
  mapping,
  classOptions,
  taxCodeOptions,
  entityOptions,
  scanFieldOptions,
  onUpdate,
  onSave,
  isSaving,
}: Props) {
  const [conditionsOpen, setConditionsOpen] = useState(false);
  return (
    <div className="px-3 pb-3 space-y-2 border-t border-gray-700/60 pt-2">
      <div>
        <div className="text-xs text-gray-500 mb-0.5">Description</div>
        <input
          className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-emerald-500 focus:outline-none"
          value={mapping.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="Line description…"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SearchableSelect
          label="Class"
          options={classOptions}
          value={mapping.classId}
          onChange={(v) => onUpdate({ classId: v })}
          placeholder={classOptions.length === 0 ? 'None' : 'Class…'}
          disabled={classOptions.length === 0}
        />
        <SearchableSelect
          label="Tax Code"
          options={taxCodeOptions}
          value={mapping.taxCodeId}
          onChange={(v) => onUpdate({ taxCodeId: v })}
          placeholder={taxCodeOptions.length === 0 ? 'None' : 'Tax code…'}
          disabled={taxCodeOptions.length === 0}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-gray-400 mb-0.5">Priority</label>
          <input
            type="number"
            min={0}
            value={mapping.priority ?? 0}
            onChange={(e) => onUpdate({ priority: parseInt(e.target.value, 10) || 0 })}
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-400 mb-0.5">Entity (opt)</label>
          <SearchableSelect
            options={entityOptions}
            value={mapping.entityType ? `${mapping.entityType}:${mapping.entityId}` : ''}
            onChange={(v) => {
              if (!v) { onUpdate({ entityType: '', entityId: '' }); return; }
              const [type, id] = v.split(':') as [LocalMapping['entityType'], string];
              onUpdate({ entityType: type, entityId: id });
            }}
            placeholder="Customer/Vendor…"
            disabled={entityOptions.length === 0}
          />
        </div>
      </div>

      <div>
        <div className="text-xs text-gray-500 mb-0.5">Amount Rule</div>
        <select
          value={mapping.amountRule}
          onChange={(e) => onUpdate({ amountRule: e.target.value })}
          className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-emerald-500 focus:outline-none"
        >
          {AMOUNT_RULES.map((rule) => (
            <option key={rule} value={rule}>{rule}</option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={mapping.keepSeparate}
          onChange={(e) => onUpdate({ keepSeparate: e.target.checked, isDirty: true })}
          className="rounded border-gray-600"
        />
        <span className="text-xs text-gray-400">🔒 Keep separate</span>
        <span className="text-xs text-gray-600">— don't merge with other lines</span>
      </label>

      {/* Conditions Builder */}
      <div className="border border-gray-700 rounded">
        <button
          type="button"
          onClick={() => setConditionsOpen(!conditionsOpen)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-300 hover:bg-gray-800/50 rounded"
        >
          <span>Conditions {mapping.conditions?.length ? `(${mapping.conditions.length})` : ''}</span>
          <span className="text-gray-500">{conditionsOpen ? '▼' : '▶'}</span>
        </button>

        {conditionsOpen && (
          <div className="px-3 pb-3 space-y-2">
            {mapping.conditions && mapping.conditions.length > 0 ? (
              mapping.conditions.map((cond, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select
                    value={cond.field}
                    onChange={(e) => {
                      const updated = [...(mapping.conditions || [])];
                      updated[i] = { ...updated[i], field: e.target.value };
                      onUpdate({ conditions: updated });
                    }}
                    className="flex-1 bg-gray-900 border border-gray-600 rounded px-1.5 py-1 text-xs text-white"
                  >
                    <option value="">Select field…</option>
                    {scanFieldOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={cond.operator}
                    onChange={(e) => {
                      const updated = [...(mapping.conditions || [])];
                      updated[i] = { ...updated[i], operator: e.target.value as MappingCondition['operator'] };
                      onUpdate({ conditions: updated });
                    }}
                    className="w-32 bg-gray-900 border border-gray-600 rounded px-1.5 py-1 text-xs text-white"
                  >
                    <optgroup label="Comparison">
                      <option value="equals">equals</option>
                      <option value="not_equals">not equals</option>
                      <option value="greater_than">greater than</option>
                      <option value="greater_than_or_equal">greater or equal</option>
                      <option value="less_than">less than</option>
                      <option value="less_than_or_equal">less or equal</option>
                    </optgroup>
                    <optgroup label="Text">
                      <option value="contains">contains</option>
                      <option value="not_contains">not contains</option>
                      <option value="begins_with">begins with</option>
                      <option value="ends_with">ends with</option>
                      <option value="not_begins_with">not begins with</option>
                      <option value="not_ends_with">not ends with</option>
                    </optgroup>
                  </select>

                  <input
                    type="text"
                    value={cond.value}
                    onChange={(e) => {
                      const updated = [...(mapping.conditions || [])];
                      updated[i] = { ...updated[i], value: e.target.value };
                      onUpdate({ conditions: updated });
                    }}
                    className="w-24 bg-gray-900 border border-gray-600 rounded px-1.5 py-1 text-xs text-white"
                    placeholder="Value"
                  />

                  <button
                    type="button"
                    onClick={() => {
                      const updated = (mapping.conditions || []).filter((_, idx) => idx !== i);
                      onUpdate({ conditions: updated.length > 0 ? updated : null });
                    }}
                    className="text-gray-500 hover:text-red-400 text-xs px-1 shrink-0"
                    title="Remove condition"
                  >
                    ✕
                  </button>
                </div>
              ))
            ) : (
              <p className="text-[10px] text-gray-500 py-1">No conditions — this mapping always matches.</p>
            )}

            <button
              type="button"
              onClick={() => {
                const newCond: MappingCondition = { field: '', operator: 'equals', value: '' };
                onUpdate({ conditions: [...(mapping.conditions || []), newCond] });
              }}
              className="text-[10px] text-purple-400 hover:text-purple-300"
            >
              + Add condition
            </button>

            <p className="text-[10px] text-gray-600">
              All conditions in a row must match (AND). Create separate mapping rows for OR logic. Higher priority mappings are checked first.
            </p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={isSaving || !mapping.isDirty}
        className="w-full text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white py-1.5 rounded transition-colors"
      >
        {isSaving ? 'Saving…' : mapping.isDirty ? '💾 Save' : '✓ Saved'}
      </button>
    </div>
  );
}
