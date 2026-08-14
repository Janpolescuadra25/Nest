import request from 'supertest';
import express from 'express';
import adminRoutes from '../src/routes/admin';
import inviteRoutes from '../src/routes/invite';
import { createErrorHandler } from '../src/lib/errors';
import { prisma } from '../src/lib/prisma';
import { logAction } from '../src/middleware/audit';
import { sendWelcomeEmail } from '../src/lib/email';

jest.mock('../src/lib/prisma', () => {
  const user = {
    findUnique: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  };
  const inviteLink = {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  };
  const emailVerificationToken = {
    deleteMany: jest.fn(),
    create: jest.fn(),
  };
  return {
    prisma: {
      user,
      inviteLink,
      emailVerificationToken,
      $transaction: jest.fn(),
    },
  };
});

jest.mock('../src/middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = {
      id: 'owner-id',
      userId: 'owner-id',
      email: 'owner@example.com',
      emailVerified: true,
      name: 'Owner',
      role: 'OWNER',
      status: 'ACTIVE',
      adminId: null,
      mustChangePassword: false,
      trialExpiresAt: null,
      maxUsers: null,
      permissions: {},
      timeBombAt: null,
      gracePeriodHours: 48,
      blocked: false,
      blockedById: null,
      maxScans: null,
      scanHistoryDays: null,
      approvedById: null,
      approvedAt: null,
      invitedById: null,
      transferredFromId: null,
    };
    next();
  }),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  AuthRequest: jest.requireActual('../src/middleware/auth.middleware').AuthRequest,
}));

jest.mock('../src/middleware/audit', () => ({
  logAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/lib/email', () => ({
  sendWelcomeEmail: jest.fn().mockResolvedValue({ success: true }),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  app.use('/api/invite', inviteRoutes);
  app.use(createErrorHandler());
  return app;
}

describe('Invite flow', () => {
  let app: express.Application;
  const mockedPrisma = prisma as unknown as {
    user: { findUnique: jest.Mock; create: jest.Mock; count: jest.Mock };
    inviteLink: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    emailVerificationToken: { deleteMany: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    mockedPrisma.$transaction.mockImplementation(async (work: any) => {
      if (Array.isArray(work)) {
        return Promise.all(work);
      }
      return work({
        user: mockedPrisma.user,
        inviteLink: mockedPrisma.inviteLink,
      });
    });
  });

  it('creates an owner invite with a storage limit', async () => {
    mockedPrisma.inviteLink.create.mockResolvedValueOnce({
      id: 'invite-1',
      token: 'plain-token',
      roleHint: 'ADMIN',
      expiresAt: new Date().toISOString(),
      maxUses: 1,
      maxStorageBytes: 5368709120,
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post('/api/admin/invite')
      .send({ roleHint: 'ADMIN', maxUses: 1, maxStorageBytes: 5368709120 });

    expect(res.status).toBe(201);
    expect(res.body.invite).toEqual(expect.objectContaining({
      id: 'invite-1',
      roleHint: 'ADMIN',
      maxUses: 1,
      maxStorageBytes: 5368709120,
    }));
    expect(mockedPrisma.inviteLink.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        roleHint: 'ADMIN',
        maxUses: 1,
        maxStorageBytes: 5368709120,
      }),
    }));
  });

  it('creates an owner invite without a storage limit', async () => {
    mockedPrisma.inviteLink.create.mockResolvedValueOnce({
      id: 'invite-2',
      token: 'plain-token-2',
      roleHint: 'ADMIN',
      expiresAt: new Date().toISOString(),
      maxUses: 1,
      maxStorageBytes: null,
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post('/api/admin/invite')
      .send({ roleHint: 'ADMIN', maxUses: 1 });

    expect(res.status).toBe(201);
    expect(res.body.invite).toEqual(expect.objectContaining({
      id: 'invite-2',
      roleHint: 'ADMIN',
      maxUses: 1,
      maxStorageBytes: null,
    }));
    expect(mockedPrisma.inviteLink.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        roleHint: 'ADMIN',
        maxUses: 1,
        maxStorageBytes: null,
      }),
    }));
  });

  it('rejects owner invite creation when roleHint is not ADMIN', async () => {
    const res = await request(app)
      .post('/api/admin/invite')
      .send({ roleHint: 'STAFF', maxUses: 1, maxStorageBytes: 1024 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Owners can only create admin invite links');
    expect(mockedPrisma.inviteLink.create).not.toHaveBeenCalled();
  });

  it('copies storage limit from invite into created user', async () => {
    mockedPrisma.inviteLink.findUnique.mockResolvedValueOnce({
      id: 'invite-3',
      token: 'hashed-token',
      createdBy: 'owner-id',
      roleHint: 'ADMIN',
      expiresAt: new Date(Date.now() + 10000),
      usedAt: null,
      maxUses: 10,
      useCount: 0,
      maxStorageBytes: 1073741824,
      creator: { id: 'owner-id', role: 'OWNER', status: 'ACTIVE', adminId: null },
    });
    mockedPrisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ subscriptionSource: null, currentPlan: null, maxUsers: null });
    mockedPrisma.user.create.mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com', role: 'ADMIN', maxStorageBytes: 1073741824 });
    mockedPrisma.inviteLink.update.mockResolvedValueOnce({});
    mockedPrisma.emailVerificationToken.deleteMany.mockResolvedValueOnce({});
    mockedPrisma.emailVerificationToken.create.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/api/invite/signup/sometoken')
      .send({ name: 'New User', email: 'user@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(mockedPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'user@example.com',
        role: 'ADMIN',
        maxStorageBytes: 1073741824,
      }),
    }));
  });

  it('copies null storage limit from invite into created user', async () => {
    mockedPrisma.inviteLink.findUnique.mockResolvedValueOnce({
      id: 'invite-4',
      token: 'hashed-token-2',
      createdBy: 'owner-id',
      roleHint: 'ADMIN',
      expiresAt: new Date(Date.now() + 10000),
      usedAt: null,
      maxUses: 10,
      useCount: 0,
      maxStorageBytes: null,
      creator: { id: 'owner-id', role: 'OWNER', status: 'ACTIVE', adminId: null },
    });
    mockedPrisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ subscriptionSource: null, currentPlan: null, maxUsers: null });
    mockedPrisma.user.create.mockResolvedValueOnce({ id: 'user-2', email: 'user2@example.com', role: 'ADMIN', maxStorageBytes: null });
    mockedPrisma.inviteLink.update.mockResolvedValueOnce({});
    mockedPrisma.emailVerificationToken.deleteMany.mockResolvedValueOnce({});
    mockedPrisma.emailVerificationToken.create.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/api/invite/signup/sometoken2')
      .send({ name: 'New User 2', email: 'user2@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(mockedPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'user2@example.com',
        role: 'ADMIN',
        maxStorageBytes: null,
      }),
    }));
  });
});
