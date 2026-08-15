import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { AppError } from '../src/lib/errors';
import { apiLimiter } from '../src/middleware/rate-limit';

describe('rate limiting', () => {
  it('returns 429 with Retry-After header when rate limit exceeded', async () => {
    const app = express();
    app.use(
      rateLimit({
        windowMs: 60000,
        max: 2,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res, next) => {
          res.setHeader('Retry-After', '59');
          next(new AppError('Too many requests.', 429));
        },
      })
    );
    app.get('/test', (_req, res) => {
      res.status(200).send('ok');
    });
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ error: err.message }));

    await request(app).get('/test').expect(200);
    const second = await request(app).get('/test').expect(200);
    expect(second.headers['ratelimit-remaining']).toBe('0');

    const third = await request(app).get('/test').expect(429);
    expect(third.headers['retry-after']).toBeDefined();
  });

  it('apiLimiter allows requests within limit and sends standard headers', async () => {
    const app = express();
    app.use(apiLimiter);
    app.get('/api-test', (_req, res) => {
      res.status(200).send('ok');
    });
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ error: err.message }));

    const res = await request(app).get('/api-test').expect(200);
    expect(res.headers['ratelimit-limit']).toBe('100');
    expect(res.headers['ratelimit-remaining']).toBeDefined();
  });
});
