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
import WelcomeOverlay from './components/WelcomeOverlay';
import TabNav from './components/TabNav';
import ScanView from './components/ScanView';
import MappingView from './components/MappingView';
import JournalEntryPreview from './components/JournalEntryPreview';
import BillPreviewForm from './components/BillPreviewForm';
import VendorCreditPreviewForm from './components/VendorCreditPreviewForm';
import CheckPreviewForm from './components/CheckPreviewForm';
import QBDataView from './components/QBDataView';
import SyncView from './components/SyncView';
import SettingsView from './components/SettingsView';
import HelpPanel from './components/HelpPanel';
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
import type { TabId, ScanData, ScanEntry, ScanSource, Template } from '../types';
import { ToastProvider, ToastContainer } from './components/Toast';

const ROLE_META: Record<string, { icon: string; color: string }> = {
  OWNER: { icon: '👑', color: 'bg-amber-50 text-amber-600 border-amber-300' },
  ADMIN: { icon: '🛡️', color: 'bg-emerald-50 text-emerald-600 border-emerald-300' },
  MANAGER: { icon: '🔧', color: 'bg-indigo-50 text-indigo-600 border-indigo-300' },
  ACCOUNTANT: { icon: '📊', color: 'bg-emerald-50 text-emerald-600 border-emerald-300' },
  STAFF: { icon: '🧑‍💻', color: 'bg-emerald-50 text-emerald-600 border-emerald-300' },
  VIEWER: { icon: '👁️', color: 'bg-gray-100 text-gray-600 border-gray-300' },
};

