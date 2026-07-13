import { Router } from 'express';
import { z } from 'zod';
import { stripe, PLANS, isStripeConfigured, type PlanKey } from '../lib/stripe';
import { asyncHandler, AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';

const createSessionSchema = z.object({
  plan: z.enum(['free', 'starter', 'professional', 'premium', 'enterprise']),
  interval: z.enum(['month', 'year']).default('month'),
});

const router = Router();

router.post(
  '/create-session',
  authenticate,
  validate(createSessionSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!isStripeConfigured || !stripe) {
      throw new AppError('Stripe is not configured. Contact support.', 503);
    }

    const { plan: planKey, interval } = req.body as z.infer<typeof createSessionSchema>;

    if (planKey === 'free') {
      throw new AppError('The Free plan does not require checkout.', 400);
    }

    const teamId = req.user!.adminId ?? req.user!.userId;
    const team = await prisma.user.findUnique({ where: { id: teamId } });
    if (!team) throw new AppError('Team not found', 404);
    if (team.subscriptionSource === 'owner') {
      throw new AppError('Platform owner does not use Stripe billing', 400);
    }

    if (team.subscriptionSource === 'stripe' && team.stripeSubscriptionId) {
      throw new AppError('Team already has an active subscription. Use the billing portal to manage or change plans.', 400);
    }

    let customerId = team.stripeCustomerId ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user?.email ?? undefined,
        metadata: { teamId },
      });
      customerId = customer.id;
      await prisma.user.update({ where: { id: teamId }, data: { stripeCustomerId: customerId } });
    }

    const priceId = interval === 'year'
      ? PLANS[planKey].annualPriceId
      : PLANS[planKey].monthlyPriceId;
    if (!priceId) {
      throw new AppError(`Price ID for ${planKey} (${interval}) is not configured.`, 500);
    }
    if (!process.env.FRONTEND_URL) {
      throw new AppError('Frontend URL is not configured', 500);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/billing/cancel`,
      metadata: {
        teamId,
        planKey,
        planInterval: interval,
      },
    });

    res.json({ url: session.url ?? '' });
  })
);

router.post(
  '/create-portal-session',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!isStripeConfigured || !stripe) {
      throw new AppError('Stripe is not configured. Contact support.', 503);
    }
    const teamId = req.user!.adminId ?? req.user!.userId;
    const team = await prisma.user.findUnique({ where: { id: teamId } });
    if (!team) throw new AppError('Team not found', 404);
    if (team.subscriptionSource === 'owner') {
      throw new AppError('Platform owner does not use Stripe billing', 400);
    }
    if (!team.stripeCustomerId) {
      throw new AppError('No Stripe customer found for this team', 400);
    }
    if (!process.env.FRONTEND_URL) {
      throw new AppError('Frontend URL is not configured', 500);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: team.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/settings`,
    });

    res.json({ url: session.url ?? '' });
  })
);

router.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    const plans = Object.entries(PLANS).map(([key, plan]) => ({
      id: key,
      name: plan.name,
      monthlyPrice: plan.monthlyPrice,
      annualPrice: plan.annualPrice,
      maxUsers: plan.maxUsers,
      maxLocations: plan.maxLocations,
      maxScans: plan.maxScans,
      scanHistoryDays: plan.scanHistoryDays,
      prioritySupport: plan.prioritySupport,
    }));
    res.json({ plans });
  })
);

export default router;
