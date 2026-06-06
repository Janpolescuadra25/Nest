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
  onAddMapping: () => void;
  onAutoDetect: () => void;
  onApplyTemplate: (template: string) => void;
  onSyncLists: () => void;
  listsLoading: boolean;
  accountsLoaded: boolean;
}

const TEMPLATE_NAMES = ['Standard Daily', 'Full Service', 'Quick Service'] as const;

export default function MappingFilters({
  locId,
  locations,
  onLocationChange,
  onExport,
  onImport,
  onAddMapping,
  onAutoDetect,
  onApplyTemplate,
  onSyncLists,
  listsLoading,
  accountsLoaded,
}: Props) {
  return (
    <>
      <div className="flex items-center gap-2">
        <select
          value={locId}
          onChange={(e) => onLocationChange(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:border-cyan-500 focus:outline-none"
        >
          {locations.length === 0 && <option value="">No locations</option>}
          {locations.map((location) => (
            <option key={location.id} value={location.id}>{location.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={onExport}
          className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1.5 rounded border border-gray-600 whitespace-nowrap transition-colors"
        >
          📤 Export
        </button>
        <button
          type="button"
          onClick={onImport}
          className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1.5 rounded border border-gray-600 whitespace-nowrap transition-colors"
        >
          📥 Import
        </button>
        <button
          onClick={onAddMapping}
          className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-2 py-1.5 rounded whitespace-nowrap transition-colors"
        >
          + Add
        </button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={onAutoDetect}
          className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition-colors"
        >
          🔍 Auto-Detect
        </button>
        {TEMPLATE_NAMES.map((template) => (
          <button
            key={template}
            onClick={() => onApplyTemplate(template)}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition-colors"
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
