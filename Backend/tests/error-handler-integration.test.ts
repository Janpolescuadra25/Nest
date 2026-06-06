import express from 'express';
import request from 'supertest';
import { createErrorHandler, asyncHandler, AppError } from '../src/lib/errors';

describe('global error middleware integration', () => {
  let app: express.Express;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.NODE_ENV = 'production';
    app = express();

    app.get('/throw-app-error', asyncHandler(async (_req, res) => {
      throw new AppError('Test error', 400);
    }));

    app.get('/throw-generic-error', asyncHandler(async () => {
      throw new Error('Oops');
    }));

    app.get('/success', asyncHandler(async (_req, res) => {
      res.json({ data: 'ok' });
    }));

    app.use(createErrorHandler());
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns 400 for AppError route', async () => {
    const response = await request(app).get('/throw-app-error');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Test error' });
  });

  it('returns 500 for generic error route', async () => {
    const response = await request(app).get('/throw-generic-error');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
  });

  it('returns 200 for successful route', async () => {
    const response = await request(app).get('/success');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: 'ok' });
  });

  it('returns 404 for nonexistent routes', async () => {
    const response = await request(app).get('/no-route');
    expect(response.status).toBe(404);
  });
});
