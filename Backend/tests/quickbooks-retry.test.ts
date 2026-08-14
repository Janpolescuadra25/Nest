/**
 * Backend retry endpoint tests
 * POST /quickbooks/retry/:scanRecordId
 */

import request from 'supertest';
import express from 'express';
import { createErrorHandler } from '../src/lib/errors';

jest.mock('../src/middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => next()),
  enforceEffectiveRole: jest.fn((req: any, _res: any, next: any) => next()),
  requireFeaturePermission: () => (_req: any, _res: any, next: any) => next(),
  locationFilter: () => ({}),
}));

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    scanRecord: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    location: {
      findFirst: jest.fn(),
    },
    syncLog: {
      count: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../src/services/qb.service', () => ({
  qbService: {
    callQB: jest.fn(),
    createBill: jest.fn(),
  },
}));

jest.mock('../src/lib/dedup', () => ({
  hashSyncRequest: jest.fn(),
  countSyncAttempts: jest.fn(),
  findDuplicateSync: jest.fn(),
  createSyncLogEntry: jest.fn(),
}));

import quickbooksRoute from '../src/routes/quickbooks';

describe('POST /quickbooks/retry/:scanRecordId', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/quickbooks', quickbooksRoute);
    app.use(createErrorHandler());

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
    prisma.scanRecord.findUnique.mockResolvedValue({ id: 'scan-1', status: 'FAILED', locationId: 'loc-1' });
    prisma.location.findFirst.mockResolvedValue({ id: 'loc-1' });
    const latestLog = {
      syncType: 'BILL',
      requestPayload: {
        txnDate: '2024-01-15',
        vendorRef: { value: 'vendor-1' },
        apAccountRef: { value: 'ap-1' },
        termsRef: { value: 'terms-1' },
        dueDate: '2024-01-20',
        memo: 'Memo',
        privateNote: 'Note',
        lines: [{ Amount: 100, DetailType: 'AccountBasedExpenseLineDetail' }],
        docNumber: 'Q-001',
      },
    };
    prisma.syncLog.findFirst.mockImplementation(async (args: any) => {
      if (args?.orderBy) return latestLog;
      return null;
    });
    prisma.syncLog.count.mockResolvedValue(1);
    prisma.scanRecord.update.mockResolvedValue({});

    const { qbService } = require('../src/services/qb.service');
    qbService.callQB.mockImplementation(async (_userId: string, callback: any) => callback({ accessToken: 'fake-token', realmId: 'fake-realm' }));
    qbService.createBill.mockResolvedValue({
      id: 'qb-bill-123',
      txnDate: '2024-01-15',
      totalAmount: 100,
      syncToken: 'sync-1',
    });

    const { createSyncLogEntry } = require('../src/lib/dedup');
    createSyncLogEntry.mockResolvedValue({ id: 'log-1' });
  });

  it('retries a failed bill sync and returns success', async () => {
    const res = await request(app)
      .post('/quickbooks/retry/scan-1')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.attemptCount).toBe(2);
    expect(res.body.qbJournalEntryId).toBe('qb-bill-123');
    expect(res.body.docNumber).toBe('Q-001');
  });

  it('returns 409 when the scan is not failed', async () => {
    const { prisma } = require('../src/lib/prisma');
    prisma.scanRecord.findUnique.mockResolvedValue({ id: 'scan-1', status: 'SYNCED', locationId: 'loc-1' });

    const res = await request(app)
      .post('/quickbooks/retry/scan-1')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Only failed scans can be retried');
  });
});
