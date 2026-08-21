import React from 'react';
import type { SelectOption } from '../SearchableSelect';

interface LocationOption {
  id: string;
  name: string;
}

interface Props {
  locId: string;
  locations: LocationOption[];
  onLocationChange: (id: string) => void;
  onExport: () => void;
  onImport: () => void;
  onAISuggest: () => void;
  suggesting?: boolean;
  onApplyTemplate: (template: string) => void;
  onSyncLists: () => void;
  listsLoading: boolean;
  accountsLoaded: boolean;
  showImportButton?: boolean;
  disablePresets?: boolean;
}

const TEMPLATE_NAMES = ['Standard Daily', 'Full Service', 'Quick Service'] as const;

export default function MappingFilters({
  locId,
  locations,
  onLocationChange,
  onExport,
  onImport,
  onAISuggest,
  suggesting,
  onApplyTemplate,
  onSyncLists,
  listsLoading,
  accountsLoaded,
  showImportButton,
  disablePresets,
}: Props) {
  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExport}
          className="text-xs bg-white hover:bg-gray-100 text-gray-600 px-2 py-1.5 rounded border border-gray-300 whitespace-nowrap transition-colors"
        >
          📤 Export
        </button>
        {showImportButton !== false && (
          <button
            type="button"
            onClick={onImport}
            className="text-xs bg-white hover:bg-gray-100 text-gray-600 px-2 py-1.5 rounded border border-gray-300 whitespace-nowrap transition-colors"
          >
            📥 Import
          </button>
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={onAISuggest}
          disabled={suggesting}
          className={`text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded transition-colors ${suggesting ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
        >
          {suggesting ? 'Suggesting…' : '🤖 AI Suggest'}
        </button>
        {TEMPLATE_NAMES.map((template) => (
          <button
            key={template}
            onClick={disablePresets ? undefined : () => onApplyTemplate(template)}
            title={disablePresets ? 'Presets are designed for POS scans' : undefined}
            className={`text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded transition-colors ${disablePresets ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
          >
            📋 {template}
          </button>
        ))}
        <button
          onClick={onSyncLists}
          disabled={listsLoading}
          className="text-xs bg-gray-200 hover:bg-gray-100 disabled:opacity-40 text-gray-600 px-2 py-1 rounded transition-colors ml-auto"
          title="Refresh QB lists"
        >
          {listsLoading ? '…' : '↻'}
        </button>
      </div>

      {!accountsLoaded && (
        <div className="bg-amber-50 border border-amber-700 text-amber-600 text-xs rounded-lg px-3 py-2">
          ⚠️ QB accounts not loaded. Make sure QuickBooks is connected in Settings.
        </div>
      )}
    </>
  );
}
