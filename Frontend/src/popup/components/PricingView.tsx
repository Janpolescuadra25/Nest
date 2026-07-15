import React, { useEffect, useState } from 'react';
import { api, type Plan, type UserInfo } from '../lib/api';

interface Props {
  jwt: string;
  user: UserInfo;
  onManageBilling: () => Promise<void>;
  onClose: () => void;
}

const formatHistory = (days: number) => {
  if (days === 7) return '7-day history';
  if (days === 30) return '30-day history';
  if (days === 90) return '90-day history';
  if (days === 365) return '1-year history';
  if (days === 730) return '2-year history';
  return `${days}-day history`;
};

export default function PricingView({ jwt, user, onManageBilling, onClose }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingPlan, setSubmittingPlan] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month');

  useEffect(() => {
    (async () => {
      try {
        const result = await api.getPlans(jwt);
        setPlans(result.plans);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load plans');
      } finally {
        setLoading(false);
      }
    })();
  }, [jwt]);

  const handleSelectPlan = async (planId: string) => {
    setError(null);
    setSubmittingPlan(planId);
    try {
      const result = await api.createCheckoutSession(jwt, planId, billingInterval);
      window.open(result.url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setSubmittingPlan(null);
    }
  };

  if (user.subscriptionSource === 'owner') {
    return (
      <div className="p-4 text-center">
        <div className="text-sm text-cyan-300 font-semibold">Platform Owner — Unlimited Access</div>
        <div className="mt-2 text-xs text-gray-400">You have full access to all Nest features.</div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Choose Your Plan</h2>
          <p className="text-sm text-gray-400">Pick a plan that fits your team and scan needs.</p>
        </div>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-white">Back</button>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-gray-700 bg-gray-900 p-1">
        <button
          type="button"
          onClick={() => setBillingInterval('month')}
          className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${billingInterval === 'month' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setBillingInterval('year')}
          className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${billingInterval === 'year' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          Annual — Save 20%
        </button>
      </div>

      {error && <div className="rounded-2xl border border-red-700 bg-red-900/30 p-3 text-sm text-red-200">{error}</div>}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-28 rounded-3xl bg-gray-900 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {plans.map((plan) => {
            const isCurrent = (user.subscriptionSource === 'stripe' && user.currentPlan === plan.id)
              || (plan.id === 'free' && (!user.subscriptionSource || user.currentPlan === 'free'));
            const price = billingInterval === 'year' ? plan.annualPrice : plan.monthlyPrice;
            const priceLabel = plan.monthlyPrice === 0 ? '$0/mo' : `$${price}/mo`;
            const savings = billingInterval === 'year' ? Math.round(100 - (plan.annualPrice / plan.monthlyPrice) * 100) : 0;

            return (
              <div
                key={plan.id}
                className={`rounded-3xl border p-4 ${plan.id === 'professional' ? 'border-cyan-500 bg-cyan-900/20' : 'border-gray-700 bg-gray-900'}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">{plan.name}</div>
                    <div className="mt-3 text-3xl font-bold text-white">{priceLabel}</div>
                    {billingInterval === 'year' && plan.monthlyPrice > 0 && (
                      <div className="mt-1 text-xs text-gray-400">Billed annually — saves {savings}%</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {plan.id === 'professional' && <span className="rounded-full bg-cyan-600 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white">Most Popular</span>}
                    {isCurrent && <span className="rounded-full bg-emerald-600 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white">Current Plan</span>}
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-sm text-gray-300">
                  <div>{plan.maxUsers} user{plan.maxUsers !== 1 ? 's' : ''} • {plan.maxLocations} locations</div>
                  <div>{plan.maxScans.toLocaleString()} AI scans/mo • {formatHistory(plan.scanHistoryDays)}</div>
                  {plan.prioritySupport && <div>Priority support</div>}
                </div>

                <div className="mt-5 flex flex-col gap-2">
                  {isCurrent ? (
                    <button
                      type="button"
                      onClick={onManageBilling}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-700"
                    >
                      Manage Billing
                    </button>
                  ) : plan.monthlyPrice === 0 ? (
                    <button
                      type="button"
                      onClick={() => handleSelectPlan(plan.id)}
                      disabled={submittingPlan !== null}
                      className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {submittingPlan === plan.id ? 'Processing...' : 'Choose Free Plan'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSelectPlan(plan.id)}
                      disabled={submittingPlan !== null}
                      className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {submittingPlan === plan.id ? 'Processing...' : 'Upgrade'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
