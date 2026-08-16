import { Router } from 'express';
import Stripe from 'stripe';
import { stripe, isStripeConfigured, type PlanKey, getScanPack, getPlanLimits, PLANS } from '../lib/stripe';
import { asyncHandler, AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'Webhooks' });
const router = Router();

type WebhookEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

type CheckoutSessionPayload = {
  id: string;
  amount_total: number | null;
  metadata?: Record<string, string>;
  customer?: string | { id: string };
  subscription?: string | { id: string };
};

type SubscriptionPayload = {
  id: string;
  items?: {
    data?: Array<{
      price?: {
        id?: string;
        recurring?: { interval?: string };
      };
    }>;
  };
  current_period_end?: number;
  status?: string;
  cancel_at_period_end?: boolean;
};

type InvoicePayload = {
  subscription?: string | { id: string };
};

router.post(
  '/stripe',
  asyncHandler(async (req, res) => {
    if (!isStripeConfigured || !stripe) {
      throw new AppError('Stripe is not configured. Contact support.', 503);
    }
    const sig = req.headers['stripe-signature'] as string | undefined;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !webhookSecret) {
      throw new AppError('Missing webhook signature or secret', 400);
    }

    let event: WebhookEvent;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret) as unknown as WebhookEvent;
    } catch (err) {
      throw new AppError('Invalid webhook signature', 400);
    }

    // Idempotency: skip already-processed events
    const existing = await prisma.stripeEvent.findUnique({
      where: { eventId: event.id },
    });
    if (existing) {
      return res.json({ received: true });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as CheckoutSessionPayload;
        const teamId = session.metadata?.teamId;
        const planKey = session.metadata?.planKey as PlanKey | undefined;
        const scanPack = session.metadata?.scanPack as string | undefined;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

        if (scanPack) {
          const pack = getScanPack(scanPack);
          if (teamId && pack) {
            await prisma.$transaction([
              prisma.user.update({
                where: { id: teamId },
                data: {
                  bonusScans: { increment: pack.scans },
                  stripeCustomerId: customerId ?? undefined,
                },
              }),
              prisma.scanPackPurchase.create({
                data: {
                  userId: teamId,
                  packKey: scanPack,
                  scans: pack.scans,
                  pricePaid: session.amount_total ?? 0,
                  stripeSessionId: session.id,
                  status: 'active',
                },
              }),
            ]);
          }
          break;
        }

        if (!teamId || !planKey) break;
        if (!subscriptionId) break;

        const subscription = (await stripe.subscriptions.retrieve(subscriptionId)) as SubscriptionPayload;
        const periodEnd = new Date((subscription.current_period_end ?? 0) * 1000);
        const limits = getPlanLimits(planKey);

        await prisma.user.update({
          where: { id: teamId },
          data: {
            subscriptionSource: 'stripe',
            stripeCustomerId: customerId ?? undefined,
            stripeSubscriptionId: subscriptionId,
            currentPlan: planKey,
            planInterval: (session.metadata?.planInterval as 'month' | 'year') ?? 'month',
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            paymentIssue: false,
            status: 'ACTIVE',
            maxUsers: limits.maxUsers,
            maxLocations: limits.maxLocations,
            maxScans: limits.maxScans,
            poolScans: limits.maxScans,
            poolLocations: limits.maxLocations,
            maxStorageBytes: limits.maxStorageBytes,
            poolStorageBytes: limits.maxStorageBytes,
            maxMembers: limits.maxUsers > 1 ? limits.maxUsers - 1 : 0,
            role: limits.maxUsers > 1 ? 'ADMIN' : 'VIEWER',
            scanHistoryDays: limits.scanHistoryDays,
            prioritySupport: PLANS[planKey].prioritySupport,
            trialExpiresAt: null,
          },
        });
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as SubscriptionPayload;
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const planKey = identifyPlan(priceId);
        const subItems = subscription.items?.data;
        const priceInterval = subItems?.[0]?.price?.recurring?.interval;
        const planInterval: 'month' | 'year' = priceInterval === 'year' ? 'year' : 'month';
        const periodEnd = new Date((subscription.current_period_end ?? 0) * 1000);

        const updateData: Record<string, unknown> = {
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
          paymentIssue: false,
          status: ['active', 'trialing', 'past_due'].includes(subscription.status ?? '') ? 'ACTIVE' : 'EXPIRED',
          planInterval,
        };

        if (planKey) {
          const limits = getPlanLimits(planKey);
          updateData.currentPlan = planKey;
          updateData.maxUsers = limits.maxUsers;
          updateData.maxLocations = limits.maxLocations;
          updateData.maxScans = limits.maxScans;
          updateData.poolScans = limits.maxScans;
          updateData.poolLocations = limits.maxLocations;
          updateData.maxStorageBytes = limits.maxStorageBytes;
          updateData.poolStorageBytes = limits.maxStorageBytes;
          updateData.poolTemplates = limits.maxTemplates;
          updateData.maxMembers = limits.maxUsers > 1 ? limits.maxUsers - 1 : 0;
          updateData.role = limits.maxUsers > 1 ? 'ADMIN' : 'VIEWER';
          updateData.scanHistoryDays = limits.scanHistoryDays;
          updateData.prioritySupport = PLANS[planKey].prioritySupport;
        }

        const currentTeams = await prisma.user.findMany({
          where: { stripeSubscriptionId: subscription.id },
          select: { id: true, poolScans: true, poolLocations: true, poolTemplates: true },
        });

        await prisma.user.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: updateData,
        });

        // Cap member allocations if pool shrunk
        for (const team of currentTeams) {
          if (updateData.poolScans != null) {
            const newScans = updateData.poolScans as number;
            const currentScans = team.poolScans ?? 0;
            if (newScans < currentScans) {
              await prisma.user.updateMany({
                where: { managedById: team.id, allocatedScans: { gt: newScans } },
                data: { allocatedScans: newScans },
              });
            }
          }
          if (updateData.poolLocations != null) {
            const newLocs = updateData.poolLocations as number;
            const currentLocs = team.poolLocations ?? 0;
            if (newLocs < currentLocs) {
              await prisma.user.updateMany({
                where: { managedById: team.id, allocatedLocations: { gt: newLocs } },
                data: { allocatedLocations: newLocs },
              });
            }
          }
          if (updateData.poolTemplates != null) {
            const newTemplates = updateData.poolTemplates as number;
            const currentTemplates = team.poolTemplates ?? 0;
            if (newTemplates < currentTemplates) {
              await prisma.user.updateMany({
                where: { managedById: team.id, allocatedTemplates: { gt: newTemplates } },
                data: { allocatedTemplates: newTemplates },
              });
            }
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as SubscriptionPayload;
        const affectedUsers = await prisma.user.findMany({
          where: { stripeSubscriptionId: subscription.id },
          select: { id: true },
        });
        const affectedIds = affectedUsers.map(u => u.id);
        const freeLimits = getPlanLimits('free');

        await prisma.user.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            subscriptionSource: null,
            currentPlan: null,
            planInterval: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            paymentIssue: false,
            maxUsers: null,
            maxLocations: null,
            maxScans: null,
            poolScans: null,
            poolLocations: null,
            maxStorageBytes: freeLimits.maxStorageBytes,
            poolStorageBytes: freeLimits.maxStorageBytes,
            poolTemplates: null,
            maxMembers: null,
            scanHistoryDays: null,
            prioritySupport: false,
            status: 'EXPIRED',
            role: 'VIEWER',
          },
        });

        // Clear all managed members' allocations and link
        if (affectedIds.length > 0) {
          await prisma.user.updateMany({
            where: { managedById: { in: affectedIds } },
            data: {
              managedById: null,
              allocatedScans: null,
              allocatedLocations: null,
              allocatedTemplates: null,
            },
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as InvoicePayload;
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (!subscriptionId) break;

        await prisma.user.updateMany({
          where: { stripeSubscriptionId: subscriptionId },
          data: { paymentIssue: true },
        });
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as InvoicePayload;
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (!subscriptionId) break;

        const subscription = (await stripe.subscriptions.retrieve(subscriptionId)) as SubscriptionPayload;
        const periodEnd = new Date((subscription.current_period_end ?? 0) * 1000);

        await prisma.user.updateMany({
          where: { stripeSubscriptionId: subscriptionId },
          data: {
            status: 'ACTIVE',
            paymentIssue: false,
            currentPeriodEnd: periodEnd,
          },
        });
        break;
      }

      default:
        if (process.env.NODE_ENV !== 'production') {
          log.info({ eventType: event.type }, 'Unhandled Stripe event type');
        }
    }

    // Record processed event (don't fail webhook if recording fails)
    await prisma.stripeEvent.create({
      data: { eventId: event.id, eventType: event.type },
    }).catch(() => {});

    res.json({ received: true });
  })
);

function identifyPlan(priceId: string | undefined): PlanKey | null {
  if (!priceId) return null;

  const monthlyMap: Record<string, PlanKey> = {
    [process.env.STRIPE_STARTER_MONTHLY_PRICE_ID ?? '']: 'starter',
    [process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID ?? '']: 'professional',
    [process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID ?? '']: 'premium',
    [process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID ?? '']: 'enterprise',
  };
  const annualMap: Record<string, PlanKey> = {
    [process.env.STRIPE_STARTER_ANNUAL_PRICE_ID ?? '']: 'starter',
    [process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID ?? '']: 'professional',
    [process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID ?? '']: 'premium',
    [process.env.STRIPE_ENTERPRISE_ANNUAL_PRICE_ID ?? '']: 'enterprise',
  };

  if (monthlyMap[priceId]) return monthlyMap[priceId];
  if (annualMap[priceId]) return annualMap[priceId];
  return null;
}

export default router;
