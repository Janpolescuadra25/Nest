import express from 'express';
import request from 'supertest';
import { createErrorHandler } from '../src/lib/errors';
import { requireCapacity, checkStorageQuota } from '../src/middleware/capacity';
import { prisma } from '../src/lib/prisma';

type MockPrisma = {
  user: {
    findUnique: jest.Mock;
    count: jest.Mock;
  };
  location: {
    count: jest.Mock;
    findMany: jest.Mock;
  };
  attachment: {
    aggregate: jest.Mock;
    count: jest.Mock;
  };
  locationAttachment: {
    aggregate: jest.Mock;
    count: jest.Mock;
  };
  scanRecord: {
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
      findMany: jest.fn(),
    },
    attachment: {
      aggregate: jest.fn(),
      count: jest.fn(),
    },
    locationAttachment: {
      aggregate: jest.fn(),
      count: jest.fn(),
    },
    scanRecord: {
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

  describe('checkStorageQuota middleware', () => {
    function buildQuotaApp() {
      const app = express();
      app.use((req, _res, next) => {
        (req as any).user = { userId: 'member-1', adminId: null };
        next();
      });
      app.post('/upload', (req, _res, next) => {
        req.file = { buffer: Buffer.alloc(200 * 1024 * 1024) } as any;
        next();
      }, requireCapacity('scan'), checkStorageQuota, (_req, res) => {
        res.status(200).json({ ok: true });
      });
      app.use(createErrorHandler());
      return app;
    }

    it('allows upload when under quota', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({ id: 'member-1', maxStorageBytes: 1024 * 1024 * 1024 });
      mockedPrisma.location.findMany.mockResolvedValue([{ id: 'loc-1' }]);
      mockedPrisma.attachment.aggregate.mockResolvedValue({ _sum: { fileSize: 500 * 1024 * 1024 } });
      mockedPrisma.locationAttachment.aggregate.mockResolvedValue({ _sum: { fileSize: 0 } });
      mockedPrisma.scanRecord.count.mockResolvedValue(0);

      const app = buildQuotaApp();
      await request(app).post('/upload').send({}).expect(200, { ok: true });
    });

    it('blocks upload when over quota', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({ id: 'member-1', maxStorageBytes: 1024 * 1024 * 1024 });
      mockedPrisma.location.findMany.mockResolvedValue([{ id: 'loc-1' }]);
      mockedPrisma.attachment.aggregate.mockResolvedValue({ _sum: { fileSize: 900 * 1024 * 1024 } });
      mockedPrisma.locationAttachment.aggregate.mockResolvedValue({ _sum: { fileSize: 0 } });
      mockedPrisma.scanRecord.count.mockResolvedValue(0);

      const app = buildQuotaApp();
      await request(app)
        .post('/upload')
        .send({})
        .expect(403)
        .expect((res) => {
          expect(res.body.error).toContain('Storage quota exceeded');
        });
    });

    it('allows upload when unlimited', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({ id: 'member-1', maxStorageBytes: null });
      mockedPrisma.scanRecord.count.mockResolvedValue(0);

      const app = buildQuotaApp();
      await request(app).post('/upload').send({}).expect(200, { ok: true });
    });

    it('uses admin quota for a managed team member', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({ id: 'admin-1', maxStorageBytes: 1024 * 1024 * 1024 });
      mockedPrisma.location.findMany.mockResolvedValue([{ id: 'loc-1' }]);
      mockedPrisma.attachment.aggregate.mockResolvedValue({ _sum: { fileSize: 900 * 1024 * 1024 } });
      mockedPrisma.locationAttachment.aggregate.mockResolvedValue({ _sum: { fileSize: 0 } });
      mockedPrisma.scanRecord.count.mockResolvedValue(0);

      const app = express();
      app.use((req, _res, next) => {
        (req as any).user = { userId: 'member-1', adminId: 'admin-1' };
        next();
      });
      app.post('/upload', (req, _res, next) => {
        req.file = { buffer: Buffer.alloc(200 * 1024 * 1024) } as any;
        next();
      }, requireCapacity('scan'), checkStorageQuota, (_req, res) => {
        res.status(200).json({ ok: true });
      });
      app.use(createErrorHandler());

      await request(app).post('/upload').send({}).expect(403).expect((res) => {
        expect(res.body.error).toContain('Storage quota exceeded');
      });
    });
  });
});
