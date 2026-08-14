import { PLANS, getPlanLimits, type PlanKey } from '../src/lib/stripe';

describe('Stripe plan utilities', () => {
  const allTiers: PlanKey[] = ['free', 'starter', 'professional', 'premium', 'enterprise'];

  it('has all 5 expected plan tiers', () => {
    for (const key of allTiers) {
      expect(PLANS[key]).toBeDefined();
      expect(PLANS[key].name).toBeTruthy();
    }
  });

  it('exposes the correct numeric limits for each tier', () => {
    expect(getPlanLimits('free')).toEqual({
      maxUsers: 1, maxLocations: 1, maxScans: 7,
      maxTemplates: 3, scanHistoryDays: 7, maxStorageBytes: 53687091200,
    });
    expect(getPlanLimits('starter')).toEqual({
      maxUsers: 2, maxLocations: 5, maxScans: 50,
      maxTemplates: 10, scanHistoryDays: 30, maxStorageBytes: 53687091200,
    });
    expect(getPlanLimits('professional')).toEqual({
      maxUsers: 5, maxLocations: 20, maxScans: 250,
      maxTemplates: 25, scanHistoryDays: 90, maxStorageBytes: 53687091200,
    });
    expect(getPlanLimits('premium')).toEqual({
      maxUsers: 12, maxLocations: 75, maxScans: 1250,
      maxTemplates: 75, scanHistoryDays: 365, maxStorageBytes: 53687091200,
    });
    expect(getPlanLimits('enterprise')).toEqual({
      maxUsers: 20, maxLocations: 250, maxScans: 5000,
      maxTemplates: 200, scanHistoryDays: 730, maxStorageBytes: 53687091200,
    });
  });

  it('stores monthly and annual pricing on each tier', () => {
    expect(PLANS.free.monthlyPrice).toBe(0);
    expect(PLANS.free.annualPrice).toBe(0);
    expect(PLANS.starter.monthlyPrice).toBe(19);
    expect(PLANS.starter.annualPrice).toBe(15);
    expect(PLANS.professional.monthlyPrice).toBe(39);
    expect(PLANS.professional.annualPrice).toBe(31);
    expect(PLANS.premium.monthlyPrice).toBe(79);
    expect(PLANS.premium.annualPrice).toBe(63);
    expect(PLANS.enterprise.monthlyPrice).toBe(149);
    expect(PLANS.enterprise.annualPrice).toBe(119);
  });

  it('marks only professional+ as priority support', () => {
    expect(PLANS.free.prioritySupport).toBe(false);
    expect(PLANS.starter.prioritySupport).toBe(false);
    expect(PLANS.professional.prioritySupport).toBe(true);
    expect(PLANS.premium.prioritySupport).toBe(true);
    expect(PLANS.enterprise.prioritySupport).toBe(true);
  });
});
