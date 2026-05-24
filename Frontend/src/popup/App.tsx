import React, { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { QBContextProvider } from './contexts/QBContext';
import LoginView from './components/LoginView';
import TabNav from './components/TabNav';
import ScanView from './components/ScanView';
import MappingView from './components/MappingView';
import JournalEntryPreview from './components/JournalEntryPreview';
import QBDataView from './components/QBDataView';
import SyncView from './components/SyncView';
import SettingsView from './components/SettingsView';
import HelpPanel from './components/HelpPanel';
import type { TabId, ScanData } from '../types';

export default function App() {
  const { jwt, setJwt, loading } = useAuth();
  const [currentTab, setCurrentTab] = useState<TabId>('scan');
  const [scanData, setScanData] = useState<ScanData | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [showHelp, setShowHelp] = useState(false);

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
    <QBContextProvider jwt={jwt}>
      <div className="flex flex-col bg-gray-900 text-white relative" style={{ width: 900, minHeight: 650 }}>
        {/* Header */}
        <div className="flex items-center px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">
          <span className="text-cyan-400 font-bold text-base tracking-tight">Nest</span>
          <span className="ml-2 text-gray-500 text-xs">Toast → QuickBooks</span>
          <span
            className="ml-1 text-gray-700 text-xs hidden sm:inline"
            title="Created by John Paul O. Escuadra"
          >
            · by JP Escuadra
          </span>
          <button
            onClick={() => setShowHelp(true)}
            className="ml-auto text-gray-500 hover:text-gray-300 text-sm transition-colors"
            title="Help"
            aria-label="Open help"
          >
            ❓
          </button>
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
              scanData={scanData}
              onTabChange={setCurrentTab}
            />
          )}
          {currentTab === 'preview' && (
            <JournalEntryPreview
              jwt={jwt}
              scanData={scanData}
              selectedLocationId={selectedLocationId}
            />
          )}
          {currentTab === 'data' && (
            <QBDataView />
          )}
          {currentTab === 'sync' && (
            <SyncView
              jwt={jwt}
              selectedLocationId={selectedLocationId}
              onLocationChange={setSelectedLocationId}
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

        {/* Help overlay */}
        {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      </div>
    </QBContextProvider>
  );
}
