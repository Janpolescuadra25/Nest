import React, { useState } from 'react';
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
