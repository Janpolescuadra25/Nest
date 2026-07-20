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
  bonusScans: number | null;
  poolScans: number | null;
  poolLocations: number | null;
  allocatedScans: number | null;
  allocatedLocations: number | null;
  maxMembers: number | null;
  managedById: string | null;
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
      maxScans: (team.maxScans ?? PLANS.free.maxScans) + (team.bonusScans ?? 0),
      scanHistoryDays: team.scanHistoryDays ?? PLANS.free.scanHistoryDays,
      prioritySupport: team.prioritySupport ?? false,
    };
  }

  // Free tier / owner / expired trial → Free limits
  return {
    maxUsers: PLANS.free.maxUsers,
    maxLocations: PLANS.free.maxLocations,
    maxScans: PLANS.free.maxScans + (team.bonusScans ?? 0),
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
          poolScans: true,
          bonusScans: true,
          poolLocations: true,
          allocatedScans: true,
          allocatedLocations: true,
          maxMembers: true,
          managedById: true,
          scanHistoryDays: true,
          trialExpiresAt: true,
          prioritySupport: true,
        },
      });

    if (!team) {
      return next(new AppError('Team not found', 404));
    }

    if (team.subscriptionSource === 'owner' && team.managedById === null && team.poolScans == null) {
      return next();
    }

    // Team member — use individual allocation if present
    if (team.managedById) {
      const allocatedScans = team.allocatedScans ?? 0;
      const allocatedLocations = team.allocatedLocations ?? 0;

      if (action === 'scan') {
        const allocatedScans = team.allocatedScans ?? 0;
        const bonusScans = (team as any).bonusScans ?? 0;
        const effectiveMax = allocatedScans + bonusScans;
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const scanCount = await prisma.scanRecord.count({
          where: {
            location: { userId: team.id },
            source: { in: ['image', 'pdf'] },
            createdAt: { gte: thirtyDaysAgo },
          },
        });
        if (scanCount >= effectiveMax) {
          res.status(403).json({
            error: 'SCAN_LIMIT_REACHED',
            currentUsage: scanCount,
            monthlyLimit: allocatedScans,
            bonusScans,
            totalAvailable: effectiveMax,
            message: 'You have reached your scan limit.',
          });
          return;
        }
      }

      if (action === 'location' && allocatedLocations > 0) {
        const locationCount = await prisma.location.count({
          where: { userId: team.id },
        });
        if (locationCount >= allocatedLocations) {
          return next(new AppError(`Location limit reached (${allocatedLocations}). Contact your admin.`, 403));
        }
      }

      return next();
    }

    // Admin with pool — enforce pool totals across admin + managed members
    if (team.poolScans != null || team.poolLocations != null) {
      const managedMembers = await prisma.user.findMany({
        where: { managedById: team.id },
        select: { id: true },
      });
      const memberIds = managedMembers.map((member) => member.id);

      if (action === 'scan' && team.poolScans != null) {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const scanCount = await prisma.scanRecord.count({
          where: {
            location: {
              OR: [
                { adminId: team.id },
                ...(memberIds.length > 0 ? [{ userId: { in: memberIds } }] : []),
              ],
            },
            source: { in: ['image', 'pdf'] },
            createdAt: { gte: thirtyDaysAgo },
          },
        });
        const bonusScans = (team as any).bonusScans ?? 0;
        const effectivePoolScans = (team.poolScans ?? 0) + bonusScans;
        if (scanCount >= effectivePoolScans) {
          res.status(403).json({
            error: 'SCAN_LIMIT_REACHED',
            currentUsage: scanCount,
            monthlyLimit: team.poolScans ?? 0,
            bonusScans,
            totalAvailable: effectivePoolScans,
            message: 'You have reached your scan limit.',
          });
          return;
        }
      }

      if (action === 'location' && team.poolLocations != null) {
        const locationCount = await prisma.location.count({
          where: {
            OR: [
              { adminId: team.id },
              ...(memberIds.length > 0 ? [{ userId: { in: memberIds } }] : []),
            ],
          },
        });
        if (locationCount >= team.poolLocations) {
          return next(new AppError(`Team location limit reached (${team.poolLocations}). Contact the owner to increase your pool.`, 403));
        }
      }

      return next();
    }

    const limits = getEffectiveLimits(team);

    switch (action) {
      case 'user': {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const scanCount = await prisma.scanRecord.count({
          where: {
            location: { adminId: team.id },
            source: { in: ['image', 'pdf'] },
            createdAt: { gte: thirtyDaysAgo },
          },
        });

        const bonusScans = (team as any).bonusScans ?? 0;
        const monthlyLimit = limits.maxScans - bonusScans;
        const totalAvailable = limits.maxScans;
        if (scanCount >= totalAvailable) {
          res.status(403).json({
            error: 'SCAN_LIMIT_REACHED',
            currentUsage: scanCount,
            monthlyLimit,
            bonusScans,
            totalAvailable,
            message: 'You have reached your scan limit.',
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
