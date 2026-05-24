import React, { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import LoginView from './components/LoginView';
import TabNav from './components/TabNav';
import ScanView from './components/ScanView';
import MappingView from './components/MappingView';
import RulesView from './components/RulesView';
import JournalEntryPreview from './components/JournalEntryPreview';
import SettingsView from './components/SettingsView';
import type { TabId, ScanData } from '../types';

export default function App() {
  const { jwt, setJwt, loading } = useAuth();
  const [currentTab, setCurrentTab] = useState<TabId>('scan');
  const [scanData, setScanData] = useState<ScanData | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full bg-gray-900" style={{ height: 500 }}>
        <div className="text-gray-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (!jwt) {
    return <LoginView onLogin={setJwt} />;
  }

  return (
    <div className="flex flex-col bg-gray-900 text-white" style={{ width: 380, height: 500 }}>
      {/* Header */}
      <div className="flex items-center px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <span className="text-cyan-400 font-bold text-base tracking-tight">Nest</span>
        <span className="ml-2 text-gray-500 text-xs">Toast → QuickBooks</span>
      </div>

      {/* Tab Nav */}
      <TabNav currentTab={currentTab} onTabChange={setCurrentTab} />

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {currentTab === 'scan' && (
          <ScanView jwt={jwt} scanData={scanData} onScanData={setScanData} />
        )}
        {currentTab === 'mappings' && (
          <MappingView
            jwt={jwt}
            selectedLocationId={selectedLocationId}
            onLocationChange={setSelectedLocationId}
          />
        )}
        {currentTab === 'rules' && (
          <RulesView
            jwt={jwt}
            selectedLocationId={selectedLocationId}
            onLocationChange={setSelectedLocationId}
          />
        )}
        {currentTab === 'sync' && (
          <JournalEntryPreview
            jwt={jwt}
            scanData={scanData}
            selectedLocationId={selectedLocationId}
          />
        )}
        {currentTab === 'settings' && (
          <SettingsView
            jwt={jwt}
            onLogout={() => {
              chrome.storage.local.remove(['jwt']);
              setJwt(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
