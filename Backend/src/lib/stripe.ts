import Stripe from 'stripe';

export const isStripeConfigured = !!process.env.STRIPE_SECRET_KEY;
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-05-27.dahlia',
    })
  : null;

if (!isStripeConfigured) {
  console.warn('[Stripe] STRIPE_SECRET_KEY not configured. Stripe features will be unavailable.');
}

export type PlanKey = 'free' | 'starter' | 'professional' | 'premium' | 'enterprise';
export type ScanPackKey = 'scan_pack_100' | 'scan_pack_250' | 'scan_pack_500';

export interface ScanPack {
  id: ScanPackKey;
  name: string;
  scans: number;
  price: number;
  stripePriceId: string | undefined;
  description: string;
}

export const PLANS: Record<PlanKey, {
  name: string;
  monthlyPrice: number;
  annualPrice: number; // per month, billed annually
  maxUsers: number;
  maxLocations: number;
  maxScans: number;
  maxTemplates: number;
  scanHistoryDays: number;
  maxStorageBytes: number;
  prioritySupport: boolean;
  monthlyPriceId: string | undefined;
  annualPriceId: string | undefined;
}> = {
  free: {
    name: 'Free',
    monthlyPrice: 0,
    annualPrice: 0,
    maxUsers: 1,
    maxLocations: 1,
    maxScans: 7,
    maxTemplates: 3,
    scanHistoryDays: 7,
    maxStorageBytes: 53687091200,
    prioritySupport: false,
    monthlyPriceId: undefined,
    annualPriceId: undefined,
  },
  starter: {
    name: 'Starter',
    monthlyPrice: 19,
    annualPrice: 15,
    maxUsers: 2,
    maxLocations: 5,
    maxScans: 50,
    maxTemplates: 10,
    scanHistoryDays: 30,
    maxStorageBytes: 53687091200,
    prioritySupport: false,
    monthlyPriceId: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,
    annualPriceId: process.env.STRIPE_STARTER_ANNUAL_PRICE_ID,
  },
  professional: {
    name: 'Professional',
    monthlyPrice: 39,
    annualPrice: 31,
    maxUsers: 5,
    maxLocations: 20,
    maxScans: 250,
    maxTemplates: 25,
    scanHistoryDays: 90,
    maxStorageBytes: 53687091200,
    prioritySupport: true,
    monthlyPriceId: process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID,
    annualPriceId: process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID,
  },
  premium: {
    name: 'Premium',
    monthlyPrice: 79,
    annualPrice: 63,
    maxUsers: 12,
    maxLocations: 75,
    maxScans: 1250,
    maxTemplates: 75,
    scanHistoryDays: 365,
    maxStorageBytes: 53687091200,
    prioritySupport: true,
    monthlyPriceId: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID,
    annualPriceId: process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID,
  },
  enterprise: {
    name: 'Enterprise',
    monthlyPrice: 149,
    annualPrice: 119,
    maxUsers: 20,
    maxLocations: 250,
    maxScans: 5000,
    maxTemplates: 200,
    scanHistoryDays: 730,
    maxStorageBytes: 53687091200,
    prioritySupport: true,
    monthlyPriceId: process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID,
    annualPriceId: process.env.STRIPE_ENTERPRISE_ANNUAL_PRICE_ID,
  },
};

// NOTE: Display prices updated to $19/$39/$69.
// JP needs to create NEW products in Stripe Dashboard with these prices
// and update STRIPE_SCAN_PACK_100/250/500_PRICE_ID env vars on Render.
// The current Stripe price IDs still point to $39/$89/$159 products.
const SCAN_PACKS: Record<ScanPackKey, Omit<ScanPack, 'id'>> = {
  scan_pack_100: {
    name: '100 Scan Pack',
    scans: 100,
    price: 19,
    stripePriceId: process.env.STRIPE_SCAN_PACK_100_PRICE_ID,
    description: 'One-time purchase for 100 bonus AI scans.',
  },
  scan_pack_250: {
    name: '250 Scan Pack',
    scans: 250,
    price: 39,
    stripePriceId: process.env.STRIPE_SCAN_PACK_250_PRICE_ID,
    description: 'One-time purchase for 250 bonus AI scans.',
  },
  scan_pack_500: {
    name: '500 Scan Pack',
    scans: 500,
    price: 69,
    stripePriceId: process.env.STRIPE_SCAN_PACK_500_PRICE_ID,
    description: 'One-time purchase for 500 bonus AI scans.',
  },
};

export function getScanPacks(): ScanPack[] {
  return Object.entries(SCAN_PACKS).map(([id, pack]) => ({ id: id as ScanPackKey, ...pack }));
}

export function getScanPack(scanPackId: string): ScanPack | undefined {
  return SCAN_PACKS[scanPackId as ScanPackKey] ? { id: scanPackId as ScanPackKey, ...SCAN_PACKS[scanPackId as ScanPackKey] } : undefined;
}

export function getPlanLimits(planKey: PlanKey) {
  const plan = PLANS[planKey];
  return {
    maxUsers: plan.maxUsers,
    maxLocations: plan.maxLocations,
    maxScans: plan.maxScans,
    maxTemplates: plan.maxTemplates,
    scanHistoryDays: plan.scanHistoryDays,
    maxStorageBytes: plan.maxStorageBytes,
  };
}
