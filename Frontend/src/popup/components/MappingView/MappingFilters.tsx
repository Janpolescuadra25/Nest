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
  onAutoDetect: () => void;
  onAISuggest: () => void;
  onApplyTemplate: (template: string) => void;
  onSyncLists: () => void;
  listsLoading: boolean;
  accountsLoaded: boolean;
  showImportButton?: boolean;
  disableAutoDetect?: boolean;
  disablePresets?: boolean;
}

const TEMPLATE_NAMES = ['Standard Daily', 'Full Service', 'Quick Service'] as const;

export default function MappingFilters({
  locId,
  locations,
  onLocationChange,
  onExport,
  onImport,
  onAutoDetect,
  onAISuggest,
  onApplyTemplate,
  onSyncLists,
  listsLoading,
  accountsLoaded,
  showImportButton,
  disableAutoDetect,
  disablePresets,
}: Props) {
  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExport}
          className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1.5 rounded border border-gray-600 whitespace-nowrap transition-colors"
        >
          📤 Export
        </button>
        {showImportButton !== false && (
          <button
            type="button"
            onClick={onImport}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1.5 rounded border border-gray-600 whitespace-nowrap transition-colors"
          >
            📥 Import
          </button>
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={disableAutoDetect ? undefined : onAutoDetect}
          title={disableAutoDetect ? 'Auto-Detect is designed for POS scans' : undefined}
          className={`text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded transition-colors ${disableAutoDetect ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-600'}`}
        >
          🔍 Auto-Detect
        </button>
        <button
          onClick={disableAutoDetect ? undefined : onAISuggest}
          title={disableAutoDetect ? 'AI Suggest is designed for POS scans' : undefined}
          className={`text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded transition-colors ${disableAutoDetect ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-600'}`}
        >
          🤖 AI Suggest
        </button>
        {TEMPLATE_NAMES.map((template) => (
          <button
            key={template}
            onClick={disablePresets ? undefined : () => onApplyTemplate(template)}
            title={disablePresets ? 'Presets are designed for POS scans' : undefined}
            className={`text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded transition-colors ${disablePresets ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-600'}`}
          >
            📋 {template}
          </button>
        ))}
        <button
          onClick={onSyncLists}
          disabled={listsLoading}
          className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 px-2 py-1 rounded transition-colors ml-auto"
          title="Refresh QB lists"
        >
          {listsLoading ? '…' : '↻'}
        </button>
      </div>

      {!accountsLoaded && (
        <div className="bg-amber-900/30 border border-amber-700 text-amber-300 text-xs rounded-lg px-3 py-2">
          ⚠️ QB accounts not loaded. Make sure QuickBooks is connected in Settings.
        </div>
      )}
    </>
  );
}
