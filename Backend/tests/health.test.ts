import request from 'supertest';
import { prisma } from '../src/lib/prisma';
import app from '../src/index';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

jest.mock('../src/lib/storage', () => ({
  verifyStorageBucketAccessible: jest.fn().mockResolvedValue(undefined),
}));

const mockedPrisma = prisma as unknown as {
  $queryRaw: jest.Mock;
};

const mockedStorage = require('../src/lib/storage') as {
  verifyStorageBucketAccessible: jest.Mock;
};

describe('Health endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /health returns ok live status', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'qyra-backend' });
  });

  it('GET /health/live returns ok live status', async () => {
    const response = await request(app).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'qyra-backend' });
  });

  it('GET /health/ready returns ok when all checks pass', async () => {
    mockedPrisma.$queryRaw.mockResolvedValueOnce([{ 1: 1 }]);

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'qyra-backend',
      readiness: 'ready',
    });
    expect(Array.isArray(response.body.checks)).toBe(true);
  });

  it('GET /health/ready returns 503 if database check fails', async () => {
    mockedPrisma.$queryRaw.mockRejectedValueOnce(new Error('DB unavailable'));

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 'error',
      service: 'qyra-backend',
      readiness: 'not ready',
    });
    expect(response.body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: 'database', status: 'error' }),
      ]),
    );
  });

  it('GET /health/ready returns 503 if storage check fails', async () => {
    mockedPrisma.$queryRaw.mockResolvedValueOnce([{ 1: 1 }]);
    mockedStorage.verifyStorageBucketAccessible.mockRejectedValueOnce(new Error('Storage unreachable'));

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 'error',
      service: 'qyra-backend',
      readiness: 'not ready',
    });
    expect(response.body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: 'storage', status: 'error' }),
      ]),
    );
  });
});
