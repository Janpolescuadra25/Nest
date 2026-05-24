import React from 'react';
import type { TabId } from '../../types';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'scan', label: 'Scan', icon: '🔍' },
  { id: 'mappings', label: 'Map', icon: '🗺️' },
  { id: 'preview', label: 'Preview', icon: '📋' },
  { id: 'data', label: 'Data', icon: '📊' },
  { id: 'sync', label: 'Sync', icon: '⚡' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

interface Props {
  currentTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export default function TabNav({ currentTab, onTabChange }: Props) {
  return (
    <div className="flex border-b border-gray-700 bg-gray-800 flex-shrink-0">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 py-2 text-xs font-medium transition-colors flex flex-col items-center gap-0.5 ${
            currentTab === tab.id
              ? 'text-cyan-400 border-b-2 border-cyan-400 bg-gray-900'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <span className="text-sm leading-none">{tab.icon}</span>
          <span className="text-xs">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
