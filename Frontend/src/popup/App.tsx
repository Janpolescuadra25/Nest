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
      <div className="flex items-center justify-center bg-gray-900" style={{ width: 950, height: 750 }}>
        <div className="text-gray-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (!jwt) {
    return (
      <div className="flex flex-col bg-gray-900 text-white" style={{ width: 950, height: 750, overflow: 'hidden' }}>
        <div className="grid items-center px-4 py-3 bg-gray-800 border-b border-gray-700 flex-shrink-0" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
          <div />
          <div className="flex items-center justify-center gap-2">
            <span className="text-cyan-400 font-bold text-lg tracking-tight">🪹 Nest</span>
            <span className="text-gray-500 text-xs">Toast → QuickBooks</span>
          </div>
          <div />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <LoginView onLogin={setJwt} />
        </div>
      </div>
    );
  }

  return (
    <QBContextProvider jwt={jwt}>
      <div className="flex flex-col bg-gray-900 text-white" style={{ width: 950, height: 750, overflow: 'hidden' }}>
        {/* Header */}
        <div className="grid items-center px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
          <div />
          <div className="flex items-center justify-center gap-2">
            <span className="text-cyan-400 font-bold text-base tracking-tight">🪹 Nest</span>
            <span className="text-gray-500 text-xs">Toast → QuickBooks</span>
            <span className="text-gray-600 text-[10px]" title="Created by John Paul O. Escuadra">· by JP Escuadra</span>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setShowHelp(true)}
              className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
              title="Help"
              aria-label="Open help"
            >
              ❓
            </button>
          </div>
        </div>

        {/* Tab Nav */}
        <TabNav currentTab={currentTab} onTabChange={setCurrentTab} />

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto" style={{ overflowX: 'hidden', minHeight: 0 }}>
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
