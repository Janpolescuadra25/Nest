import { ZodError } from 'zod';
import {
  getGracePeriodEnd,
  buildUserForAccess,
  processTrialExpiry,
  processTrialWarnings,
  processTimeBombTransitions,
} from '../src/lib/team-status';
import { PrismaClient } from '@prisma/client';

jest.mock('../src/lib/email', () => ({
  __esModule: true,
  sendTrialExpired: jest.fn().mockResolvedValue({ success: true }),
  sendTrialWarning: jest.fn().mockResolvedValue({ success: true }),
}));

const mockSendTrialExpired = jest.requireMock('../src/lib/email').sendTrialExpired as jest.Mock;
const mockSendTrialWarning = jest.requireMock('../src/lib/email').sendTrialWarning as jest.Mock;

describe('team-status lib', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calculates grace period end correctly', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = getGracePeriodEnd(start, 24);
    expect(end.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('builds a user for access correctly', () => {
    const user = {
      role: 'ADMIN' as const,
      status: 'ACTIVE' as const,
      blocked: false,
      timeBombAt: new Date('2026-01-01T00:00:00Z'),
      gracePeriodHours: 24,
      permissions: { canScan: true },
    };
    expect(buildUserForAccess(user)).toEqual(user);
  });

  it('returns zero when no trial expiry users exist', async () => {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      auditLog: { create: jest.fn() },
    } as unknown as PrismaClient;

    const result = await processTrialExpiry(prisma);
    expect(result).toBe(0);
    expect(prisma.user.findMany).toHaveBeenCalled();
  });

  it('processes expired trial users and returns the count', async () => {
    const expiredUsers = [
      {
        id: '1',
        email: 'user@example.com',
        name: 'User',
        trialExpiresAt: new Date('2025-12-30T00:00:00Z'),
        role: 'ADMIN' as const,
        customExpiryMessage: 'Expired',
      },
    ];

    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue(expiredUsers),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaClient;

    const count = await processTrialExpiry(prisma);
    expect(count).toBe(1);
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'EXPIRED' }),
    }));
    expect(mockSendTrialExpired).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
    }));
  });

  it('sends trial warnings for users within threshold', async () => {
    const users = [
      {
        id: '1',
        email: 'user@example.com',
        name: 'User',
        trialExpiresAt: new Date('2026-01-08T00:00:00Z'),
        customExpiryMessage: 'Please renew',
      },
    ];

    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue(users) },
      auditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient;

    const count = await processTrialWarnings(prisma);
    expect(count).toBe(1);
    expect(mockSendTrialWarning).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
    }));
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('transitions active users to grace period and fully expired users', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const timeBombAt = new Date('2025-12-31T00:00:00Z');

    const user = {
      id: '1',
      email: 'user@example.com',
      name: 'User',
      timeBombAt,
      role: 'ADMIN' as const,
      gracePeriodHours: 24,
      blocked: false,
    };

    const prisma = {
      user: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([user])
          .mockResolvedValueOnce([user]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    const result = await processTimeBombTransitions(prisma);
    expect(result).toEqual({ gracePeriodCount: 1, fullyExpiredCount: 1 });
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});
