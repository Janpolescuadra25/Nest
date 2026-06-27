import React from 'react';
import SearchableSelect from '../SearchableSelect';
import MappingEditModal from './MappingEditModal';
import type { LocalMapping } from './index';
import type { SelectOption } from '../SearchableSelect';
import type { QBAccount } from '../../types/qb';
import { validateMappingAccountType } from './index';

interface Props {
  localMappings: LocalMapping[];
  accountOptions: SelectOption[];
  accounts: QBAccount[];
  classOptions: SelectOption[];
  taxCodeOptions: SelectOption[];
  scanFieldOptions: SelectOption[];
  entityOptions: SelectOption[];
  saving: string | null;
  deleting: string | null;
  onUpdate: (localId: string, patch: Partial<LocalMapping>) => void;
  onSave: (mapping: LocalMapping) => void;
  onDelete: (mapping: LocalMapping) => void;
  onToggleExpand: (localId: string) => void;
  onAddMapping?: () => void;
  isBill?: boolean;
  isVendorCredit?: boolean;
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
  accounts,
  onAddMapping,
  isBill = false,
  isVendorCredit = false,
}: Props) {
  return (
    <div className="space-y-2">
      {localMappings.map((mapping) => (
        <MappingCard
          key={mapping.localId}
          mapping={mapping}
          accountOptions={accountOptions}
          accounts={accounts}
          classOptions={classOptions}
          taxCodeOptions={taxCodeOptions}
          scanFieldOptions={scanFieldOptions}
          entityOptions={entityOptions}
          isSaving={saving === mapping.localId}
          isDeleting={deleting === mapping.localId}
          onUpdate={(patch) => onUpdate(mapping.localId, patch)}
          onSave={() => onSave(mapping)}
          onDelete={() => onDelete(mapping)}
          onToggleExpand={() => onToggleExpand(mapping.localId)}
          isBill={isBill}
          isVendorCredit={isVendorCredit}
        />
      ))}
      {localMappings.length > 0 && onAddMapping && (
        <button
          type="button"
          onClick={onAddMapping}
          className="w-full py-2 text-sm text-teal-400 hover:text-teal-300 border border-dashed border-gray-600 rounded-md hover:border-teal-400 transition-colors"
        >
          + Add mapping
        </button>
      )}
    </div>
  );
}

interface MappingCardProps {
  mapping: LocalMapping;
  accountOptions: SelectOption[];
  accounts: QBAccount[];
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
  isBill: boolean;
  isVendorCredit: boolean;
}

function MappingCard({
  mapping,
  accountOptions,
  accounts,
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
  isBill,
  isVendorCredit,
}: MappingCardProps) {
  const selectedAccount = accountOptions.find((option) => option.value === mapping.accountId);
  const selectedQBAccount = accounts.find((account) => account.Id === mapping.accountId);
  const warning = validateMappingAccountType(selectedQBAccount?.AccountType, mapping.postingType);

  const amountLabel = scanFieldOptions.find((option) => option.value === mapping.sourceField)?.subtitle ?? '$0.00';
  const hidePostingType = isBill || isVendorCredit;

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
              placeholder="Source field…"
            />
          ) : (
            <input
              className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
              value={mapping.sourceField}
              onChange={(e) => onUpdate({ sourceField: e.target.value })}
              placeholder="Source field name…"
            />
          )}
        </div>
        {mapping.conditions && mapping.conditions.length > 0 && (
          <span className="text-[10px] text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded shrink-0">
            🔀 {mapping.conditions.length}
          </span>
        )}
        {hidePostingType ? (
          <div className="flex flex-col items-end text-right text-xs text-gray-400 shrink-0">
            <span>Amount</span>
            <span className="text-white">{amountLabel}</span>
          </div>
        ) : (
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
        )}
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
          <>
            <div className="text-xs text-gray-600 mt-0.5 truncate">{selectedAccount.subtitle}</div>
            {warning && (
              <div className="text-xs text-amber-400 mt-0.5 flex items-center gap-1 truncate" title={warning}>
                <span>⚠️</span>
                <span>{warning}</span>
              </div>
            )}
          </>
        )}
      </div>

      {mapping.expanded && (
        <MappingEditModal
          mapping={mapping}
          classOptions={classOptions}
          taxCodeOptions={taxCodeOptions}
          entityOptions={entityOptions}
          scanFieldOptions={scanFieldOptions}
          onUpdate={onUpdate}
          onSave={onSave}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}
