import React, { useEffect, useState } from 'react';
import { api, type Plan, type UserInfo } from '../lib/api';

interface Props {
  jwt: string;
  user: UserInfo;
  onManageBilling: () => Promise<void>;
  onClose: () => void;
}

export default function PricingView({ jwt, user, onManageBilling, onClose }: Props) {
  if (user.subscriptionSource === 'owner') {
    return (
      <div className="text-center py-8">
        <p className="text-gray-400 text-sm">You have unlimited platform access.</p>
      </div>
    );
  }

  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingPlan, setSubmittingPlan] = useState<string | null>(null);

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
      const result = await api.createCheckoutSession(jwt, planId);
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setSubmittingPlan(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Choose a paid plan</h2>
          <p className="text-sm text-gray-400">Pick a plan and let Stripe manage billing, renewals, and payment updates.</p>
        </div>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-white">Back</button>
      </div>

      {error && <div className="rounded-lg bg-red-900/40 border border-red-700 p-3 text-sm text-red-200">{error}</div>}

      {loading ? (
        <div className="text-gray-400 text-sm">Loading plans…</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          {plans.map((plan) => {
            const isCurrent = user.subscriptionSource === 'stripe' && user.currentPlan === plan.id;
            return (
              <div
                key={plan.id}
                className={`rounded-3xl border p-5 shadow-sm ${plan.id === 'growth' ? 'border-cyan-500/40 bg-cyan-950/30' : 'border-gray-700 bg-gray-900'}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm uppercase tracking-[0.2em] text-gray-400">{plan.name}</div>
                    <div className="mt-3 text-3xl font-semibold text-white">₱{plan.pricePhp.toLocaleString()}</div>
                    <div className="text-xs text-gray-500 mt-1">per {plan.interval}</div>
                    <div className="text-xs text-gray-500 mt-1">(~${plan.priceUsd} USD)</div>
                  </div>
                  {plan.id === 'growth' && (
                    <div className="rounded-full bg-cyan-600 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white">Most Popular</div>
                  )}
                </div>

                {plan.id === 'solo' && (
                  <div className="mb-4 rounded-2xl bg-slate-800 px-3 py-2 text-xs uppercase tracking-[0.15em] text-cyan-300">Individual</div>
                )}

                <div className="space-y-3 mb-5">
                  <div className="text-sm text-gray-300">{plan.users} user{plan.users !== 1 ? 's' : ''} • {plan.locations} locations</div>
                  <div className="space-y-2">
                    {plan.features.map((feature) => (
                      <div key={feature} className="flex items-start gap-2 text-sm text-gray-300">
                        <span className="mt-0.5 text-cyan-300">✓</span>
                        <span>{feature}</span>
                      </div>
                    ))}
                    <div className="flex items-start gap-2 text-sm text-cyan-200">
                      <span className="mt-0.5">✓</span>
                      <span>Unlimited syncs</span>
                    </div>
                  </div>
                </div>

                {isCurrent && (
                  <div className="rounded-xl bg-emerald-900/20 border border-emerald-700 p-3 text-sm text-emerald-200 mb-3">Current Plan</div>
                )}

                <button
                  type="button"
                  disabled={isCurrent || submittingPlan !== null}
                  onClick={() => (isCurrent ? void 0 : handleSelectPlan(plan.id))}
                  className={`w-full rounded-lg px-4 py-2 text-sm font-semibold transition ${
                    isCurrent ? 'bg-gray-700 text-gray-300 cursor-not-allowed' : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                  }`}
                >
                  {isCurrent ? 'Current plan' : submittingPlan === plan.id ? 'Starting checkout…' : 'Choose plan'}
                </button>

                {isCurrent && (
                  <button
                    type="button"
                    onClick={onManageBilling}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 text-sm text-gray-200 hover:bg-gray-700 py-2 mt-3"
                  >
                    Manage Billing
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
