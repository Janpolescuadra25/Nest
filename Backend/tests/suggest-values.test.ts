process.env.QB_CLIENT_ID = process.env.QB_CLIENT_ID ?? 'test-qb-client-id';
process.env.QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET ?? 'test-qb-client-secret';

import express from 'express';
import request from 'supertest';
import { createErrorHandler } from '../src/lib/errors';

jest.mock('../src/middleware/auth.middleware', () => ({
  authenticate: (req: any, res: any, next: any) => next(),
  requireFeaturePermission: (resource: string, action: string) => (req: any, res: any, next: any) => next(),
  locationFilter: (user: any) => ({}),
}));

jest.mock('../src/middleware/effective-role', () => ({
  enforceEffectiveRole: (req: any, res: any, next: any) => next(),
}));

jest.mock('../src/lib/prisma', () => {
  const __prismaMocks = {
    template: {
      findFirst: jest.fn(),
    },
  };
  return {
    __prismaMocks,
    prisma: __prismaMocks,
  };
});

const { prisma } = jest.requireMock('../src/lib/prisma') as any;

type ErrorResponse = {
  error: string;
};

function buildApp() {
  const mappingsRouter = require('../src/routes/mappings').default;
  const app = express();
  app.use(express.json());
  app.use('/api/mappings', mappingsRouter);
  app.use(createErrorHandler());
  return app;
}

describe('POST /api/mappings/suggest-values', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.template.findFirst.mockResolvedValue({ id: 'template-1', transactionType: 'BILL' });
  });

  it('returns 400 if templateId is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/mappings/suggest-values')
      .send({ valueCategories: [{ sourceField: 'vendorRef', fieldType: 'name', scannedValues: ['Acme'] }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('templateId is required');
  });

  it('returns 400 if valueCategories is empty', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/mappings/suggest-values')
      .send({ templateId: 'template-1', valueCategories: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('valueCategories must be a non-empty array');
  });

  it('returns 400 if valueCategories is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/mappings/suggest-values')
      .send({ templateId: 'template-1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('valueCategories must be a non-empty array');
  });

  it('returns 400 if a valueCategory has empty scannedValues', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/mappings/suggest-values')
      .send({
        templateId: 'template-1',
        valueCategories: [{ sourceField: 'vendorRef', fieldType: 'name', scannedValues: [] }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Each valueCategory must have a non-empty scannedValues array');
  });

  it('returns 400 if a valueCategory has missing fieldType', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/mappings/suggest-values')
      .send({
        templateId: 'template-1',
        valueCategories: [{ sourceField: 'vendorRef', scannedValues: ['Acme'] }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Each valueCategory must have a valid fieldType');
  });

  it('returns 404 if template does not exist', async () => {
    prisma.template.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/api/mappings/suggest-values')
      .send({
        templateId: 'missing-template',
        valueCategories: [{ sourceField: 'vendorRef', fieldType: 'name', scannedValues: ['Acme'] }],
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Template not found');
  });
});
