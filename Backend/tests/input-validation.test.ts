import express from 'express';
import request from 'supertest';
import { validate } from '../src/middleware/validate';
import { notificationPreferencesSchema, payeeMappingCreateSchema, ruleCreateSchema } from '../src/lib/validators';

describe('Input validation (O-5)', () => {
  it('rejects invalid notification preferences with 400', async () => {
    const app = express();
    app.use(express.json());
    app.put('/test', validate(notificationPreferencesSchema), (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .put('/test')
      .send({ syncFailureAlerts: 'not-a-boolean' })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
    expect(res.body.fields).toBeDefined();
    expect(res.body.fields.syncFailureAlerts).toBeDefined();
  });

  it('rejects payee mapping creation without rawName with 400', async () => {
    const app = express();
    app.use(express.json());
    app.post('/test', validate(payeeMappingCreateSchema), (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .post('/test')
      .send({ mappedTo: 'Some Payee' })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
    expect(res.body.fields.rawName).toBeDefined();
  });

  it('rejects rule creation with invalid triggerType with 400', async () => {
    const app = express();
    app.use(express.json());
    app.post('/test', validate(ruleCreateSchema), (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .post('/test')
      .send({ name: 'Test Rule', conditions: [{}], actions: [{}], triggerType: 'invalid_type' })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
    expect(res.body.fields.triggerType).toBeDefined();
  });
});
