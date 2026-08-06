import React from 'react';
import type { TabId } from '../../types';

const ALL_TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
  { id: 'scan', label: 'Scan', icon: '🔍' },
  { id: 'mappings', label: 'Map', icon: '🗺️' },
  { id: 'products', label: 'Products', icon: '📦' },
  { id: 'rules', label: 'Rules', icon: '📐' },
  { id: 'preview', label: 'Preview', icon: '📋' },
  { id: 'payments', label: 'Payments', icon: '💳' },
  { id: 'data', label: 'Data', icon: '📊' },
  { id: 'review', label: 'Review', icon: '📋' },
  { id: 'approved', label: 'Approved', icon: '✅' },
  { id: 'sync-history', label: 'Sync', icon: '⚡' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'my-team', label: 'Team', icon: '👥' },
  { id: 'clients', label: 'Clients', icon: '🤝' },
  { id: 'activity', label: 'Activity', icon: '📜' },
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
    : ALL_TABS.filter(t => ['scan', 'mappings', 'preview', 'data', 'review', 'approved', 'sync-history', 'settings'].includes(t.id));

  return (
    <div className="flex border-b border-gray-200 bg-white flex-shrink-0 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-shrink-0 px-2 py-2 text-xs font-medium transition-colors flex flex-col items-center gap-0.5 min-w-[52px] ${
            currentTab === tab.id
              ? 'text-[var(--brand-color)] border-b-2 border-[var(--brand-color)] bg-[#F5F5F7]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span className="text-sm leading-none">{tab.icon}</span>
          <span className="text-xs">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
