import { Router } from 'express';
import Stripe from 'stripe';
import { stripe, isStripeConfigured, type PlanKey, getPlanLimits } from '../lib/stripe';
import { asyncHandler, AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';

const router = Router();

type WebhookEvent = {
  type: string;
  data: { object: Record<string, unknown> };
};

type CheckoutSessionPayload = {
  metadata?: Record<string, string>;
  customer?: string | { id: string };
  subscription?: string | { id: string };
};

type SubscriptionPayload = {
  id: string;
  items?: { data?: Array<{ price?: { id?: string } }> };
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

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as CheckoutSessionPayload;
        const teamId = session.metadata?.teamId;
        const planKey = session.metadata?.planKey as PlanKey | undefined;
        if (!teamId || !planKey) break;

        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
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
            planInterval: 'month',
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            paymentIssue: false,
            status: 'ACTIVE',
            maxUsers: limits.maxUsers,
            maxLocations: limits.maxLocations,
            trialExpiresAt: null,
          },
        });
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as SubscriptionPayload;
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const planKey = identifyPlan(priceId);
        const periodEnd = new Date((subscription.current_period_end ?? 0) * 1000);

        const updateData: Record<string, unknown> = {
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
          paymentIssue: false,
          status: ['active', 'trialing', 'past_due'].includes(subscription.status ?? '') ? 'ACTIVE' : 'EXPIRED',
        };

        if (planKey) {
          const limits = getPlanLimits(planKey);
          updateData.currentPlan = planKey;
          updateData.maxUsers = limits.maxUsers;
          updateData.maxLocations = limits.maxLocations;
        }

        await prisma.user.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: updateData,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as SubscriptionPayload;
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
            status: 'EXPIRED',
          },
        });
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
          console.log(`Unhandled Stripe event type: ${event.type}`);
        }
    }

    res.json({ received: true });
  })
);

function identifyPlan(priceId: string | undefined): PlanKey | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_SOLO_PRICE_ID) return 'solo';
  if (priceId === process.env.STRIPE_STARTER_PRICE_ID) return 'starter';
  if (priceId === process.env.STRIPE_GROWTH_PRICE_ID) return 'growth';
  if (priceId === process.env.STRIPE_ENTERPRISE_PRICE_ID) return 'enterprise';
  return null;
}

export default router;
