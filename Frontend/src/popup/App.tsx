import React, { useState, useCallback } from 'react';
import { useAuth } from './hooks/useAuth';
import { QBContextProvider } from './contexts/QBContext';
import LoginView from './components/LoginView';
import ChangePasswordView from './components/ChangePasswordView';
import TabNav from './components/TabNav';
import ScanView from './components/ScanView';
import MappingView from './components/MappingView';
import JournalEntryPreview from './components/JournalEntryPreview';
import QBDataView from './components/QBDataView';
import SyncView from './components/SyncView';
import SettingsView from './components/SettingsView';
import HelpPanel from './components/HelpPanel';
import PartnersTab from './components/PartnersTab';
import RequestsTab from './components/RequestsTab';
import MyTeamTab from './components/MyTeamTab';
import ActivityTab from './components/ActivityTab';
import RulesView from './components/RulesView';
import DashboardView from './components/DashboardView';
import AdminDashboard from './components/AdminDashboard';
import type { TabId, ScanData } from '../types';
import { ToastProvider, ToastContainer } from './components/Toast';

const ROLE_META: Record<string, { icon: string; color: string }> = {
  OWNER: { icon: '👑', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-600' },
  ADMIN: { icon: '🛡️', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-600' },
  ACCOUNTANT: { icon: '📊', color: 'bg-blue-500/20 text-blue-300 border-blue-600' },
  STAFF: { icon: '🧑‍💻', color: 'bg-green-500/20 text-green-300 border-green-600' },
  VIEWER: { icon: '👁️', color: 'bg-gray-500/20 text-gray-300 border-gray-600' },
};

export default function App() {
  const { jwt, user, loading, login, logout } = useAuth();
  const [currentTab, setCurrentTab] = useState<TabId>('dashboard');
  const [scanData, setScanData] = useState<ScanData | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [showHelp, setShowHelp] = useState(false);

  // After password change: refresh auth state by re-fetching session
  const handlePasswordChanged = useCallback(async () => {
    // Force reload to re-run useAuth session fetch with updated mustChangePassword
    window.location.reload();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center bg-gray-900" style={{ width: '100vw', height: '100vh' }}>
        <div className="text-gray-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <ToastProvider>
        <div className="flex flex-col bg-gray-900 text-white" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
            <span className="text-sm font-semibold text-white">Nest</span>
          </div>
          <LoginView onLogin={login} />
          <ToastContainer />
        </div>
      </ToastProvider>
    );
  }

  // Disabled account — full-screen message
  if (user.status === 'DISABLED') {
    return (
      <div className="flex flex-col items-center justify-center bg-gray-900 text-white" style={{ width: '100vw', height: '100vh' }}>
        <div className="text-center px-6">
          <div className="text-4xl mb-3">🚫</div>
          <h2 className="text-lg font-semibold text-white mb-2">Account Disabled</h2>
          <p className="text-sm text-gray-400 mb-5">Your account has been disabled. Please contact your administrator.</p>
          <button onClick={logout} className="px-4 py-2 bg-slate-700 text-gray-300 rounded-lg text-sm hover:bg-slate-600">
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Must change password — show password change flow
  if (user.mustChangePassword) {
    return (
      <ToastProvider>
        <div className="flex flex-col bg-gray-900 text-white" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
            <span className="text-sm font-semibold text-white">Nest</span>
            <button onClick={logout} className="text-xs text-gray-500 hover:text-gray-300">Sign Out</button>
          </div>
          <ChangePasswordView jwt={jwt!} onDone={handlePasswordChanged} />
          <ToastContainer />
        </div>
      </ToastProvider>
    );
  }

  // Determine visible tabs based on role + permissions
  const role = user.role;
  const visibleTabs: TabId[] = [];

  if (role === 'OWNER') {
    visibleTabs.push('dashboard', 'scan', 'mappings', 'rules', 'preview', 'data', 'sync', 'partners', 'requests', 'activity', 'settings');
  } else if (role === 'ADMIN') {
    visibleTabs.push('dashboard', 'my-team');
    if (user.canScan) visibleTabs.push('scan');
    if (user.canMap) visibleTabs.push('mappings', 'rules', 'preview');
    if (user.canSync) visibleTabs.push('data', 'sync');
    visibleTabs.push('settings');
  } else {
    // STAFF / ACCOUNTANT / VIEWER
    if (user.canScan) visibleTabs.push('scan');
    if (user.canMap) visibleTabs.push('mappings', 'rules', 'preview');
    if (user.canSync) visibleTabs.push('data', 'sync');
    visibleTabs.push('settings');
  }

  // Default to first tab if currentTab not visible
  const effectiveTab = visibleTabs.includes(currentTab) ? currentTab : (visibleTabs[0] ?? 'settings');

  return (
    <ToastProvider>
    <QBContextProvider jwt={jwt!}>
      <div className="flex flex-col bg-gray-900 text-white" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
        {/* Expired trial warning banner */}
        {user.status === 'EXPIRED' && (
          <div className="px-4 py-2 bg-yellow-900/60 border-b border-yellow-700 text-xs text-yellow-300 text-center flex-shrink-0">
            ⚠ Your trial has expired. Contact support to continue.
          </div>
        )}

        {/* Header */}
        <div className="grid items-center px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
          <div className="flex items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${ROLE_META[user.role]?.color ?? 'bg-gray-500/20 text-gray-300 border-gray-600'}`}>
              {ROLE_META[user.role]?.icon} {user.role}
            </span>
            {user.status === 'EXPIRED' && (
              <span className="inline-flex items-center px-1 py-0.5 rounded border text-[10px] font-medium bg-yellow-900/40 text-yellow-400 border-yellow-600">⚠</span>
            )}
            <span className="text-[9px] text-gray-500 truncate max-w-[90px]">{user.email}</span>
          </div>
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
        <TabNav currentTab={effectiveTab} onTabChange={setCurrentTab} visibleTabs={visibleTabs} />

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto" style={{ overflowX: 'hidden', minHeight: 0 }}>
          {effectiveTab === 'scan' && (
            <ScanView jwt={jwt!} scanData={scanData} onScanData={setScanData} locationId={selectedLocationId || null} />
          )}
          {effectiveTab === 'mappings' && (
            <MappingView
              jwt={jwt!}
              selectedLocationId={selectedLocationId}
              onLocationChange={setSelectedLocationId}
              scanData={scanData}
              onTabChange={setCurrentTab}
            />
          )}
          {effectiveTab === 'preview' && (
            <JournalEntryPreview
              jwt={jwt!}
              scanData={scanData}
              selectedLocationId={selectedLocationId}
            />
          )}
          {effectiveTab === 'data' && (
            <QBDataView />
          )}
          {effectiveTab === 'sync' && (
            <SyncView
              jwt={jwt!}
              selectedLocationId={selectedLocationId}
              onLocationChange={setSelectedLocationId}
            />
          )}
          {effectiveTab === 'settings' && (
            <SettingsView
              jwt={jwt!}
              onLogout={logout}
            />
          )}
          {effectiveTab === 'partners' && <PartnersTab jwt={jwt!} />}
          {effectiveTab === 'requests' && <RequestsTab jwt={jwt!} />}
          {effectiveTab === 'my-team' && <MyTeamTab jwt={jwt!} />}
          {effectiveTab === 'activity' && <ActivityTab jwt={jwt!} />}
          {effectiveTab === 'rules' && <RulesView jwt={jwt!} selectedLocationId={selectedLocationId} onLocationChange={setSelectedLocationId} />}
          {effectiveTab === 'dashboard' && role === 'OWNER' && <DashboardView jwt={jwt!} />}
          {effectiveTab === 'dashboard' && role === 'ADMIN' && <AdminDashboard jwt={jwt!} />}
        </div>

        {/* Help overlay */}
        {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
        <ToastContainer />
      </div>
    </QBContextProvider>
    </ToastProvider>
  );
}

