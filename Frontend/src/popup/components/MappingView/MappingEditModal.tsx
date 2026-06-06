import React from 'react';
import SearchableSelect from '../SearchableSelect';
import type { LocalMapping } from './index';
import type { SelectOption } from '../SearchableSelect';

const AMOUNT_RULES = ['Direct Amount', 'Percentage of Total', 'Static Value'] as const;

interface Props {
  mapping: LocalMapping;
  classOptions: SelectOption[];
  taxCodeOptions: SelectOption[];
  entityOptions: SelectOption[];
  onUpdate: (patch: Partial<LocalMapping>) => void;
  onSave: () => void;
  isSaving: boolean;
}

export default function MappingEditModal({
  mapping,
  classOptions,
  taxCodeOptions,
  entityOptions,
  onUpdate,
  onSave,
  isSaving,
}: Props) {
  return (
    <div className="px-3 pb-3 space-y-2 border-t border-gray-700/60 pt-2">
      <div>
        <div className="text-xs text-gray-500 mb-0.5">Description</div>
        <input
          className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
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
        <SearchableSelect
          label="Entity (opt)"
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
        <div>
          <div className="text-xs text-gray-500 mb-0.5">Amount Rule</div>
          <select
            value={mapping.amountRule}
            onChange={(e) => onUpdate({ amountRule: e.target.value })}
            className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
          >
            {AMOUNT_RULES.map((rule) => (
              <option key={rule} value={rule}>{rule}</option>
            ))}
          </select>
        </div>
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

      <button
        type="button"
        onClick={onSave}
        disabled={isSaving || !mapping.isDirty}
        className="w-full text-xs bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white py-1.5 rounded transition-colors"
      >
        {isSaving ? 'Saving…' : mapping.isDirty ? '💾 Save' : '✓ Saved'}
      </button>
    </div>
  );
}
