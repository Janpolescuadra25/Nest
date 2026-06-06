import { PLANS, getPlanLimits, isSoloPlan } from '../src/lib/stripe';

describe('Stripe plan utilities', () => {
  it('returns the correct limits for all plans', () => {
    expect(getPlanLimits('solo')).toEqual({ maxUsers: 1, maxLocations: 10 });
    expect(getPlanLimits('starter')).toEqual({ maxUsers: 5, maxLocations: 30 });
    expect(getPlanLimits('growth')).toEqual({ maxUsers: 20, maxLocations: 100 });
    expect(getPlanLimits('enterprise')).toEqual({ maxUsers: 50, maxLocations: 500 });
  });

  it('does not expose sync limits because syncs are unlimited', () => {
    const limits = getPlanLimits('starter') as Record<string, unknown>;
    expect(limits.maxUsers).toBe(5);
    expect(limits.maxLocations).toBe(30);
    expect(limits.maxSyncsPerMonth).toBeUndefined();
  });

  it('correctly identifies the solo plan only for solo', () => {
    expect(isSoloPlan('solo')).toBe(true);
    expect(isSoloPlan('starter')).toBe(false);
    expect(isSoloPlan('growth')).toBe(false);
    expect(isSoloPlan('enterprise')).toBe(false);
    expect(isSoloPlan('random-plan')).toBe(false);
  });

  it('contains all 4 locked Stripe plans with the expected metadata', () => {
    expect(PLANS).toHaveProperty('solo');
    expect(PLANS).toHaveProperty('starter');
    expect(PLANS).toHaveProperty('growth');
    expect(PLANS).toHaveProperty('enterprise');

    expect(PLANS.solo.pricePhp).toBe(499);
    expect(PLANS.solo.priceUsd).toBe(9);
    expect(PLANS.solo.users).toBe(1);
    expect(PLANS.solo.locations).toBe(10);
    expect(PLANS.solo.features).toContain('Unlimited syncs');

    expect(PLANS.starter.pricePhp).toBe(1999);
    expect(PLANS.starter.priceUsd).toBe(35);
    expect(PLANS.starter.users).toBe(5);
    expect(PLANS.starter.locations).toBe(30);
    expect(PLANS.starter.features).toContain('Unlimited syncs');

    expect(PLANS.growth.pricePhp).toBe(5999);
    expect(PLANS.growth.priceUsd).toBe(107);
    expect(PLANS.growth.users).toBe(20);
    expect(PLANS.growth.locations).toBe(100);
    expect(PLANS.growth.features).toContain('Unlimited syncs');

    expect(PLANS.enterprise.pricePhp).toBe(9999);
    expect(PLANS.enterprise.priceUsd).toBe(178);
    expect(PLANS.enterprise.users).toBe(50);
    expect(PLANS.enterprise.locations).toBe(500);
    expect(PLANS.enterprise.features).toContain('Unlimited syncs');
  });
});
