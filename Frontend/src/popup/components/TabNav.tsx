import React from 'react';
import type { TabId } from '../../types';

const TABS: { id: TabId; label: string }[] = [
  { id: 'scan', label: 'Scan' },
  { id: 'mappings', label: 'Map' },
  { id: 'rules', label: 'Rules' },
  { id: 'sync', label: 'Sync' },
  { id: 'settings', label: 'Settings' },
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
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            currentTab === tab.id
              ? 'text-cyan-400 border-b-2 border-cyan-400 bg-gray-900'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
