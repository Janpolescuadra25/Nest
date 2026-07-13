import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { PLANS, type PlanKey, getPlanLimits } from '../lib/stripe';
import { AuthRequest } from './auth.middleware';

type CapacityAction = 'user' | 'location' | 'scan';

function getEffectiveLimits(team: {
  subscriptionSource: string | null;
  currentPlan: string | null;
  planInterval: string | null;
  maxUsers: number | null;
  maxLocations: number | null;
  maxScans: number | null;
  scanHistoryDays: number | null;
  trialExpiresAt: Date | null;
  prioritySupport: boolean | null;
}) {
  const now = new Date();

  // Active trial → Premium limits
  if (team.trialExpiresAt && team.trialExpiresAt > now) {
    const premiumLimits = getPlanLimits('premium');
    return {
      maxUsers: premiumLimits.maxUsers,
      maxLocations: premiumLimits.maxLocations,
      maxScans: premiumLimits.maxScans,
      scanHistoryDays: premiumLimits.scanHistoryDays,
      prioritySupport: true,
    };
  }

  // Paid Stripe subscription → use DB-stored limits
  if (team.subscriptionSource === 'stripe' && team.currentPlan) {
    return {
      maxUsers: team.maxUsers ?? PLANS.free.maxUsers,
      maxLocations: team.maxLocations ?? PLANS.free.maxLocations,
      maxScans: team.maxScans ?? PLANS.free.maxScans,
      scanHistoryDays: team.scanHistoryDays ?? PLANS.free.scanHistoryDays,
      prioritySupport: team.prioritySupport ?? false,
    };
  }

  // Free tier / owner / expired trial → Free limits
  return {
    maxUsers: PLANS.free.maxUsers,
    maxLocations: PLANS.free.maxLocations,
    maxScans: PLANS.free.maxScans,
    scanHistoryDays: PLANS.free.scanHistoryDays,
    prioritySupport: false,
  };
}

export function requireCapacity(action: CapacityAction) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const teamId = req.user!.adminId ?? req.user!.userId;
      const team = await prisma.user.findUnique({
        where: { id: teamId },
        select: {
          id: true,
          subscriptionSource: true,
          currentPlan: true,
          planInterval: true,
          maxUsers: true,
          maxLocations: true,
          maxScans: true,
          scanHistoryDays: true,
          trialExpiresAt: true,
          prioritySupport: true,
        },
      });

    if (!team) {
      return next(new AppError('Team not found', 404));
    }

    if (team.subscriptionSource === 'owner') {
      return next();
    }

    const limits = getEffectiveLimits(team);

    switch (action) {
      case 'user': {
        if (limits.maxUsers != null) {
          const currentCount = await prisma.user.count({ where: { adminId: team.id } });
          if (currentCount >= limits.maxUsers) {
            return next(
              new AppError(
                `Your plan (${team.currentPlan}) allows up to ${limits.maxUsers} users. Upgrade to add more.`,
                403
              )
            );
          }
        }

        break;
      }

      case 'location': {
        if (limits.maxLocations != null) {
          const currentCount = await prisma.location.count({
            where: {
              OR: [{ adminId: team.id }, { userId: team.id }],
            },
          });
          if (currentCount >= limits.maxLocations) {
            return next(
              new AppError(
                `Location limit reached (${limits.maxLocations}). Upgrade your plan for more locations.`,
                403
              )
            );
          }
        }
        break;
      }

      case 'scan': {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const scanCount = await prisma.scanRecord.count({
          where: {
            location: { adminId: team.id },
            source: { in: ['image', 'pdf'] },
            createdAt: { gte: thirtyDaysAgo },
          },
        });

        if (scanCount >= limits.maxScans) {
          res.status(403).json({
            error: 'SCAN_LIMIT_REACHED',
            message: `AI scan limit reached (${limits.maxScans}/month). Upgrade your plan for more scans.`,
          });
          return;
        }

        return next();
      }
    }

    next();
  } catch (err) {
    next(err);
  }
  };
}
