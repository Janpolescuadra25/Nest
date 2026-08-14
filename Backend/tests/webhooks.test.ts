import express from 'express';
import request from 'supertest';
import webhookRoutes from '../src/routes/webhooks';
import { createErrorHandler } from '../src/lib/errors';
import { prisma } from '../src/lib/prisma';

jest.mock('../src/lib/stripe', () => {
  const mockConstructEvent = jest.fn();
  const mockRetrieveSubscription = jest.fn();

  return {
    __esModule: true,
    stripe: {
      webhooks: { constructEvent: mockConstructEvent },
      subscriptions: { retrieve: mockRetrieveSubscription },
    },
    isStripeConfigured: true,
    getPlanLimits: jest.fn((planKey: string) => {
      const base = { maxStorageBytes: 53687091200 };
      if (planKey === 'starter') return { maxUsers: 2, maxLocations: 5, maxScans: 50, maxTemplates: 10, scanHistoryDays: 30, ...base };
      if (planKey === 'professional') return { maxUsers: 5, maxLocations: 20, maxScans: 250, maxTemplates: 25, scanHistoryDays: 90, ...base };
      if (planKey === 'premium') return { maxUsers: 12, maxLocations: 75, maxScans: 1250, maxTemplates: 75, scanHistoryDays: 365, ...base };
      if (planKey === 'enterprise') return { maxUsers: 20, maxLocations: 250, maxScans: 5000, maxTemplates: 200, scanHistoryDays: 730, ...base };
      return { maxUsers: 1, maxLocations: 1, maxScans: 7, maxTemplates: 3, scanHistoryDays: 7, ...base };
    }),
    getScanPack: jest.fn().mockReturnValue(undefined),
    PLANS: {
      free: { prioritySupport: false, maxStorageBytes: 53687091200 },
      starter: { prioritySupport: false, maxStorageBytes: 53687091200 },
      professional: { prioritySupport: true, maxStorageBytes: 53687091200 },
      premium: { prioritySupport: true, maxStorageBytes: 53687091200 },
      enterprise: { prioritySupport: true, maxStorageBytes: 53687091200 },
    },
    __stripeMocks: {
      mockConstructEvent,
      mockRetrieveSubscription,
    },
  };
});

jest.mock('../src/lib/prisma', () => {
  const mockUserUpdate = jest.fn();
  const mockUserUpdateMany = jest.fn();
  const mockUserFindMany = jest.fn().mockResolvedValue([]);
  const mockStripeEventFindUnique = jest.fn().mockResolvedValue(null);
  const mockStripeEventCreate = jest.fn().mockResolvedValue({});

  return {
    prisma: {
      user: {
        update: mockUserUpdate,
        updateMany: mockUserUpdateMany,
        findMany: mockUserFindMany,
      },
      stripeEvent: {
        findUnique: mockStripeEventFindUnique,
        create: mockStripeEventCreate,
      },
    },
    __prismaMocks: {
      mockUserUpdate,
      mockUserUpdateMany,
      mockUserFindMany,
    },
  };
});

const { __stripeMocks } = jest.requireMock('../src/lib/stripe') as any;
const mockConstructEvent = __stripeMocks.mockConstructEvent as jest.Mock;
const mockRetrieveSubscription = __stripeMocks.mockRetrieveSubscription as jest.Mock;
const { __prismaMocks } = jest.requireMock('../src/lib/prisma') as any;
const mockUserUpdate = __prismaMocks.mockUserUpdate as jest.Mock;
const mockUserUpdateMany = __prismaMocks.mockUserUpdateMany as jest.Mock;
const mockUserFindMany = __prismaMocks.mockUserFindMany as jest.Mock;

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = 'price_starter_monthly';
  process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID = 'price_professional_monthly';
  process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID = 'price_premium_monthly';
  process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID = 'price_enterprise_monthly';
});

type MockPrisma = {
  user: {
    update: jest.Mock;
    updateMany: jest.Mock;
    findMany: jest.Mock;
  };
  stripeEvent: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
};

const mockedPrisma = prisma as unknown as MockPrisma;

function buildApp() {
  const app = express();
  app.use(express.raw({ type: 'application/json' }));
  app.use('/api/webhooks', webhookRoutes);
  app.use(createErrorHandler());
  return app;
}

const rawPayload = JSON.stringify({ hello: 'world' });

