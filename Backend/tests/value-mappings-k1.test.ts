import express from 'express';
import request from 'supertest';
import valueMappingRoutes from '../src/routes/value-mappings';
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
    valueMapping: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  return {
    __prismaMocks,
    prisma: __prismaMocks,
  };
});

const { prisma } = jest.requireMock('../src/lib/prisma') as any;

type MappingResponse = {
  id: string;
  templateId: string;
  fieldType: string;
  scannedText: string;
  sourceField: string | null;
  entityId: string;
  matchingRule: unknown;
  createdAt: string;
  updatedAt: string;
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/value-mappings', valueMappingRoutes);
  app.use(createErrorHandler());
  return app;
}

describe('Value mappings K-1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.template.findFirst.mockResolvedValue({ id: 'template-1' });
  });

  it('creates a mapping with sourceField payee', async () => {
    prisma.valueMapping.findFirst.mockResolvedValue(null);
    prisma.valueMapping.create.mockResolvedValue({
      id: 'vm-1',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: 'payee',
      entityId: 'entity-1',
      matchingRule: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    });

    const app = buildApp();
    const res = await request(app).post('/api/value-mappings').send({
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: 'payee',
      entityId: 'entity-1',
    });

    expect(res.status).toBe(201);
    expect(res.body.sourceField).toBe('payee');
  });

  it('normalizes empty string sourceField to null on create', async () => {
    prisma.valueMapping.findFirst.mockResolvedValue(null);
    prisma.valueMapping.create.mockResolvedValue({
      id: 'vm-2',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: null,
      entityId: 'entity-1',
      matchingRule: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    });

    const app = buildApp();
    const res = await request(app).post('/api/value-mappings').send({
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: '',
      entityId: 'entity-1',
    });

    expect(res.status).toBe(201);
    expect(res.body.sourceField).toBe(null);
    expect(prisma.valueMapping.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceField: null }),
    }));
  });

  it('returns 409 when a duplicate create exists with the same sourceField', async () => {
    prisma.valueMapping.findFirst.mockResolvedValue({ id: 'vm-dup' });

    const app = buildApp();
    const res = await request(app).post('/api/value-mappings').send({
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: 'payee',
      entityId: 'entity-1',
    });

    expect(res.status).toBe(409);
    expect(prisma.valueMapping.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        templateId: 'template-1',
        fieldType: 'name',
        sourceField: 'payee',
        scannedText: 'Acme',
      },
    }));
  });

  it('returns 400 when POST sourceField is numeric', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/value-mappings').send({
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: 123,
      entityId: 'entity-1',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('sourceField must be a string, null, or omitted');
  });

  it('creates a mapping with explicit null sourceField', async () => {
    prisma.valueMapping.findFirst.mockResolvedValue(null);
    prisma.valueMapping.create.mockResolvedValue({
      id: 'vm-2-null',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: null,
      entityId: 'entity-1',
      matchingRule: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    });

    const app = buildApp();
    const res = await request(app).post('/api/value-mappings').send({
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: null,
      entityId: 'entity-1',
    });

    expect(res.status).toBe(201);
    expect(res.body.sourceField).toBe(null);
  });

  it('allows mappings with same other keys but different sourceField', async () => {
    const createBody = {
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      entityId: 'entity-1',
    };

    prisma.valueMapping.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.valueMapping.create
      .mockResolvedValueOnce({
        id: 'vm-3-null',
        templateId: 'template-1',
        fieldType: 'name',
        scannedText: 'Acme',
        sourceField: null,
        entityId: 'entity-1',
        matchingRule: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      })
      .mockResolvedValueOnce({
        id: 'vm-3-payee',
        templateId: 'template-1',
        fieldType: 'name',
        scannedText: 'Acme',
        sourceField: 'payee',
        entityId: 'entity-1',
        matchingRule: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      });

    const app = buildApp();
    const resNull = await request(app).post('/api/value-mappings').send({
      ...createBody,
      sourceField: null,
    });
    const resPayee = await request(app).post('/api/value-mappings').send({
      ...createBody,
      sourceField: 'payee',
    });

    expect(resNull.status).toBe(201);
    expect(resPayee.status).toBe(201);
  });

  it('updates sourceField on PUT', async () => {
    prisma.valueMapping.findUnique.mockResolvedValue({
      id: 'vm-4',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: null,
      entityId: 'entity-1',
      matchingRule: null,
    });
    prisma.valueMapping.findFirst.mockResolvedValue(null);
    prisma.valueMapping.update.mockResolvedValue({
      id: 'vm-4',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: 'amount',
      entityId: 'entity-1',
      matchingRule: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    });

    const app = buildApp();
    const res = await request(app).put('/api/value-mappings/vm-4').send({ sourceField: 'amount' });

    expect(res.status).toBe(200);
    expect(res.body.sourceField).toBe('amount');
  });

  it('keeps sourceField unchanged when omitted on PUT', async () => {
    prisma.valueMapping.findUnique.mockResolvedValue({
      id: 'vm-5',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: 'payee',
      entityId: 'entity-1',
      matchingRule: null,
    });
    prisma.valueMapping.findFirst.mockResolvedValue(null);
    prisma.valueMapping.update.mockResolvedValue({
      id: 'vm-5',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: 'payee',
      entityId: 'entity-1',
      matchingRule: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    });

    const app = buildApp();
    const res = await request(app).put('/api/value-mappings/vm-5').send({ entityId: 'entity-1' });

    expect(res.status).toBe(200);
    expect(res.body.sourceField).toBe('payee');

    const updateCall = prisma.valueMapping.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'vm-5' });
    expect(updateCall.data).not.toHaveProperty('sourceField');
  });

  it('clears sourceField to null on PUT', async () => {
    prisma.valueMapping.findUnique.mockResolvedValue({
      id: 'vm-6',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: 'payee',
      entityId: 'entity-1',
      matchingRule: null,
    });
    prisma.valueMapping.findFirst.mockResolvedValue(null);
    prisma.valueMapping.update.mockResolvedValue({
      id: 'vm-6',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: null,
      entityId: 'entity-1',
      matchingRule: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    });

    const app = buildApp();
    const res = await request(app).put('/api/value-mappings/vm-6').send({ sourceField: null });

    expect(res.status).toBe(200);
    expect(res.body.sourceField).toBe(null);
    expect(prisma.valueMapping.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'vm-6' },
      data: expect.objectContaining({ sourceField: null }),
    }));
  });

  it('does not return 409 when updating self with same values', async () => {
    prisma.valueMapping.findUnique.mockResolvedValue({
      id: 'vm-7',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: 'payee',
      entityId: 'entity-1',
      matchingRule: null,
    });
    prisma.valueMapping.findFirst.mockResolvedValue(null);
    prisma.valueMapping.update.mockResolvedValue({
      id: 'vm-7',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: 'payee',
      entityId: 'entity-1',
      matchingRule: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    });

    const app = buildApp();
    const res = await request(app).put('/api/value-mappings/vm-7').send({ fieldType: 'name', scannedText: 'Acme', sourceField: 'payee' });

    expect(res.status).toBe(200);
    expect(prisma.valueMapping.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { not: 'vm-7' } }),
    }));
  });

  it('returns 409 when a PUT update conflicts with another mapping', async () => {
    prisma.valueMapping.findUnique.mockResolvedValue({
      id: 'vm-8',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: null,
      entityId: 'entity-1',
      matchingRule: null,
    });
    prisma.valueMapping.findFirst.mockResolvedValue({ id: 'vm-other' });

    const app = buildApp();
    const res = await request(app).put('/api/value-mappings/vm-8').send({ sourceField: 'payee' });

    expect(res.status).toBe(409);
    expect(prisma.valueMapping.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: { not: 'vm-8' },
        templateId: 'template-1',
        fieldType: 'name',
        sourceField: 'payee',
        scannedText: 'Acme',
      },
    }));
  });

  it('returns 400 when PUT sourceField is object', async () => {
    prisma.valueMapping.findUnique.mockResolvedValue({
      id: 'vm-9',
      templateId: 'template-1',
      fieldType: 'name',
      scannedText: 'Acme',
      sourceField: 'payee',
      entityId: 'entity-1',
      matchingRule: null,
    });

    const app = buildApp();
    const res = await request(app).put('/api/value-mappings/vm-9').send({ sourceField: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('sourceField must be a string, null, or omitted');
  });

  it('returns sourceField in GET list response', async () => {
    prisma.valueMapping.findMany.mockResolvedValue([
      {
        id: 'vm-9',
        templateId: 'template-1',
        fieldType: 'name',
        scannedText: 'Acme',
        sourceField: 'payee',
        entityId: 'entity-1',
        matchingRule: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
      {
        id: 'vm-10',
        templateId: 'template-1',
        fieldType: 'name',
        scannedText: 'Acme',
        sourceField: null,
        entityId: 'entity-2',
        matchingRule: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-03'),
      },
    ]);

    const app = buildApp();
    const res = await request(app).get('/api/value-mappings/template-1');

    expect(res.status).toBe(200);
    expect(res.body.map((item: any) => item.sourceField)).toEqual(['payee', null]);
  });

  it('returns updatedAt in GET list response', async () => {
    prisma.valueMapping.findMany.mockResolvedValue([
      {
        id: 'vm-9',
        templateId: 'template-1',
        fieldType: 'name',
        scannedText: 'Acme',
        sourceField: 'payee',
        entityId: 'entity-1',
        matchingRule: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
      {
        id: 'vm-10',
        templateId: 'template-1',
        fieldType: 'name',
        scannedText: 'Acme',
        sourceField: null,
        entityId: 'entity-2',
        matchingRule: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-03'),
      },
    ]);

    const app = buildApp();
    const res = await request(app).get('/api/value-mappings/template-1');

    expect(res.status).toBe(200);
    expect(res.body.map((item: any) => item.updatedAt)).toEqual([
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
    ]);
  });
});
