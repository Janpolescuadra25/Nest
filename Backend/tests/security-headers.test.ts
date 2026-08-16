import express from 'express';
import helmet from 'helmet';
import request from 'supertest';

describe('security headers', () => {
  it('applies helmet security headers with default settings', async () => {
    const app = express();
    app.use(helmet());
    app.get('/', (_req, res) => res.send('ok'));

    const res = await request(app).get('/');

    expect(res.headers['x-content-type-options']).toBeDefined();
    expect(res.headers['x-content-type-options']).not.toEqual('');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-frame-options']).not.toEqual('');

    if (res.headers['x-xss-protection'] !== undefined) {
      expect(res.headers['x-xss-protection']).not.toEqual('');
    }

    if (res.headers['strict-transport-security'] !== undefined) {
      expect(res.headers['strict-transport-security']).not.toEqual('');
    }
  });
});
