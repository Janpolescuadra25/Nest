import React, { useState, useCallback, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useQuickBooks } from './hooks/useQuickBooks';
import { useLocations } from './hooks/useLocations';
import { QBContextProvider } from './contexts/QBContext';
import { hasPerm } from './lib/permissions';
import { api } from './lib/api';
import { getOnboardingState, type OnboardingState } from './lib/onboarding';
import { OnboardingBanner } from './components/OnboardingBanner';
import LoginView from './components/LoginView';
import ChangePasswordView from './components/ChangePasswordView';
import TabNav from './components/TabNav';
import ScanView from './components/ScanView';
import MappingView from './components/MappingView';
import JournalEntryPreview from './components/JournalEntryPreview';
import BillPreviewForm from './components/BillPreviewForm';
import VendorCreditPreviewForm from './components/VendorCreditPreviewForm';
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
import { UserDashboard } from './components/UserDashboard';
import BillPaymentView from './components/BillPaymentView';
import AdminsTab from './components/AdminsTab';
import UsersTab from './components/UsersTab';
import LocationsTab from './components/LocationsTab';
import ProductCatalogView from './components/ProductCatalogView';
import type { TabId, ScanData, ScanEntry, Template } from '../types';
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
  const [scanRecordId, setScanRecordId] = useState<string | null>(null);
  const [scanEntries, setScanEntries] = useState<ScanEntry[]>([]);
  const [activeScanEntryId, setActiveScanEntryId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [selectedTemplateForScan, setSelectedTemplateForScan] = useState<Template | null>(null);
  const [showExcelImportModal, setShowExcelImportModal] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showEmailVerificationBanner, setShowEmailVerificationBanner] = useState(true);
  const [deferredMappings, setDeferredMappings] = useState(false);
  const [deferredSynced, setDeferredSynced] = useState(false);
  const [hasSavedMappings, setHasSavedMappings] = useState(false);
  const [hasSyncedBefore, setHasSyncedBefore] = useState(false);
  const { status: qbStatus } = useQuickBooks(jwt);
  const { locations } = useLocations(jwt);

  // After password change: refresh auth state by re-fetching session
  const handlePasswordChanged = useCallback(async () => {
    // Force reload to re-run useAuth session fetch with updated mustChangePassword
    window.location.reload();
  }, []);

  useEffect(() => {
    if (scanData === null) {
      setScanRecordId(null);
    }
  }, [scanData]);

  const activeScanEntry = scanEntries.find((entry) => entry.id === activeScanEntryId) ?? null;
  const currentScanSource = activeScanEntry?.source;
  const noScanData = !scanData && !activeScanEntry;
  const isIncompatibleTemplate = selectedTemplateForScan &&
    (selectedTemplateForScan.transactionType === 'BILL' || selectedTemplateForScan.transactionType === 'VENDOR_CREDIT') &&
    currentScanSource === 'pos';

  useEffect(() => {
    if (user?.emailVerified) {
      setShowEmailVerificationBanner(false);
    }
  }, [user?.emailVerified]);

  useEffect(() => {
    if (!jwt || !user || user.role !== 'OWNER' || locations.length === 0) return;
    let active = true;

    const loadMappings = async () => {
      try {
        const results = await Promise.allSettled(
          locations.map((location) => api.getMappings(jwt, location.id).then((mappings) => mappings.length)),
        );
        if (!active) return;

        const hasMappings = results.some(
          (result) => result.status === 'fulfilled' && result.value > 0,
        );

        if (hasMappings) {
          setHasSavedMappings(true);
        }
      } catch {
        // ignore mapping load failures; onboarding can still update later
      }
    };

    void loadMappings();
    return () => {
      active = false;
    };
  }, [jwt, user, locations]);

  useEffect(() => {
    if (!jwt || !user || user.role !== 'OWNER') return;
    let active = true;

    const loadOwnerStats = async () => {
      try {
        const stats = await api.getOwnerStats(jwt);
        if (!active) return;

        if (stats.totalSynced > 0) {
          setHasSyncedBefore(true);
        }
      } catch {
        // ignore stats load failures; onboarding can still update later
      }
    };

    void loadOwnerStats();
    return () => {
      active = false;
    };
  }, [jwt, user]);

  const onboardingState = getOnboardingState({
    qbStatus: qbStatus || null,
    hasLocations: locations.length > 0,
    hasMappings: deferredMappings || hasSavedMappings,
    hasSynced: deferredSynced || hasSyncedBefore,
  });

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
    visibleTabs.push('dashboard', 'scan', 'mappings', 'products', 'rules', 'preview', 'data', 'sync', 'payments', 'partners', 'requests', 'admins', 'users', 'locations', 'activity', 'settings');
  } else if (role === 'ADMIN') {
    visibleTabs.push('dashboard', 'my-team');
    if (hasPerm(user, 'scan', 'write')) visibleTabs.push('scan');
    if (hasPerm(user, 'map', 'write')) visibleTabs.push('mappings', 'products', 'rules', 'preview');
    if (hasPerm(user, 'sync', 'execute')) visibleTabs.push('data', 'sync', 'payments');
    if (hasPerm(user, 'locations', 'write')) visibleTabs.push('locations');
    visibleTabs.push('settings');
  } else {
    visibleTabs.push('dashboard');
    if (hasPerm(user, 'scan', 'write')) visibleTabs.push('scan');
    if (hasPerm(user, 'map', 'write')) visibleTabs.push('mappings', 'products', 'rules', 'preview');
    if (hasPerm(user, 'sync', 'execute')) visibleTabs.push('data', 'sync', 'payments');
    if (hasPerm(user, 'locations', 'write')) visibleTabs.push('locations');
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
            <p className="font-medium">Your access has expired.</p>
            {user.customExpiryMessage && (
              <p className="mt-1">{user.customExpiryMessage}</p>
            )}
            <p className="mt-1">Contact your admin or owner for renewal.</p>
          </div>
        )}

        {/* Grace period warning banner */}
        {user.status === 'GRACE_PERIOD' && (
          <div className="px-4 py-2 bg-yellow-900/60 border-b border-yellow-700 text-xs text-yellow-300 text-center flex-shrink-0">
            ⚠ Your write access expires soon. Contact your administrator.
          </div>
        )}

        {/* Time-bombed restricted banner */}
        {user.status === 'TIME_BOMBED' && (
          <div className="px-4 py-2 bg-red-900/60 border-b border-red-700 text-xs text-red-300 text-center flex-shrink-0">
            🚫 Your write access has been restricted. You have view-only access. Contact your administrator.
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
            <span className="text-gray-500 text-xs">POS → QuickBooks</span>
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

        {user && !user.emailVerified && showEmailVerificationBanner && (
          <div className="px-4 py-2 bg-yellow-900/60 border-b border-yellow-700 text-xs text-yellow-300 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">⚠️ Please verify your email. Check your inbox or resend from Settings.</p>
            </div>
            <button
              onClick={() => setShowEmailVerificationBanner(false)}
              className="text-yellow-200 hover:text-white text-xs"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Tab Nav */}
        <TabNav currentTab={effectiveTab} onTabChange={setCurrentTab} visibleTabs={visibleTabs} />

        {/* Onboarding banner for owner users */}
        {role === 'OWNER' && onboardingState.step > 0 && (
          <OnboardingBanner state={onboardingState} onNavigate={setCurrentTab} />
        )}

        {/* Pipeline progress indicator — shown when scan data is loaded */}
        {(scanData !== null || scanEntries.length > 0) && (() => {
          const steps: { id: string; label: string }[] = [
            { id: 'scan', label: '① Scan' },
            { id: 'mappings', label: '② Map' },
            { id: 'rules', label: '③ Rules' },
            { id: 'preview', label: '④ Preview' },
            { id: 'sync', label: '⑤ Sync' },
          ];
          const currentIdx = steps.findIndex((s) => s.id === effectiveTab);
          return (
            <div className="flex items-center justify-center gap-1 px-4 py-1 bg-gray-800/50 border-b border-gray-700 flex-shrink-0">
              {steps.map((step, i) => {
                const stepIdx = steps.findIndex((s) => s.id === step.id);
                const isCurrent = effectiveTab === step.id;
                const isCompleted = currentIdx > stepIdx;
                return (
                  <React.Fragment key={step.id}>
                    <span className={`text-[10px] font-medium px-1 rounded ${
                      isCurrent ? 'text-cyan-400' : isCompleted ? 'text-green-400' : 'text-gray-600'
                    }`}>
                      {step.label}
                    </span>
                    {i < steps.length - 1 && <span className="text-gray-700 text-[10px]">→</span>}
                  </React.Fragment>
                );
              })}
            </div>
          );
        })()}

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto" style={{ overflowX: 'hidden', minHeight: 0 }}>
          {effectiveTab === 'scan' && (
            <ScanView
              jwt={jwt!}
              scanData={scanData}
              onScanData={setScanData}
              onClearScanData={() => setScanData(null)}
              onScanRecordId={setScanRecordId}
              locationId={selectedLocationId || null}
              onboardingStep={onboardingState.step}
              selectedTemplate={selectedTemplateForScan}
              onOpenExcelImportModal={() => setShowExcelImportModal(true)}
              onTabChange={setCurrentTab}
              scanEntries={scanEntries}
              setScanEntries={setScanEntries}
              activeScanEntryId={activeScanEntryId}
              setActiveScanEntryId={setActiveScanEntryId}
              activeScanEntry={activeScanEntry}
            />
          )}
          {effectiveTab === 'mappings' && (
            <MappingView
              jwt={jwt!}
              selectedLocationId={selectedLocationId}
              onLocationChange={setSelectedLocationId}
              scanData={scanData}
              scanEntries={scanEntries}
              activeScanEntry={activeScanEntry}
              onActiveScanEntryIdChange={setActiveScanEntryId}
              onTabChange={setCurrentTab}
              onboardingStep={onboardingState.step}
              onHasMappings={() => setDeferredMappings(true)}
              onSelectedTemplateChange={setSelectedTemplateForScan}
              showExcelImportModal={showExcelImportModal}
              setShowExcelImportModal={setShowExcelImportModal}
            />
          )}
          {effectiveTab === 'products' && (
            <ProductCatalogView jwt={jwt!} />
          )}
          {effectiveTab === 'preview' && (
            noScanData || !selectedTemplateForScan ? (
              <div className="p-6 rounded-lg border border-orange-500 bg-orange-950/50 text-orange-200 text-sm">
                Select a template and scan data to preview the transaction.
              </div>
            ) : isIncompatibleTemplate ? (
              <div className="p-6 rounded-lg border border-yellow-500 bg-yellow-950/50 text-yellow-200 text-sm">
                <div className="font-semibold text-white">Template Not Compatible</div>
                <p className="mt-2">
                  Bill and Vendor Credit templates are designed for invoice scans (image/PDF). Your current scan is from POS data. Please use a Journal Entry template for POS scans, or scan an invoice to use this template.
                </p>
              </div>
            ) : selectedTemplateForScan.transactionType === 'BILL' ? (
              <BillPreviewForm
                jwt={jwt!}
                scanData={scanData}
                activeScanEntry={activeScanEntry}
                selectedLocationId={selectedLocationId}
                scanRecordId={scanRecordId}
                selectedTemplate={selectedTemplateForScan}
                onNavigateToPayments={() => setCurrentTab('payments')}
              />
            ) : selectedTemplateForScan.transactionType === 'VENDOR_CREDIT' ? (
              <VendorCreditPreviewForm
                jwt={jwt!}
                scanData={scanData}
                activeScanEntry={activeScanEntry}
                selectedLocationId={selectedLocationId}
                scanRecordId={scanRecordId}
                selectedTemplate={selectedTemplateForScan}
              />
            ) : (
              <JournalEntryPreview
                jwt={jwt!}
                scanData={scanData}
                scanEntries={scanEntries}
                activeScanEntry={activeScanEntry}
                activeScanEntryId={activeScanEntryId}
                onActiveScanEntryIdChange={setActiveScanEntryId}
                selectedLocationId={selectedLocationId}
                scanRecordId={scanRecordId}
              />
            )
          )}
          {effectiveTab === 'payments' && (
            <BillPaymentView
              jwt={jwt!}
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
              onTabChange={(tab) => setCurrentTab(tab as TabId)}
              onScanRecordId={setScanRecordId}
              onboardingStep={onboardingState.step}
              onHasSynced={() => setDeferredSynced(true)}
            />
          )}
          {effectiveTab === 'settings' && (
            <SettingsView
              jwt={jwt!}
              user={user}
              onLogout={logout}
            />
          )}
          {effectiveTab === 'partners' && <PartnersTab jwt={jwt!} />}
          {effectiveTab === 'requests' && <RequestsTab jwt={jwt!} />}
          {effectiveTab === 'my-team' && <MyTeamTab jwt={jwt!} subscriptionSource={user.subscriptionSource} />}
          {effectiveTab === 'activity' && <ActivityTab jwt={jwt!} />}
          {effectiveTab === 'admins' && <AdminsTab jwt={jwt!} />}
          {effectiveTab === 'users' && <UsersTab jwt={jwt!} />}
          {effectiveTab === 'locations' && (
            <LocationsTab
              jwt={jwt!}
              onboardingStep={onboardingState.step}
            />
          )}
          {effectiveTab === 'rules' && <RulesView jwt={jwt!} selectedLocationId={selectedLocationId} onLocationChange={setSelectedLocationId} scanData={scanData} />}
          {effectiveTab === 'dashboard' && role === 'OWNER' && (
            <DashboardView
              jwt={jwt!}
              onboardingState={onboardingState}
              onNavigate={setCurrentTab}
              onHasSynced={() => setDeferredSynced(true)}
            />
          )}
          {effectiveTab === 'dashboard' && role === 'ADMIN' && <AdminDashboard jwt={jwt!} />}
          {effectiveTab === 'dashboard' && role !== 'OWNER' && role !== 'ADMIN' && <UserDashboard jwt={jwt!} user={user} />}
        </div>

        {/* Help overlay */}
        {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
        <ToastContainer />
      </div>
    </QBContextProvider>
    </ToastProvider>
  );
}

