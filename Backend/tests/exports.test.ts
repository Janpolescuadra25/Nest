process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

import request from 'supertest';
import express from 'express';
import { createErrorHandler } from '../src/lib/errors';
import { prisma } from '../src/lib/prisma';
import { exportRoutes } from '../src/routes/exports';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    scanRecord: { findMany: jest.fn() },
    syncLog: { findMany: jest.fn() },
    auditLog: { findMany: jest.fn() },
  },
}));

jest.mock('../src/middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1' };
    next();
  }),
  AuthRequest: jest.requireActual('../src/middleware/auth.middleware').AuthRequest,
}));

describe('Export API', () => {
  let app: express.Application;
  const mockedPrisma = prisma as unknown as {
    scanRecord: { findMany: jest.Mock };
    syncLog: { findMany: jest.Mock };
    auditLog: { findMany: jest.Mock };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/exports', exportRoutes);
    app.use(createErrorHandler());
  });

  it('GET /api/exports/scans returns 200 with CSV content-type and attachment header', async () => {
    mockedPrisma.scanRecord.findMany.mockResolvedValueOnce([
      {
        id: 'scan-1',
        scanDate: new Date('2026-08-01'),
        status: 'COMPLETED',
        syncStatus: 'SYNCED',
        source: 'pos',
        transactionType: 'Sale',
        createdAt: new Date('2026-08-01'),
      },
    ]);

    const response = await request(app).get('/api/exports/scans');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.text).toContain('scan-1');
  });

  it('GET /api/exports/sync-logs returns 200 with CSV content-type', async () => {
    mockedPrisma.syncLog.findMany.mockResolvedValueOnce([
      {
        id: 'sync-1',
        syncType: 'FULL',
        status: 'SUCCESS',
        syncedAt: new Date('2026-08-01'),
        docNumber: 'DOC123',
        errorMessage: null,
        attemptCount: 1,
      },
    ]);

    const response = await request(app).get('/api/exports/sync-logs');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.text).toContain('sync-1');
  });

  it('GET /api/exports/audit-logs returns 200 with CSV content-type', async () => {
    mockedPrisma.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'audit-1',
        actor: { email: 'user@example.com', name: 'User' },
        action: 'LOGIN',
        targetUser: { email: 'target@example.com', name: 'Target' },
        createdAt: new Date('2026-08-01'),
        ip: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      },
    ]);

    const response = await request(app).get('/api/exports/audit-logs');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.text).toContain('audit-1');
  });
});
