import { Router } from 'express';
import { stripe, PLANS, type PlanKey } from '../lib/stripe';
import { asyncHandler, AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware';

const router = Router();

router.post(
  '/create-session',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { plan } = req.body as { plan?: string };
    const planKey = plan as PlanKey;

    if (!planKey || !PLANS[planKey]) {
      throw new AppError('Invalid plan selected', 400);
    }

    const teamId = req.user!.adminId ?? req.user!.userId;
    const team = await prisma.user.findUnique({ where: { id: teamId } });
    if (!team) throw new AppError('Team not found', 404);

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

    const priceId = PLANS[planKey].priceId;
    if (!priceId) {
      throw new AppError('Stripe price configuration is missing', 500);
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
      metadata: { teamId, planKey },
    });

    res.json({ url: session.url ?? '' });
  })
);

router.post(
  '/create-portal-session',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const teamId = req.user!.adminId ?? req.user!.userId;
    const team = await prisma.user.findUnique({ where: { id: teamId } });
    if (!team) throw new AppError('Team not found', 404);
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
      pricePhp: plan.pricePhp,
      priceUsd: plan.priceUsd,
      interval: plan.interval,
      users: plan.users,
      locations: plan.locations,
      features: plan.features,
    }));
    res.json({ plans });
  })
);

export default router;
