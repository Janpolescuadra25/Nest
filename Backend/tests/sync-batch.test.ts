/**
 * T-be-sync — Backend batch-sync regression tests
 * POST /quickbooks/sync-batch (quickbooks.ts L1476-1717)
 *
 * Mock strategy (6 modules):
 *   prisma (scanRecord, location, syncLog)
 *   qbService (callQB, createBill)
 *   dedup (hashSyncRequest, countSyncAttempts, findDuplicateSync, createSyncLogEntry)
 *   auth.middleware (authenticate, requireFeaturePermission, locationFilter)
 *   effective-role (enforceEffectiveRole)
 *   audit (logAction)
 */

import request from 'supertest';
import express from 'express';
import quickbooksRoute from '../src/routes/quickbooks';
import { createErrorHandler } from '../src/lib/errors';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    scanRecord: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ autoAttach: false }),
      update: jest.fn().mockResolvedValue({}),
    },
    location: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    syncLog: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  },
}));

jest.mock('../src/services/qb.service', () => ({
  qbService: {
    callQB: jest.fn().mockImplementation(async (_userId: string, callback: any) =>
      callback({ accessToken: 'fake-token', realmId: 'fake-realm' })
    ),
    createBill: jest.fn().mockResolvedValue({
      id: 'qb-bill-123',
      DocNumber: 'AB-001',
    }),
  },
}));

jest.mock('../src/lib/dedup', () => ({
  hashSyncRequest: jest.fn().mockReturnValue('hash-1'),
  countSyncAttempts: jest.fn().mockResolvedValue(0),
  findDuplicateSync: jest.fn().mockResolvedValue(null),
  createSyncLogEntry: jest.fn().mockResolvedValue({ id: 'log-1' }),
}));

jest.mock('../src/middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = {
      userId: 'user-1',
      role: 'OWNER',
      status: 'ACTIVE',
      blocked: false,
      timeBombAt: null,
      gracePeriodHours: 48,
      permissions: {},
    };
    next();
  }),
  enforceEffectiveRole: (_req: any, _res: any, next: any) => next(),
  requireFeaturePermission: () => (_req: any, _res: any, next: any) => next(),
  locationFilter: () => ({}),
}));

jest.mock('../src/middleware/effective-role', () => ({
  enforceEffectiveRole: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../src/middleware/audit', () => ({
  logAction: jest.fn().mockResolvedValue(undefined),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/quickbooks', quickbooksRoute);
  app.use(createErrorHandler());
  return app;
}

function makeBatchItem(overrides: Record<string, any> = {}) {
  return {
    scanRecordId: 'scan-1',
    transactionType: 'BILL',
    txnDate: '2024-01-15',
    lines: [{ Amount: 100, DetailType: 'AccountBasedExpenseLineDetail' }],
    memo: 'QB-visible memo',
    privateNote: 'Internal note',
    vendorRef: { value: 'vendor-1' },
    apAccountRef: { value: 'ap-1' },
    ...overrides,
  };
}

describe('POST /quickbooks/sync-batch', () => {
  let app: express.Application;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();

    const { authenticate } = require('../src/middleware/auth.middleware');
    authenticate.mockImplementation((req: any, _res: any, next: any) => {
      req.user = {
        userId: 'user-1',
        role: 'OWNER',
        status: 'ACTIVE',
        blocked: false,
        timeBombAt: null,
        gracePeriodHours: 48,
        permissions: {},
      };
      next();
    });

    const { prisma } = require('../src/lib/prisma');
    prisma.scanRecord.findMany.mockResolvedValue([
      {
        id: 'scan-1',
        locationId: 'loc-1',
        totalAmount: 100.0,
        status: 'PENDING',
        date: '2024-01-15',
        source: 'SQUARE',
      },
      {
        id: 'scan-2',
        locationId: 'loc-1',
        totalAmount: 200.0,
        status: 'PENDING',
        date: '2024-01-15',
        source: 'SQUARE',
      },
    ]);
    prisma.location.findMany.mockResolvedValue([
      { id: 'loc-1', qbLocationId: 'qb-loc-1', name: 'Main Location' },
    ]);
  });

  it('returns SYNCED status for a valid BILL item', async () => {
    const { qbService } = require('../src/services/qb.service');

    const res = await request(app)
      .post('/quickbooks/sync-batch')
      .send({ items: [makeBatchItem()] });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].status).toBe('SYNCED');
    expect(qbService.callQB).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(qbService.createBill).toHaveBeenCalledTimes(1);
  });

  it('syncs multiple items and returns results for each', async () => {
    const { qbService } = require('../src/services/qb.service');

    const res = await request(app)
      .post('/quickbooks/sync-batch')
      .send({
        items: [
          makeBatchItem({ scanRecordId: 'scan-1' }),
          makeBatchItem({
            scanRecordId: 'scan-2',
            vendorRef: { value: 'vendor-2' },
            memo: 'Second item',
          }),
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].status).toBe('SYNCED');
    expect(res.body.results[1].status).toBe('SYNCED');
    expect(qbService.createBill).toHaveBeenCalledTimes(2);
  });

  it('passes the correct userId to callQB', async () => {
    const { qbService } = require('../src/services/qb.service');

    await request(app)
      .post('/quickbooks/sync-batch')
      .send({ items: [makeBatchItem()] });

    expect(qbService.callQB).toHaveBeenCalledWith('user-1', expect.any(Function));
  });

  it('passes memo and privateNote to qbService.createBill', async () => {
    const { qbService } = require('../src/services/qb.service');

    await request(app)
      .post('/quickbooks/sync-batch')
      .send({
        items: [makeBatchItem({ memo: 'Invoice #42', privateNote: 'Internal ref X-7' })],
      });

    expect(qbService.createBill).toHaveBeenCalledWith(
      expect.objectContaining({
        memo: 'Invoice #42',
        privateNote: 'Internal ref X-7',
      }),
    );
  });

  it('returns 400 when items is an empty array', async () => {
    const res = await request(app)
      .post('/quickbooks/sync-batch')
      .send({ items: [] });

    expect(res.status).toBe(400);
  });

  it('returns FAILED status for an unsupported item type', async () => {
    const res = await request(app)
      .post('/quickbooks/sync-batch')
      .send({ items: [makeBatchItem({ transactionType: 'BILL_PAYMENT' })] });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].status).toBe('FAILED');
  });

  it('returns FAILED for non-admin user syncing non-APPROVED scan', async () => {
    const { authenticate } = require('../src/middleware/auth.middleware');
    const { qbService } = require('../src/services/qb.service');

    authenticate.mockImplementation((req: any, _res: any, next: any) => {
      req.user = {
        userId: 'user-2',
        role: 'TEAM_MEMBER',
        status: 'ACTIVE',
        blocked: false,
        timeBombAt: null,
        gracePeriodHours: 48,
        permissions: {},
      };
      next();
    });

    const res = await request(app)
      .post('/quickbooks/sync-batch')
      .send({ items: [makeBatchItem()] });

    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe('FAILED');
    expect(qbService.createBill).not.toHaveBeenCalled();
  });
});

