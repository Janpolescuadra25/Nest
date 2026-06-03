import React from 'react';
import type { TabId } from '../../types';

const ALL_TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
  { id: 'scan', label: 'Scan', icon: '🔍' },
  { id: 'mappings', label: 'Map', icon: '🗺️' },
  { id: 'rules', label: 'Rules', icon: '📐' },
  { id: 'preview', label: 'Preview', icon: '📋' },
  { id: 'data', label: 'Data', icon: '📊' },
  { id: 'sync', label: 'Sync', icon: '⚡' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'my-team', label: 'Team', icon: '👥' },
  { id: 'partners', label: 'Partners', icon: '🤝' },
  { id: 'requests', label: 'Requests', icon: '📬' },
  { id: 'activity', label: 'Activity', icon: '📜' },
  { id: 'admins', label: 'Admins', icon: '🛡️' },
  { id: 'users', label: 'Users', icon: '👤' },
  { id: 'locations', label: 'Locations', icon: '📍' },
];

interface Props {
  currentTab: TabId;
  onTabChange: (tab: TabId) => void;
  visibleTabs?: TabId[];
}

export default function TabNav({ currentTab, onTabChange, visibleTabs }: Props) {
  const tabs = visibleTabs
    ? ALL_TABS.filter(t => visibleTabs.includes(t.id))
    : ALL_TABS.filter(t => ['scan', 'mappings', 'preview', 'data', 'sync', 'settings'].includes(t.id));

  return (
    <div className="flex border-b border-gray-700 bg-gray-800 flex-shrink-0 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-shrink-0 px-2 py-2 text-xs font-medium transition-colors flex flex-col items-center gap-0.5 min-w-[52px] ${
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
