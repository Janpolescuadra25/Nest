import request from 'supertest';
import express from 'express';
import ownerRoutes from '../src/routes/owner';
import { createErrorHandler } from '../src/lib/errors';
import { prisma } from '../src/lib/prisma';
import { logAction } from '../src/middleware/audit';
import { deleteFile } from '../src/lib/storage';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    location: {
      findMany: jest.fn(),
    },
    attachment: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    scanRecord: {
      findMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

jest.mock('../src/middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = {
      userId: 'owner-id',
      role: 'OWNER',
      status: 'ACTIVE',
      blocked: false,
      timeBombAt: null,
      gracePeriodHours: 48,
      permissions: {},
    };
    next();
  }),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  AuthRequest: jest.requireActual('../src/middleware/auth.middleware').AuthRequest,
}));

jest.mock('../src/middleware/audit', () => ({
  logAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/lib/storage', () => ({
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/owner', ownerRoutes);
  app.use(createErrorHandler());
  return app;
}

describe('DELETE /api/owner/users/:id', () => {
  let app: express.Application;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it('deletes an admin user and cascades related data', async () => {
    const targetUser = { id: 'admin-id', email: 'admin@example.com', role: 'ADMIN' };

    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(targetUser);
    (prisma.location.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 'loc-1',
        scanRecords: [
          { id: 'scan-1', attachments: [{ storageKey: 'attach-1' }] },
        ],
        attachments: [{ storageKey: 'loc-attach-1' }],
      },
    ]);
    (prisma.user.delete as jest.Mock).mockResolvedValueOnce({});

    const res = await request(app).delete('/api/owner/users/admin-id');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'User deleted permanently' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'admin-id' },
      select: { id: true, email: true, role: true, agreementDocUrl: true },
    });
    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(deleteFile).toHaveBeenCalledWith('attach-1');
    expect(deleteFile).toHaveBeenCalledWith('loc-attach-1');
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'admin-id' } });
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'owner-id',
      action: 'USER_DELETED',
      targetUserId: 'admin-id',
      details: {
        deletedUserEmail: 'admin@example.com',
        deletedUserRole: 'ADMIN',
      },
    }));
  });

  it('blocks self-deletion', async () => {
    const res = await request(app).delete('/api/owner/users/owner-id');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot delete your own account');
  });

  it('blocks deleting another owner account', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'owner-2', email: 'other@example.com', role: 'OWNER', agreementDocUrl: null });

    const res = await request(app).delete('/api/owner/users/owner-2');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot delete an owner account');
  });

  it('returns 404 when user not found', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const res = await request(app).delete('/api/owner/users/nonexistent_id');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('User not found');
  });

  it('deletes storage attachments using Promise.allSettled', async () => {
    const targetUser = { id: 'admin-id', email: 'admin@example.com', role: 'ADMIN' };

    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(targetUser);
    (prisma.location.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 'loc-1',
        scanRecords: [
          { id: 'scan-1', attachments: [{ storageKey: 'attach-1' }, { storageKey: 'attach-2' }] },
        ],
        attachments: [{ storageKey: 'loc-attach-1' }],
      },
      {
        id: 'loc-2',
        scanRecords: [],
        attachments: [{ storageKey: 'loc-attach-2' }],
      },
    ]);
    (prisma.user.delete as jest.Mock).mockResolvedValueOnce({});

    const res = await request(app).delete('/api/owner/users/admin-id');

    expect(res.status).toBe(200);
    expect(deleteFile).toHaveBeenCalledTimes(4);
    expect(deleteFile).toHaveBeenCalledWith('attach-1');
    expect(deleteFile).toHaveBeenCalledWith('attach-2');
    expect(deleteFile).toHaveBeenCalledWith('loc-attach-1');
    expect(deleteFile).toHaveBeenCalledWith('loc-attach-2');
  });
});
