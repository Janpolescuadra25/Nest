import React, { useState, useEffect } from 'react';
import { api, type UserInfo } from '../lib/api';
import { useQuickBooks } from '../hooks/useQuickBooks';
import PricingView from './PricingView';

interface Props {
  jwt: string;
  user: UserInfo;
  onLogout: () => void;
}

export default function SettingsView({ jwt, user, onLogout }: Props) {
  const { status, connect } = useQuickBooks(jwt);
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [showPricing, setShowPricing] = useState(false);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [scanUsage, setScanUsage] = useState<{
    scansUsed: number;
    maxScans: number;
    bonusScans: number;
    totalAvailable: number;
    plan: string;
  } | null>(null);
  const [scanPacks, setScanPacks] = useState<any[]>([]);
  const [showPackOptions, setShowPackOptions] = useState(false);
  const [packLoading, setPackLoading] = useState(false);
  const [usageLoading, setUsageLoading] = useState(true);
  const [packError, setPackError] = useState<string | null>(null);

  const handleResendVerification = async () => {
    setVerificationStatus('sending');
    setVerificationMessage(null);
    try {
      const response = await api.resendEmailVerification(jwt);
      setVerificationStatus('success');
      setVerificationMessage(response.message || 'Verification email sent.');
    } catch (err) {
      setVerificationStatus('error');
      setVerificationMessage(err instanceof Error ? err.message : 'Failed to send verification email.');
    }
  };

  const handleOpenBillingPortal = async () => {
    setBillingLoading(true);
    setBillingError(null);
    setBillingMessage(null);
    try {
      const response = await api.createPortalSession(jwt);
      window.location.href = response.url;
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Failed to open billing portal.');
    } finally {
      setBillingLoading(false);
    }
  };

  useEffect(() => {
    if (!jwt) return;
    setUsageLoading(true);
    api.getScanUsage(jwt)
      .then(setScanUsage)
      .catch(() => setScanUsage(null))
      .finally(() => setUsageLoading(false));
  }, [jwt]);

  const handleBuyMoreScans = async () => {
    if (!jwt) return;
    setPackError(null);
    if (scanPacks.length === 0) {
      setPackLoading(true);
      try {
        const response = await api.getScanPacks(jwt);
        setScanPacks(response.scanPacks);
        setShowPackOptions(true);
      } catch (err) {
        setPackError(err instanceof Error ? err.message : 'Failed to load scan packs.');
      } finally {
        setPackLoading(false);
      }
      return;
    }
    setShowPackOptions((current) => !current);
  };

  const handleSelectPack = async (pack: any) => {
    if (!jwt) return;
    setPackLoading(true);
    setPackError(null);
    try {
      const response = await api.createScanPackSession(jwt, pack.id);
      window.open(response.url, '_blank');
    } catch (err) {
      setPackError(err instanceof Error ? err.message : 'Failed to create scan pack checkout session.');
    } finally {
      setPackLoading(false);
    }
  };

  const billingStatusText = user.subscriptionSource === 'owner'
    ? '👑 Platform Owner — Unlimited Access'
    : user.subscriptionSource === 'stripe'
      ? `Paid plan ${user.currentPlan ?? 'Stripe'}${user.planInterval ? ` (${user.planInterval})` : ''}`
      : user.subscriptionSource === 'partner'
        ? 'Partner Plan (Owner-managed)'
        : user.trialExpiresAt
          ? `Free trial until ${new Date(user.trialExpiresAt).toLocaleDateString()}`
          : 'Free plan';

  const billingNotes = [] as string[];
  if (user.subscriptionSource === 'stripe' && user.cancelAtPeriodEnd) {
    billingNotes.push(`Your subscription ends on ${user.currentPeriodEnd ? new Date(user.currentPeriodEnd).toLocaleDateString() : 'the current period end'}.`);
  }
  if (user.subscriptionSource === 'stripe' && user.paymentIssue) {
    billingNotes.push('Payment failed. Please update your payment method in Stripe to avoid service interruption.');
  }

  return (
    <div className="p-3 space-y-4">
      {/* Email Verification section */}
      <div>
        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Email Verification</div>
        <div className={`rounded-lg p-3 ${user.emailVerified ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
          {!user.emailVerified ? (
            <>
              <div className="text-gray-900 text-xs font-semibold mb-1">⚠️ Your email is not verified.</div>
              <div className="text-gray-600 text-xs mb-3">Verify your email to keep your account fully active and receive important notifications.</div>
              {verificationStatus === 'success' && (
                <div className="text-emerald-600 text-xs mb-2">{verificationMessage}</div>
              )}
              {verificationStatus === 'error' && (
                <div className="text-red-600 text-xs mb-2">{verificationMessage}</div>
              )}
              <button
                onClick={handleResendVerification}
                disabled={verificationStatus === 'sending'}
                className={`w-full py-2 text-xs font-semibold rounded-lg transition-colors ${verificationStatus === 'sending' ? 'bg-yellow-600 text-gray-800' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}
              >
                {verificationStatus === 'sending' ? 'Sending…' : 'Resend Verification'}
              </button>
            </>
          ) : (
            <div>
              <div className="text-emerald-600 text-xs font-semibold mb-1">✅ Email verified</div>
              <div className="text-gray-600 text-xs">Your email is verified and your account is fully active.</div>
            </div>
          )}
        </div>
      </div>

      {/* QuickBooks section */}
      <div>
        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">QuickBooks Online</div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          {status.connected && !status.tokenExpired ? (
            <>
              <div className="text-emerald-600 text-xs mb-1">✅ Connected</div>
              <div className="text-gray-600 text-xs">Company ID: <span className="text-gray-900 font-mono">{status.realmId}</span></div>
              {status.expiresAt && (
                <div className="text-gray-600 text-xs mt-1">
                  Expires: {new Date(status.expiresAt).toLocaleString()}
                </div>
              )}
            </>
          ) : status.connected && status.tokenExpired ? (
            <>
              <div className="text-orange-400 text-xs mb-1">⚠️ Token Expired — Reconnect required</div>
              <div className="text-gray-600 text-xs">Company ID: <span className="text-gray-900 font-mono">{status.realmId}</span></div>
            </>
          ) : (
            <div className="text-red-600 text-xs mb-2">❌ Not connected to QuickBooks</div>
          )}
          <button
            onClick={connect}
            className={`mt-2 w-full py-2 text-xs font-semibold rounded-lg transition-colors ${
              status.tokenExpired
                ? 'bg-orange-700 hover:bg-orange-600 text-white'
                : status.connected
                  ? 'bg-gray-200 hover:bg-gray-100 text-gray-600'
                  : 'bg-emerald-700 hover:bg-emerald-600 text-white'
            }`}
          >
            {status.connected ? '↻ Reconnect to QuickBooks' : '🔗 Connect to QuickBooks'}
          </button>
        </div>
      </div>

      {/* Scan Usage section */}
      <div>
        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Scan Usage</div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Current Plan</div>
            <div className="text-lg font-semibold text-gray-900 mb-3">
              {scanUsage?.plan ? `${scanUsage.plan.charAt(0).toUpperCase()}${scanUsage.plan.slice(1).toLowerCase()}` : 'Unknown'}
            </div>
          </div>
          {usageLoading ? (
            <div className="bg-gray-100 animate-pulse h-2.5 rounded-full w-full" />
          ) : scanUsage === null ? (
            <div className="text-sm text-gray-400">Usage info unavailable</div>
          ) : (
            <>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Scans This Month</div>
              <div className="w-full bg-gray-100 rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full ${Math.min((scanUsage.scansUsed / scanUsage.totalAvailable) * 100, 100) >= 90 ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ width: `${scanUsage.totalAvailable > 0 ? Math.min((scanUsage.scansUsed / scanUsage.totalAvailable) * 100, 100) : 0}%` }}
                />
              </div>
              {scanUsage.totalAvailable > 0 && (scanUsage.scansUsed / scanUsage.totalAvailable) * 100 >= 90 ? (
                <div className="text-xs text-red-500 mt-1">Running low</div>
              ) : null}
              <div className="text-sm text-gray-500 mt-1">{scanUsage.scansUsed} of {scanUsage.totalAvailable} scans used</div>
              {scanUsage.bonusScans > 0 ? (
                <div className="text-sm font-medium text-emerald-600 mt-1">+{scanUsage.bonusScans} bonus scans available</div>
              ) : null}
            </>
          )}
          {user.role !== 'VIEWER' ? (
            <>
              <button
                type="button"
                onClick={handleBuyMoreScans}
                disabled={packLoading}
                className="mt-3 w-full bg-emerald-500 text-white rounded-lg px-4 py-2 hover:bg-emerald-600 transition-colors text-sm font-medium"
              >
                {packLoading ? 'Loading…' : 'Buy More Scans'}
              </button>
              {showPackOptions && (
                <div className="mt-2 space-y-2">
                  {scanPacks.map((pack) => (
                    <button
                      key={pack.id}
                      type="button"
                      onClick={() => handleSelectPack(pack)}
                      className="w-full border border-emerald-500 text-emerald-600 rounded-lg px-4 py-2 hover:bg-emerald-50 transition-colors text-sm"
                    >
                      {pack.name} — {pack.scans} scans — ${pack.price}
                    </button>
                  ))}
                  {packError && <div className="text-xs text-red-500 mt-1">{packError}</div>}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Billing section */}
      <div>
        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Billing</div>
        <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-3">
          <div className="text-sm text-gray-900">{billingStatusText}</div>
          {user.subscriptionSource === 'stripe' && user.currentPeriodEnd ? (
            <div className="text-gray-600 text-xs">Renewal: {new Date(user.currentPeriodEnd).toLocaleDateString()}</div>
          ) : null}
          {billingNotes.length > 0 && (
            <div className="space-y-1 text-xs">
              {billingNotes.map((note) => (
                <div key={note} className={`rounded-lg px-3 py-2 ${user.paymentIssue ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-gray-900'}`}>
                  {note}
                </div>
              ))}
            </div>
          )}
          {billingMessage && <div className="text-emerald-600 text-xs">{billingMessage}</div>}
          {billingError && <div className="text-red-600 text-xs">{billingError}</div>}
          <div className="grid gap-2 sm:grid-cols-2">
            {user.subscriptionSource === 'owner' ? null : user.subscriptionSource === 'stripe' ? (
              <>
                <button
                  type="button"
                  onClick={handleOpenBillingPortal}
                  disabled={billingLoading}
                  className="w-full rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white py-2 text-xs font-semibold"
                >
                  {billingLoading ? 'Opening portal…' : 'Manage Billing'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPricing(true)}
                  className="w-full rounded-lg bg-[#F5F5F7] hover:bg-gray-50 text-gray-700 py-2 text-xs font-semibold"
                >
                  Upgrade Plan
                </button>
              </>
            ) : user.subscriptionSource === 'partner' ? (
              <button
                type="button"
                onClick={() => chrome.tabs.create({ url: 'mailto:support@nestsync.fyi?subject=Nest Billing Inquiry' })}
                className="w-full rounded-lg border border-gray-200 bg-[#F5F5F7] text-gray-600 py-2 text-xs font-semibold hover:bg-gray-50"
              >
                Contact owner for billing
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowPricing(true)}
                className="w-full rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white py-2 text-xs font-semibold"
              >
                Choose a plan
              </button>
            )}
            <button
              type="button"
              onClick={() => chrome.tabs.create({ url: 'mailto:support@nestsync.fyi?subject=Nest Billing Help' })}
              className="w-full rounded-lg border border-gray-200 bg-[#F5F5F7] text-gray-600 py-2 text-xs font-semibold hover:bg-gray-50"
            >
              Billing help
            </button>
          </div>
        </div>
      </div>

      {showPricing && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <PricingView jwt={jwt} user={user} onManageBilling={handleOpenBillingPortal} onClose={() => setShowPricing(false)} />
        </div>
      )}

      {/* Account section */}
      <div>
        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Account</div>
        <button
          onClick={onLogout}
          className="w-full py-2 text-xs text-red-600 border border-red-200 hover:bg-red-50 rounded-lg transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* About Nest */}
      <div>
        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">About Nest</div>

        {/* Branding card */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 flex items-center gap-3">
          <span className="text-3xl leading-none">🪹</span>
          <div>
            <div className="text-gray-900 font-bold text-sm">Nest</div>
            <div className="text-gray-600 text-xs">Version 1.0.0</div>
            <div className="text-gray-600 text-xs mt-0.5">Restaurant Financial Automation</div>
          </div>
        </div>

        {/* Creator card */}
        <div className="from-white to-gray-50 border border-gray-200 rounded-lg p-3 mb-3">
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Created By</div>
          <div className="text-gray-900 text-sm font-medium">John Paul O. Escuadra</div>
          <div className="text-gray-600 text-xs mt-1 leading-relaxed">
            John Paul is a full-stack developer specializing in restaurant technology and financial integrations.
            Nest was built to solve the real-world challenge of bridging POS sales data with QuickBooks accounting,
            making daily bookkeeping effortless for restaurant teams.
          </div>
        </div>

        {/* Support card */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3">
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Need Help?</div>
          <a
            href="javascript:void(0)"
            onClick={(e) => { e.preventDefault(); chrome.tabs.create({ url: 'mailto:support@nestsync.fyi' }); }}
            className="flex items-center gap-2 text-emerald-400 hover:text-emerald-600 text-xs transition-colors mb-2"
          >
            <span>✉️</span>
            <span>support@nestsync.fyi</span>
          </a>
          <div className="flex gap-2">
            <a
              href="javascript:void(0)"
              onClick={(e) => { e.preventDefault(); chrome.tabs.create({ url: 'mailto:support@nestsync.fyi?subject=Nest%20Bug%20Report' }); }}
              className="flex-1 text-center text-xs bg-gray-200 hover:bg-gray-100 text-gray-600 hover:text-gray-900 py-1.5 rounded transition-colors"
            >
              🐛 Report a Bug
            </a>
            <a
              href="javascript:void(0)"
              onClick={(e) => { e.preventDefault(); chrome.tabs.create({ url: 'mailto:support@nestsync.fyi?subject=Nest%20Feature%20Request' }); }}
              className="flex-1 text-center text-xs bg-gray-200 hover:bg-gray-100 text-gray-600 hover:text-gray-900 py-1.5 rounded transition-colors"
            >
              💡 Feature Request
            </a>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-600">Made with ❤️ in the Philippines</p>
      </div>
    </div>
  );
}
