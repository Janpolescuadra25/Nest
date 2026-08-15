process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

import request from 'supertest';
import express from 'express';
import { createErrorHandler } from '../src/lib/errors';
import { prisma } from '../src/lib/prisma';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    notificationPreference: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock('../src/middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  }),
  AuthRequest: jest.requireActual('../src/middleware/auth.middleware').AuthRequest,
}));

const notificationRoutes = require('../src/routes/notifications').default;

describe('Notification preferences API', () => {
  let app: express.Application;
  const mockedPrisma = prisma as unknown as {
    notificationPreference: {
      findUnique: jest.Mock;
      create: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/notifications', notificationRoutes);
    app.use(createErrorHandler());
  });

  it('returns default preferences when none exist', async () => {
    mockedPrisma.notificationPreference.findUnique.mockResolvedValue(null);
    mockedPrisma.notificationPreference.create.mockResolvedValue({
      syncFailureAlerts: true,
      quotaWarningAlerts: true,
      teamChangeAlerts: true,
    });

    const res = await request(app).get('/api/notifications/preferences');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      syncFailureAlerts: true,
      quotaWarningAlerts: true,
      teamChangeAlerts: true,
    });
    expect(mockedPrisma.notificationPreference.create).toHaveBeenCalledWith({ data: { userId: 'user-1' } });
  });

  it('updates notification preferences partially', async () => {
    mockedPrisma.notificationPreference.upsert.mockResolvedValue({
      syncFailureAlerts: false,
      quotaWarningAlerts: true,
      teamChangeAlerts: true,
    });

    const res = await request(app)
      .put('/api/notifications/preferences')
      .send({ syncFailureAlerts: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      syncFailureAlerts: false,
      quotaWarningAlerts: true,
      teamChangeAlerts: true,
    });
    expect(mockedPrisma.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      update: { syncFailureAlerts: false },
      create: {
        userId: 'user-1',
        syncFailureAlerts: false,
        quotaWarningAlerts: true,
        teamChangeAlerts: true,
      },
    }));
  });
});
