import express from 'express';
import request from 'supertest';
import { createErrorHandler } from '../src/lib/errors';
import { requireCapacity } from '../src/middleware/capacity';
import { prisma } from '../src/lib/prisma';

type MockPrisma = {
  user: {
    findUnique: jest.Mock;
    count: jest.Mock;
  };
  location: {
    count: jest.Mock;
  };
};

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    location: {
      count: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as MockPrisma;

function buildApp(action: 'user' | 'location') {
  const app = express();

  app.use((req, _res, next) => {
    (req as any).user = { userId: 'team-1', adminId: null };
    next();
  });

  app.post(`/${action}`, requireCapacity(action), (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use(createErrorHandler());
  return app;
}

describe('capacity middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows free/trial teams to bypass capacity checks', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'team-1',
      subscriptionSource: null,
      currentPlan: null,
      maxUsers: null,
      maxLocations: null,
    });

    const app = buildApp('user');
    await request(app).post('/user').send({}).expect(200, { ok: true });
  });

  it('allows partner-managed teams to bypass capacity checks', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'team-1',
      subscriptionSource: 'partner',
      currentPlan: null,
      maxUsers: null,
      maxLocations: null,
    });

    const app = buildApp('user');
    await request(app).post('/user').send({}).expect(200, { ok: true });
  });

  it('allows stripe teams without a configured plan to bypass limits', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'team-1',
      subscriptionSource: 'stripe',
      currentPlan: null,
      maxUsers: null,
      maxLocations: null,
    });

    const app = buildApp('user');
    await request(app).post('/user').send({}).expect(200, { ok: true });
  });

  it('blocks user creation when a stripe solo team is at max users', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'team-1',
      subscriptionSource: 'stripe',
      currentPlan: 'starter',
      maxUsers: 1,
      maxLocations: 10,
    });
    mockedPrisma.user.count.mockResolvedValue(1);

    const app = buildApp('user');
    await request(app)
      .post('/user')
      .send({})
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toContain('USER_LIMIT_REACHED');
      });
  });

  it('allows location creation for a solo team when under the location cap', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'team-1',
      subscriptionSource: 'stripe',
      currentPlan: 'starter',
      maxUsers: 1,
      maxLocations: 10,
    });
    mockedPrisma.location.count.mockResolvedValue(9);

    const app = buildApp('location');
    await request(app).post('/location').send({}).expect(200, { ok: true });
  });

  it('blocks location creation for a solo team when the location cap is reached', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'team-1',
      subscriptionSource: 'stripe',
      currentPlan: 'solo',
      maxUsers: 1,
      maxLocations: 10,
    });
    mockedPrisma.location.count.mockResolvedValue(10);

    const app = buildApp('location');
    await request(app)
      .post('/location')
      .send({})
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toContain('LOCATION_LIMIT_REACHED');
      });
  });

  it('returns 404 when the team cannot be found', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);

    const app = buildApp('user');
    await request(app)
      .post('/user')
      .send({})
      .expect(404)
      .expect((res) => {
        expect(res.body.error).toContain('Team not found');
      });
  });
});
