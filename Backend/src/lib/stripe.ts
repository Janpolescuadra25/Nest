import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
});

export const PLANS = {
  solo: {
    name: 'Solo',
    pricePhp: 499,
    priceUsd: 9,
    priceId: process.env.STRIPE_SOLO_PRICE_ID,
    interval: 'month' as const,
    users: 1,
    locations: 10,
    features: ['1 user only', '10 locations', 'Unlimited syncs', 'Basic mappings', 'Email support'],
  },
  starter: {
    name: 'Starter',
    pricePhp: 1999,
    priceUsd: 35,
    priceId: process.env.STRIPE_STARTER_PRICE_ID,
    interval: 'month' as const,
    users: 5,
    locations: 30,
    features: ['Up to 5 users', '30 locations', 'Unlimited syncs', 'Basic permissions', 'Email support'],
  },
  growth: {
    name: 'Growth',
    pricePhp: 5999,
    priceUsd: 107,
    priceId: process.env.STRIPE_GROWTH_PRICE_ID,
    interval: 'month' as const,
    users: 20,
    locations: 100,
    features: ['Up to 20 users', '100 locations', 'Unlimited syncs', 'Full RBAC', 'Priority support', 'API access'],
  },
  enterprise: {
    name: 'Enterprise',
    pricePhp: 9999,
    priceUsd: 178,
    priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
    interval: 'month' as const,
    users: 50,
    locations: 500,
    features: ['Up to 50 users', '500 locations', 'Unlimited syncs', 'Full RBAC', 'Dedicated support', 'Full API access', 'Custom integrations'],
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export function getPlanLimits(planKey: PlanKey) {
  const plan = PLANS[planKey];
  return {
    maxUsers: plan.users,
    maxLocations: plan.locations,
  };
}

export function isSoloPlan(planKey: string): boolean {
  return planKey === 'solo';
}
