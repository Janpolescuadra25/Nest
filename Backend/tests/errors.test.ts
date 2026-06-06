import express, { Request, Response } from 'express';
import request from 'supertest';
import { ZodError, ZodIssue } from 'zod';
import { AppError, ValidationError, asyncHandler, createErrorHandler } from '../src/lib/errors';

describe('AppError', () => {
  it('sets message, default status, and name', () => {
    const error = new AppError('Something broke');
    expect(error.message).toBe('Something broke');
    expect(error.status).toBe(500);
    expect(error.name).toBe('AppError');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
  });

  it('accepts a custom status code', () => {
    const error = new AppError('Bad request', 400);
    expect(error.status).toBe(400);
  });
});

describe('ValidationError', () => {
  it('wraps a ZodError with status 400 and field details', () => {
    const issues = [
      { path: ['email'], message: 'Invalid email', code: 'custom' },
      { path: ['email'], message: 'Must contain @', code: 'custom' },
      { path: ['name'], message: 'Required', code: 'custom' },
    ] as any;
    const zodError = new ZodError(issues);
    const error = new ValidationError(zodError);

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(400);
    expect(error.name).toBe('ValidationError');
    expect(error.fields).toEqual({
      email: 'Invalid email, Must contain @',
      name: 'Required',
    });
    expect(error.message).toBe(zodError.message);
  });
});

describe('asyncHandler and createErrorHandler integration', () => {
  let app: express.Express;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.NODE_ENV = 'production';
    app = express();
    app.get('/success', asyncHandler(async (_req: Request, res: Response) => {
      res.json({ data: 'ok' });
    }));

    app.get('/throw-app-error', asyncHandler(async () => {
      throw new AppError('Test error', 400);
    }));

    app.get('/throw-generic-error', asyncHandler(async () => {
      throw new Error('Generic failure');
    }));

    app.get('/throw-rejection', asyncHandler(async () => {
      return Promise.reject(new AppError('Rejected', 400));
    }));

    app.use(createErrorHandler());
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns success from a normal async route', async () => {
    const response = await request(app).get('/success');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: 'ok' });
  });

  it('passes AppError through createErrorHandler with correct status and body', async () => {
    const response = await request(app).get('/throw-app-error');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Test error' });
  });

  it('returns internal server error for generic Error', async () => {
    const response = await request(app).get('/throw-generic-error');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
  });

  it('handles rejected promises and passes them to next()', async () => {
    const response = await request(app).get('/throw-rejection');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Rejected' });
  });
});