describe('Stripe webhook route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('M-6: Storage abuse prevention', () => {
    it('ensures all plans define a 50 GB storage safety net', async () => {
      const { getPlanLimits, PLANS } = jest.requireMock('../src/lib/stripe') as any;
      expect(PLANS.free.maxStorageBytes).toBe(53687091200);
      expect(PLANS.starter.maxStorageBytes).toBe(53687091200);
      expect(PLANS.professional.maxStorageBytes).toBe(53687091200);
      expect(PLANS.premium.maxStorageBytes).toBe(53687091200);
      expect(PLANS.enterprise.maxStorageBytes).toBe(53687091200);
      expect(getPlanLimits('starter').maxStorageBytes).toBe(53687091200);
      expect(getPlanLimits('free').maxStorageBytes).toBe(53687091200);
    });

    it('checkout.session.completed sets storage limits on the plan', async () => {
      mockConstructEvent.mockReturnValueOnce({
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cust_1',
            subscription: 'sub_1',
            metadata: { teamId: 'team-1', planKey: 'starter' },
          },
        },
      });
      mockRetrieveSubscription.mockResolvedValueOnce({ current_period_end: 1700000000 });

      const app = buildApp();
      await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', 'sig')
        .set('Content-Type', 'application/json')
        .send(rawPayload)
        .expect(200);

      expect(mockedPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'team-1' },
          data: expect.objectContaining({
            maxStorageBytes: 53687091200,
            poolStorageBytes: 53687091200,
          }),
        })
      );
    });

    it('customer.subscription.deleted resets storage to free plan values', async () => {
      mockConstructEvent.mockReturnValueOnce({
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_1',
          },
        },
      });

      const app = buildApp();
      await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', 'sig')
        .set('Content-Type', 'application/json')
        .send(rawPayload)
        .expect(200);

      expect(mockedPrisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripeSubscriptionId: 'sub_1' },
          data: expect.objectContaining({
            maxStorageBytes: 53687091200,
            poolStorageBytes: 53687091200,
          }),
        })
      );
    });
  });

  it('handles checkout.session.completed and updates the team subscription', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cust_1',
          subscription: 'sub_1',
          metadata: { teamId: 'team-1', planKey: 'starter' },
        },
      },
    });
    mockRetrieveSubscription.mockResolvedValueOnce({ current_period_end: 1700000000 });

    const app = buildApp();
    await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(rawPayload)
      .expect(200);

    expect(mockedPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'team-1' },
        data: expect.objectContaining({
          subscriptionSource: 'stripe',
          stripeCustomerId: 'cust_1',
          stripeSubscriptionId: 'sub_1',
          currentPlan: 'starter',
          planInterval: 'month',
          cancelAtPeriodEnd: false,
          paymentIssue: false,
          status: 'ACTIVE',
          trialExpiresAt: null,
          maxUsers: 2,
          maxLocations: 5,
          currentPeriodEnd: expect.any(Date),
        }),
      })
    );
  });

  it('skips checkout updates when team metadata is missing', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cust_1',
          subscription: 'sub_1',
          metadata: {},
        },
      },
    });

    const app = buildApp();
    await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(rawPayload)
      .expect(200);

    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it('handles customer.subscription.updated and updates plan metadata for known price IDs', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          status: 'active',
          current_period_end: 1700000000,
          cancel_at_period_end: true,
          items: {
            data: [{ price: { id: 'price_professional_monthly' } }],
          },
        },
      },
    });

    const app = buildApp();
    await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(rawPayload)
      .expect(200);

    expect(mockedPrisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubscriptionId: 'sub_1' },
        data: expect.objectContaining({
          currentPlan: 'professional',
          maxUsers: 5,
          maxLocations: 20,
          status: 'ACTIVE',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: expect.any(Date),
        }),
      })
    );
  });

  it('handles customer.subscription.updated without a known price and does not set a plan', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          status: 'active',
          current_period_end: 1700000000,
          cancel_at_period_end: false,
          items: {
            data: [{ price: { id: 'price_unknown' } }],
          },
        },
      },
    });

    const app = buildApp();
    await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(rawPayload)
      .expect(200);

    const updateCall = mockedPrisma.user.updateMany.mock.calls[0][0];
    expect(updateCall.where).toEqual({ stripeSubscriptionId: 'sub_1' });
    expect(updateCall.data).toEqual(expect.objectContaining({
      status: 'ACTIVE',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: expect.any(Date),
    }));
    expect(updateCall.data).not.toHaveProperty('currentPlan');
  });

  it('handles customer.subscription.deleted and clears stripe subscription data', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_1',
        },
      },
    });

    const app = buildApp();
    await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(rawPayload)
      .expect(200);

    expect(mockedPrisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubscriptionId: 'sub_1' },
        data: expect.objectContaining({
          subscriptionSource: null,
          currentPlan: null,
          planInterval: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          paymentIssue: false,
          maxUsers: null,
          maxLocations: null,
          status: 'EXPIRED',
        }),
      })
    );
  });

  it('handles invoice.payment_failed and marks the subscription with a payment issue', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'invoice.payment_failed',
      data: {
        object: {
          subscription: 'sub_1',
        },
      },
    });

    const app = buildApp();
    await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(rawPayload)
      .expect(200);

    expect(mockedPrisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubscriptionId: 'sub_1' },
        data: { paymentIssue: true },
      })
    );
  });

  it('handles invoice.paid and refreshes subscription period and status', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'invoice.paid',
      data: {
        object: {
          subscription: 'sub_1',
        },
      },
    });
    mockRetrieveSubscription.mockResolvedValueOnce({ current_period_end: 1700000000 });

    const app = buildApp();
    await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(rawPayload)
      .expect(200);

    expect(mockRetrieveSubscription).toHaveBeenCalledWith('sub_1');
    expect(mockedPrisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubscriptionId: 'sub_1' },
        data: expect.objectContaining({
          status: 'ACTIVE',
          paymentIssue: false,
          currentPeriodEnd: expect.any(Date),
        }),
      })
    );
  });

  it('returns 400 when the Stripe signature header is missing', async () => {
    mockConstructEvent.mockReset();

    const app = buildApp();
    await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(rawPayload)
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toContain('Missing webhook signature');
      });
  });

  it('returns 400 when Stripe signature verification fails', async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('Invalid signature');
    });

    const app = buildApp();
    await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(rawPayload)
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toContain('Invalid webhook signature');
      });
  });
});