export default function App() {
  const { jwt, user, loading, login, logout, refreshUser } = useAuth();
  const [currentTab, setCurrentTab] = useState<TabId>('dashboard');
  const [scanData, setScanData] = useState<ScanData | null>(null);
  const [scanRecordId, setScanRecordId] = useState<string | null>(null);
  const [scanEntries, setScanEntries] = useState<ScanEntry[]>([]);
  const [activeScanEntryId, setActiveScanEntryId] = useState<string | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [uploadedExcelFile, setUploadedExcelFile] = useState<File | null>(null);
  const [scanMode, setScanMode] = useState<ScanSource>('pos');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [selectedTemplateForScan, setSelectedTemplateForScan] = useState<Template | null>(null);
  const [showExcelImportModal, setShowExcelImportModal] = useState(false);
  const [scanAttachments, setScanAttachments] = useState<Array<{ id: string; fileName: string; fileSize: number; mimeType: string; createdAt: string }>>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [showEmailVerificationBanner, setShowEmailVerificationBanner] = useState(true);
  const [deferredMappings, setDeferredMappings] = useState(false);
  const [deferredSynced, setDeferredSynced] = useState(false);
  const [hasSavedMappings, setHasSavedMappings] = useState(false);
  const [hasSyncedBefore, setHasSyncedBefore] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const { status: qbStatus } = useQuickBooks(jwt);
  const { locations, loading: locationsLoading, refetch: refetchLocations } = useLocations(jwt);

  // After password change: refresh auth state by re-fetching session
  const handlePasswordChanged = useCallback(async () => {
    // Force reload to re-run useAuth session fetch with updated mustChangePassword
    window.location.reload();
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const interval = window.setInterval(() => {
      setResendCooldown((current) => Math.max(current - 1, 0));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [resendCooldown]);

  const handleResendVerification = useCallback(async () => {
    if (!jwt || resendCooldown > 0) return;
    setResendStatus('sending');
    setResendMessage(null);
    try {
      await api.resendEmailVerification(jwt);
      setResendStatus('success');
      setResendMessage('Verification email sent!');
      setResendCooldown(60);
    } catch (err) {
      setResendStatus('error');
      setResendMessage(err instanceof Error ? err.message : 'Failed to resend verification email.');
    }
  }, [jwt, resendCooldown]);

  useEffect(() => {
    if (scanData === null) {
      setScanRecordId(null);
    }
  }, [scanData]);

  useEffect(() => {
    if (!scanRecordId || !jwt) {
      setScanAttachments([]);
      return;
    }

    api.getScan(jwt, scanRecordId)
      .then((res) => setScanAttachments(res.attachments ?? []))
      .catch(() => setScanAttachments([]));
  }, [scanRecordId, jwt]);

  const activeScanEntry = scanEntries.find((entry) => entry.id === activeScanEntryId) ?? null;
  const currentScanSource = activeScanEntry?.source;
  const noScanData = !scanData && !activeScanEntry;
  const isIncompatibleTemplate = selectedTemplateForScan &&
    (selectedTemplateForScan.transactionType === 'BILL' || selectedTemplateForScan.transactionType === 'VENDOR_CREDIT') &&
    currentScanSource === 'pos';

  const activeLocations = locations.filter((location) => location.isActive);
  const dropdownLocations = activeLocations.length > 0 ? activeLocations : locations;

  useEffect(() => {
    if (user?.emailVerified) {
      setShowEmailVerificationBanner(false);
    }
  }, [user?.emailVerified]);

  useEffect(() => {
    if (!jwt || !user || user.emailVerified) return undefined;

    const intervalId = window.setInterval(() => {
      void refreshUser();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [jwt, user?.emailVerified, refreshUser, user]);

  useEffect(() => {
    if (!jwt || !user || dropdownLocations.length === 0) return;
    if (selectedLocationId === '') {
      setSelectedLocationId(dropdownLocations[0]?.id);
    }
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

  const handleHasSynced = useCallback(() => setDeferredSynced(true), []);

  if (loading) {
    return (
      <div className="flex items-center justify-center bg-[#F5F5F7]" style={{ width: '100vw', height: '100vh' }}>
        <div className="text-gray-600 text-sm">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <ToastProvider>
        <div className="flex flex-col bg-[#F5F5F7] text-gray-900" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-900">Nest</span>
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
      <div className="flex flex-col items-center justify-center bg-[#F5F5F7] text-gray-900" style={{ width: '100vw', height: '100vh' }}>
        <div className="text-center px-6">
          <div className="text-4xl mb-3">🚫</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Account Disabled</h2>
          <p className="text-sm text-gray-600 mb-5">Your account has been disabled. Please contact your administrator.</p>
          <button onClick={logout} className="px-4 py-2 bg-gray-100 border border-gray-200 text-gray-900 rounded-lg text-sm hover:bg-gray-200">
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
        <div className="flex flex-col bg-[#F5F5F7] text-gray-900" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-900">Nest</span>
            <button onClick={logout} className="text-xs text-gray-600 hover:text-gray-900">Sign Out</button>
          </div>
          <ChangePasswordView jwt={jwt!} onDone={handlePasswordChanged} />
          <ToastContainer />
        </div>
      </ToastProvider>
    );
  }

  if (!user.emailVerified) {
    return (
      <ToastProvider>
        <div className="flex flex-col bg-[#F5F5F7] text-gray-900" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-900">Nest</span>
            <button onClick={logout} className="text-xs text-gray-600 hover:text-gray-900">Sign Out</button>
          </div>
          <div className="flex flex-col items-center justify-center flex-1 px-6 py-10 text-center">
            <div className="max-w-md w-full rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
              <div className="text-base font-semibold text-gray-900 mb-3">Verify your email address</div>
              <div className="text-sm text-gray-600 mb-6">
                Please verify your email to continue using Nest. A verification link was sent to <span className="font-medium text-gray-900">{user.email}</span>.
              </div>
              {resendMessage && (
                <div className={`mb-4 text-xs ${resendStatus === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {resendMessage}
                </div>
              )}
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resendCooldown > 0 || resendStatus === 'sending'}
                className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-300 disabled:text-gray-500 text-white py-2 text-xs font-semibold transition-colors"
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend verification email'}
              </button>
              <button
                type="button"
                onClick={logout}
                className="mt-3 w-full rounded-lg border border-gray-200 bg-white text-gray-900 py-2 text-xs font-semibold hover:bg-gray-50"
              >
                Sign Out
              </button>
            </div>
          </div>
          <ToastContainer />
        </div>
      </ToastProvider>
    );
  }

  // Determine visible tabs based on role + permissions
  const role = user.role;
  const visibleTabs: TabId[] = [];

  if (role === 'OWNER') {
    visibleTabs.push('dashboard', 'scan', 'mappings', 'products', 'rules', 'preview', 'data', 'sync', 'payments', 'clients', 'users', 'locations', 'activity', 'settings');
  } else if (role === 'ADMIN' || role === 'MANAGER') {
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
      <div className="flex flex-col bg-[#F5F5F7] text-gray-900" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
        {/* Expired trial warning banner */}
        {user.status === 'EXPIRED' && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-600 text-center flex-shrink-0">
            <p className="font-medium">Your access has expired.</p>
            {user.customExpiryMessage && (
              <p className="mt-1">{user.customExpiryMessage}</p>
            )}
            <p className="mt-1">Contact your admin or owner for renewal.</p>
          </div>
        )}

        {/* Grace period warning banner */}
        {user.status === 'GRACE_PERIOD' && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-600 text-center flex-shrink-0">
            ⚠ Your write access expires soon. Contact your administrator.
          </div>
        )}

        {/* Time-bombed restricted banner */}
        {user.status === 'TIME_BOMBED' && (
          <div className="px-4 py-2 bg-red-50 border-b border-red-300 text-xs text-red-600 text-center flex-shrink-0">
            🚫 Your write access has been restricted. You have view-only access. Contact your administrator.
          </div>
        )}

        {/* Header */}
        <div className="grid items-center px-4 py-2 bg-white border-b border-gray-200 flex-shrink-0" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
          <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${ROLE_META[user.role]?.color ?? 'bg-gray-100 text-gray-600 border-gray-300'}`}>
              {ROLE_META[user.role]?.icon} {user.role}
            </span>
            {user.status === 'EXPIRED' && (
              <span className="inline-flex items-center px-1 py-0.5 rounded border text-[10px] font-medium bg-amber-50 text-amber-600 border-amber-200">⚠</span>
            )}
            <span className="text-[9px] text-gray-600 truncate max-w-[90px]">{user.email}</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <span className="text-emerald-400 font-bold text-base tracking-tight">🪹 Nest</span>
            <span className="text-gray-600 text-xs">Financial Automation</span>
            <span className="text-gray-600 text-[10px]" title="Created by John Paul O. Escuadra">· by JP Escuadra</span>
            {user.bonusScans ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-100">
                +{user.bonusScans} bonus scans
              </span>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              disabled={locationsLoading || dropdownLocations.length === 0}
              className="h-8 bg-white border border-gray-200 text-gray-900 text-[10px] px-2 rounded"
            >
              {locationsLoading || dropdownLocations.length === 0 ? (
                <option value="">{locationsLoading ? 'Loading locations...' : 'No locations'}</option>
              ) : (
                dropdownLocations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))
              )}
            </select>
            <button
              onClick={() => setShowHelp(true)}
              className="text-gray-600 hover:text-gray-900 text-sm transition-colors"
              title="Help"
              aria-label="Open help"
            >
              ❓
            </button>
          </div>
        </div>

        {user && !user.emailVerified && showEmailVerificationBanner && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-600 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">⚠️ Please verify your email. Check your inbox or resend from Settings.</p>
            </div>
            <button
              onClick={() => setShowEmailVerificationBanner(false)}
              className="text-amber-700 hover:text-amber-900 text-xs"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Tab Nav */}
        <TabNav currentTab={effectiveTab} onTabChange={setCurrentTab} visibleTabs={visibleTabs} />

        {/* Onboarding banner for owner users */}
        {onboardingState.step > 0 && (
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
            <div className="flex items-center justify-center gap-1 px-4 py-1 bg-gray-100 border-b border-gray-200 flex-shrink-0">
              {steps.map((step, i) => {
                const stepIdx = steps.findIndex((s) => s.id === step.id);
                const isCurrent = effectiveTab === step.id;
                const isCompleted = currentIdx > stepIdx;
                return (
                  <React.Fragment key={step.id}>
                    <span className={`text-[10px] font-medium px-1 rounded ${
                      isCurrent ? 'text-emerald-400' : isCompleted ? 'text-green-400' : 'text-gray-600'
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
              user={user!}
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
              invoiceFile={invoiceFile}
              setInvoiceFile={setInvoiceFile}
              uploadedExcelFile={uploadedExcelFile}
              setUploadedExcelFile={setUploadedExcelFile}
              scanMode={scanMode}
              setScanMode={setScanMode}
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
              initialTemplate={selectedTemplateForScan}
              showExcelImportModal={showExcelImportModal}
              setShowExcelImportModal={setShowExcelImportModal}
            />
          )}
          {effectiveTab === 'products' && (
            <ProductCatalogView jwt={jwt!} />
          )}
          {effectiveTab === 'preview' && (
            noScanData || !selectedTemplateForScan ? (
              <div className="p-6 rounded-lg border border-orange-200 bg-orange-50 text-orange-700 text-sm">
                Select a template and scan data to preview the transaction.
              </div>
            ) : isIncompatibleTemplate ? (
              <div className="p-6 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-sm">
                <div className="font-semibold text-orange-900">Template Not Compatible</div>
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
                userRole={user?.role}
                attachments={scanAttachments}
              />
            ) : selectedTemplateForScan.transactionType === 'VENDOR_CREDIT' ? (
              <VendorCreditPreviewForm
                jwt={jwt!}
                scanData={scanData}
                activeScanEntry={activeScanEntry}
                selectedLocationId={selectedLocationId}
                scanRecordId={scanRecordId}
                selectedTemplate={selectedTemplateForScan}
                userRole={user?.role}
                attachments={scanAttachments}
              />
            ) : selectedTemplateForScan.transactionType === 'CHEQUE' ? (
              <CheckPreviewForm
                jwt={jwt!}
                scanData={scanData}
                activeScanEntry={activeScanEntry}
                selectedLocationId={selectedLocationId}
                scanRecordId={scanRecordId}
                selectedTemplate={selectedTemplateForScan}
                userRole={user?.role}
                attachments={scanAttachments}
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
                userRole={user?.role}
                attachments={scanAttachments}
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
              onHasSynced={handleHasSynced}
              userRole={user?.role ?? 'VIEWER'}
            />
          )}
          {effectiveTab === 'settings' && (
            <SettingsView
              jwt={jwt!}
              user={user}
              onLogout={logout}
            />
          )}
          {effectiveTab === 'my-team' && <MyTeamTab jwt={jwt!} subscriptionSource={user.subscriptionSource} userRole={user.role} onUpgrade={() => setCurrentTab('settings')} />}
          {effectiveTab === 'activity' && <ActivityTab jwt={jwt!} />}
          {effectiveTab === 'clients' && <AdminsTab jwt={jwt!} />}
          {effectiveTab === 'users' && <UsersTab jwt={jwt!} />}
          {effectiveTab === 'locations' && (
            <LocationsTab
              jwt={jwt!}
              onboardingStep={onboardingState.step}
              onUpgrade={() => setCurrentTab('settings')}
            />
          )}
          {effectiveTab === 'rules' && <RulesView jwt={jwt!} selectedLocationId={selectedLocationId} onLocationChange={setSelectedLocationId} scanData={scanData} />}
          {effectiveTab === 'dashboard' && role === 'OWNER' && (
            <DashboardView
              jwt={jwt!}
              onboardingState={onboardingState}
              onNavigate={setCurrentTab}
              onHasSynced={handleHasSynced}
            />
          )}
          {effectiveTab === 'dashboard' && role === 'ADMIN' && <AdminDashboard jwt={jwt!} />}
          {effectiveTab === 'dashboard' && role !== 'OWNER' && role !== 'ADMIN' && <UserDashboard jwt={jwt!} user={user} />}
        </div>

        {/* Help overlay */}
        {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
        <ToastContainer />
        {user && !user.welcomedAt && (
          <WelcomeOverlay
            user={user}
            jwt={jwt!}
            onDismiss={async () => {
              try {
                await refetchLocations();
                await refreshUser();
              } catch (err) {
                console.error('Failed to refresh after welcome dismissal:', err);
              }
            }}
          />
        )}
      </div>
    </QBContextProvider>
    </ToastProvider>
  );
}

