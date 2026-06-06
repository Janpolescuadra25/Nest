"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const team_status_1 = require("../src/lib/team-status");
jest.mock('../src/lib/email', () => ({
    sendTrialExpired: jest.fn(),
    sendTrialWarning: jest.fn(),
}));
const mockSendTrialExpired = jest.requireMock('../src/lib/email').sendTrialExpired;
const mockSendTrialWarning = jest.requireMock('../src/lib/email').sendTrialWarning;
describe('team-status lib', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });
    afterEach(() => {
        jest.useRealTimers();
    });
    it('calculates grace period end correctly', () => {
        const start = new Date('2026-01-01T00:00:00Z');
        const end = (0, team_status_1.getGracePeriodEnd)(start, 24);
        expect(end.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    });
    it('builds a user for access correctly', () => {
        const user = {
            role: 'ADMIN',
            status: 'ACTIVE',
            blocked: false,
            timeBombAt: new Date('2026-01-01T00:00:00Z'),
            gracePeriodHours: 24,
            permissions: { canScan: true },
        };
        expect((0, team_status_1.buildUserForAccess)(user)).toEqual(user);
    });
    it('returns zero when no trial expiry users exist', async () => {
        const prisma = {
            user: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
            auditLog: { create: jest.fn() },
        };
        const result = await (0, team_status_1.processTrialExpiry)(prisma);
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
                role: 'ADMIN',
                customExpiryMessage: 'Expired',
            },
        ];
        const prisma = {
            user: {
                findMany: jest.fn().mockResolvedValue(expiredUsers),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        const count = await (0, team_status_1.processTrialExpiry)(prisma);
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
        };
        const count = await (0, team_status_1.processTrialWarnings)(prisma);
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
            role: 'ADMIN',
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
        };
        const result = await (0, team_status_1.processTimeBombTransitions)(prisma);
        expect(result).toEqual({ gracePeriodCount: 1, fullyExpiredCount: 1 });
        expect(prisma.user.updateMany).toHaveBeenCalledTimes(2);
        expect(prisma.auditLog.create).toHaveBeenCalled();
    });
});
//# sourceMappingURL=team-status.test.js.map