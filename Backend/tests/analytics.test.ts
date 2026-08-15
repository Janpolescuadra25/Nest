process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

import request from 'supertest';
import express from 'express';
import { createErrorHandler } from '../src/lib/errors';
import { prisma } from '../src/lib/prisma';
import analyticsRoutes from '../src/routes/analytics';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    scanRecord: {
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    mapping: {
      groupBy: jest.fn(),
    },
  },
}));

jest.mock('../src/middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', allocatedScans: 200 };
    next();
  }),
  requireFeaturePermission: () => (_req: any, _res: any, next: any) => next(),
  AuthRequest: jest.requireActual('../src/middleware/auth.middleware').AuthRequest,
}));

describe('Analytics dashboard API', () => {
  let app: express.Application;
  const mockedPrisma = prisma as unknown as {
    $queryRaw: jest.Mock;
    scanRecord: {
      groupBy: jest.Mock;
      count: jest.Mock;
    };
    mapping: {
      groupBy: jest.Mock;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/analytics', analyticsRoutes);
    app.use(createErrorHandler());
  });

  it('GET /api/analytics/dashboard returns 200 with correct shape', async () => {
    mockedPrisma.$queryRaw.mockResolvedValueOnce([
      { month: '2026-07', count: '12' },
      { month: '2026-08', count: '8' },
    ]);
    mockedPrisma.scanRecord.groupBy.mockResolvedValueOnce([
      { syncStatus: 'SYNCED', _count: { _all: 15 } },
      { syncStatus: 'FAILED', _count: { _all: 3 } },
      { syncStatus: 'PENDING', _count: { _all: 2 } },
    ]);
    mockedPrisma.mapping.groupBy.mockResolvedValueOnce([
      { targetAccount: 'Cash', postingType: 'ASSET', _count: { targetAccount: 10 } },
      { targetAccount: 'Expenses', postingType: 'EXPENSE', _count: { targetAccount: 5 } },
    ]);
    mockedPrisma.scanRecord.count.mockResolvedValueOnce(20);

    const response = await request(app).get('/api/analytics/dashboard');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      monthlyScanVolume: expect.any(Array),
      syncStatusBreakdown: expect.any(Object),
      topMappedAccounts: expect.any(Array),
      storageUsage: expect.any(Object),
    }));
    expect(response.body.monthlyScanVolume).toEqual([
      { month: '2026-07', count: 12 },
      { month: '2026-08', count: 8 },
    ]);
    expect(response.body.syncStatusBreakdown).toEqual({
      synced: 15,
      failed: 3,
      pending: 2,
    });
    expect(response.body.topMappedAccounts).toEqual([
      { accountName: 'Cash', accountType: 'ASSET', usageCount: 10 },
      { accountName: 'Expenses', accountType: 'EXPENSE', usageCount: 5 },
    ]);
    expect(response.body.storageUsage).toEqual({
      used: 20,
      total: 200,
      percentage: 10,
    });
  });

  it('GET /api/analytics/dashboard with dateFrom/dateTo returns 200', async () => {
    mockedPrisma.$queryRaw.mockResolvedValueOnce([
      { month: '2026-01', count: '5' },
      { month: '2026-08', count: '10' },
    ]);
    mockedPrisma.scanRecord.groupBy.mockResolvedValueOnce([
      { syncStatus: 'SYNCED', _count: { _all: 9 } },
      { syncStatus: 'FAILED', _count: { _all: 1 } },
      { syncStatus: 'PENDING', _count: { _all: 0 } },
    ]);
    mockedPrisma.mapping.groupBy.mockResolvedValueOnce([
      { targetAccount: 'Revenue', postingType: 'INCOME', _count: { targetAccount: 4 } },
    ]);
    mockedPrisma.scanRecord.count.mockResolvedValueOnce(10);

    const response = await request(app).get('/api/analytics/dashboard?dateFrom=2026-01-01&dateTo=2026-08-15');

    expect(response.status).toBe(200);
    expect(response.body.monthlyScanVolume).toEqual([
      { month: '2026-01', count: 5 },
      { month: '2026-08', count: 10 },
    ]);
    expect(response.body.syncStatusBreakdown).toEqual({
      synced: 9,
      failed: 1,
      pending: 0,
    });
    expect(response.body.topMappedAccounts[0]).toEqual({
      accountName: 'Revenue',
      accountType: 'INCOME',
      usageCount: 4,
    });
    expect(response.body.storageUsage).toEqual({
      used: 10,
      total: 200,
      percentage: 5,
    });
  });

  it('GET /api/analytics/dashboard rejects invalid query dates with validation error', async () => {
    const response = await request(app).get('/api/analytics/dashboard?dateFrom=&dateTo=not-a-date');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: expect.objectContaining({
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        fields: expect.objectContaining({
          dateFrom: expect.stringContaining('Too small'),
        }),
      }),
    });
  });
});
