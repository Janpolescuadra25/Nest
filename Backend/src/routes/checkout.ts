import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { stripe, PLANS, isStripeConfigured, type PlanKey, getScanPacks, getScanPack, type ScanPackKey } from '../lib/stripe';
import { asyncHandler, AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';

function getStartOfWeek(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);
}

const createSessionSchema = z.object({
  plan: z.enum(['free', 'starter', 'professional', 'premium', 'enterprise']),
  interval: z.enum(['month', 'year']).default('month'),
});

const createScanPackSchema = z.object({
  scanPack: z.enum(['scan_pack_100', 'scan_pack_250', 'scan_pack_500']),
});

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many checkout attempts. Please try again later.' },
});

const router = Router();

router.post(
  '/create-session',
  authenticate,
  validate(createSessionSchema),
  checkoutLimiter,
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
    if (team.managedById) {
      throw new AppError('Contact your admin to upgrade your plan.', 403);
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
      success_url: `${process.env.FRONTEND_URL}/billing-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/billing-cancel`,
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
  '/create-scan-pack-session',
  authenticate,
  validate(createScanPackSchema),
  checkoutLimiter,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!isStripeConfigured || !stripe) {
      throw new AppError('Stripe is not configured. Contact support.', 503);
    }

    const { scanPack } = req.body as z.infer<typeof createScanPackSchema>;
    const pack = getScanPack(scanPack);
    if (!pack) {
      throw new AppError('Invalid scan pack selected.', 400);
    }

    const teamId = req.user!.adminId ?? req.user!.userId;
    const team = await prisma.user.findUnique({ where: { id: teamId } });
    if (!team) throw new AppError('Team not found', 404);
    if (team.subscriptionSource === 'owner') {
      throw new AppError('Platform owner does not use Stripe billing', 400);
    }
    if (team.managedById) {
      throw new AppError('Contact your admin to purchase bonus scans.', 403);
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

    if (!pack.stripePriceId) {
      throw new AppError(`Price ID for ${pack.name} is not configured.`, 500);
    }
    if (!process.env.FRONTEND_URL) {
      throw new AppError('Frontend URL is not configured', 500);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: pack.stripePriceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/billing-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/billing-cancel`,
      metadata: {
        teamId,
        scanPack: pack.id,
      },
    });

    res.json({ url: session.url ?? '' });
  })
);

router.post(
  '/create-portal-session',
  authenticate,
  checkoutLimiter,
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

    let stripeCustomerId = team.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: team.email ?? undefined,
        name: team.name || undefined,
        metadata: { userId: team.id },
      });
      stripeCustomerId = customer.id;
      await prisma.user.update({ where: { id: team.id }, data: { stripeCustomerId: customer.id } });
    }

    if (!process.env.FRONTEND_URL) {
      throw new AppError('Frontend URL is not configured', 500);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
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

router.get(
  '/scan-packs',
  asyncHandler(async (_req, res) => {
    const packs = getScanPacks();
    res.json({ scanPacks: packs });
  })
);

router.get(
  '/scan-usage',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const teamId = req.user!.adminId ?? req.user!.userId;
    const user = await prisma.user.findUnique({
      where: { id: teamId },
      select: {
        currentPlan: true,
        maxScans: true,
        poolScans: true,
        bonusScans: true,
        allocatedScans: true,
        managedById: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const weekStart = getStartOfWeek();
    const scansUsed = await prisma.scanRecord.count({
      where: {
        location: { adminId: teamId },
        source: { in: ['pos', 'excel', 'image'] },
        createdAt: { gte: weekStart },
      },
    });

    const maxScans = user.maxScans ?? PLANS.free.maxScans;
    const bonusScans = user.bonusScans ?? 0;
    const totalAvailable = maxScans + bonusScans;

    res.json({ scansUsed, maxScans, bonusScans, totalAvailable, plan: user.currentPlan, periodStart: weekStart.toISOString() });
  })
);

router.get(
  '/scan-pack-purchases',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const teamId = req.user!.adminId ?? req.user!.userId;
    const purchases = await prisma.scanPackPurchase.findMany({
      where: { userId: teamId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        packKey: true,
        scans: true,
        pricePaid: true,
        status: true,
        createdAt: true,
      },
    });

    res.json(purchases.map((p) => ({
      ...p,
      pricePaid: p.pricePaid / 100,
    })));
  })
);

export default router;
