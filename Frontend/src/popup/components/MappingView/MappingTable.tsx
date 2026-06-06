import React from 'react';
import SearchableSelect from '../SearchableSelect';
import MappingEditModal from './MappingEditModal';
import type { LocalMapping } from './index';
import type { SelectOption } from '../SearchableSelect';

interface Props {
  localMappings: LocalMapping[];
  accountOptions: SelectOption[];
  classOptions: SelectOption[];
  taxCodeOptions: SelectOption[];
  scanFieldOptions: SelectOption[];
  entityOptions: SelectOption[];
  saving: string | null;
  deleting: string | null;
  onUpdate: (localId: string, patch: Partial<LocalMapping>) => void;
  onSave: (mapping: LocalMapping, index: number) => void;
  onDelete: (mapping: LocalMapping) => void;
  onToggleExpand: (localId: string) => void;
}

export default function MappingTable({
  localMappings,
  accountOptions,
  classOptions,
  taxCodeOptions,
  scanFieldOptions,
  entityOptions,
  saving,
  deleting,
  onUpdate,
  onSave,
  onDelete,
  onToggleExpand,
}: Props) {
  return (
    <div className="space-y-2">
      {localMappings.map((mapping, index) => (
        <MappingCard
          key={mapping.localId}
          mapping={mapping}
          index={index}
          accountOptions={accountOptions}
          classOptions={classOptions}
          taxCodeOptions={taxCodeOptions}
          scanFieldOptions={scanFieldOptions}
          entityOptions={entityOptions}
          isSaving={saving === mapping.localId}
          isDeleting={deleting === mapping.localId}
          onUpdate={(patch) => onUpdate(mapping.localId, patch)}
          onSave={() => onSave(mapping, index)}
          onDelete={() => onDelete(mapping)}
          onToggleExpand={() => onToggleExpand(mapping.localId)}
        />
      ))}
    </div>
  );
}

interface MappingCardProps {
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
  mapping,
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
}: MappingCardProps) {
  const selectedAccount = accountOptions.find((option) => option.value === mapping.accountId);

  return (
    <div className={`bg-gray-800 border rounded-lg overflow-hidden transition-all ${
      mapping.isDirty ? 'border-cyan-700' : 'border-gray-700'
    }`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggleExpand}
          className="text-gray-500 hover:text-gray-300 text-xs shrink-0"
        >
          {mapping.expanded ? '▼' : '▶'}
        </button>
        <div className="flex-1 min-w-0">
          {scanFieldOptions.length > 0 ? (
            <SearchableSelect
              options={scanFieldOptions}
              value={mapping.sourceField}
              onChange={(value) => onUpdate({ sourceField: value, description: value || mapping.description })}
              placeholder="Toast field…"
            />
          ) : (
            <input
              className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
              value={mapping.sourceField}
              onChange={(e) => onUpdate({ sourceField: e.target.value })}
              placeholder="Toast field name…"
            />
          )}
        </div>
        <div className="flex rounded overflow-hidden border border-gray-600 shrink-0">
          <button
            type="button"
            onClick={() => onUpdate({ postingType: 'Debit' })}
            className={`text-xs px-2 py-0.5 transition-colors ${
              mapping.postingType === 'Debit'
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
              mapping.postingType === 'Credit'
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

      <div className="px-3 pb-2">
        <SearchableSelect
          options={accountOptions}
          value={mapping.accountId}
          onChange={(value) => onUpdate({ accountId: value })}
          placeholder="QB Account…"
        />
        {selectedAccount && (
          <div className="text-xs text-gray-600 mt-0.5 truncate">{selectedAccount.subtitle}</div>
        )}
      </div>

      {mapping.expanded && (
        <MappingEditModal
          mapping={mapping}
          classOptions={classOptions}
          taxCodeOptions={taxCodeOptions}
          entityOptions={entityOptions}
          onUpdate={onUpdate}
          onSave={onSave}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}
