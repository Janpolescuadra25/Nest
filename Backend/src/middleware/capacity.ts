import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { PLANS, type PlanKey, getPlanLimits } from '../lib/stripe';
import { AuthRequest } from './auth.middleware';

type CapacityAction = 'user' | 'location' | 'scan' | 'template';

function getStartOfWeek(): Date {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Shift to Monday
  return new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);
}

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
      maxTemplates: premiumLimits.maxTemplates,
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
      maxTemplates: PLANS[team.currentPlan as PlanKey]?.maxTemplates ?? PLANS.free.maxTemplates,
      scanHistoryDays: team.scanHistoryDays ?? PLANS.free.scanHistoryDays,
      prioritySupport: team.prioritySupport ?? false,
    };
  }

  // Free tier / owner / expired trial → Free limits
  return {
    maxUsers: PLANS.free.maxUsers,
    maxLocations: PLANS.free.maxLocations,
    maxScans: PLANS.free.maxScans + (team.bonusScans ?? 0),
    maxTemplates: PLANS.free.maxTemplates,
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
          poolTemplates: true,
          allocatedScans: true,
          allocatedLocations: true,
          allocatedTemplates: true,
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
        const bonusScans = team.bonusScans ?? 0;
        const effectiveMax = allocatedScans + bonusScans;
        const weekStart = getStartOfWeek();
        const scanCount = await prisma.scanRecord.count({
          where: {
            location: { userId: team.id },
            source: { in: ['pos', 'excel', 'image'] },
            createdAt: { gte: weekStart },
          },
        });
        if (scanCount >= effectiveMax) {
          res.status(403).json({
            error: 'SCAN_LIMIT_REACHED',
            currentUsage: scanCount,
            weeklyLimit: allocatedScans,
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

      if (action === 'template') {
        const allocatedTemplates = team.allocatedTemplates ?? 0;
        if (allocatedTemplates > 0) {
          const templateCount = await prisma.template.count({
            where: { location: { userId: team.id } },
          });
          if (templateCount >= allocatedTemplates) {
            res.status(403).json({
              error: 'TEMPLATE_LIMIT_REACHED',
              currentUsage: templateCount,
              limit: allocatedTemplates,
              message: `Template limit reached (${allocatedTemplates}). Contact your admin.`,
            });
            return;
          }
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
        const weekStart = getStartOfWeek();
        const scanCount = await prisma.scanRecord.count({
          where: {
            location: {
              OR: [
                { adminId: team.id },
                ...(memberIds.length > 0 ? [{ userId: { in: memberIds } }] : []),
              ],
            },
            source: { in: ['pos', 'excel', 'image'] },
            createdAt: { gte: weekStart },
          },
        });
        const bonusScans = team.bonusScans ?? 0;
        const effectivePoolScans = (team.poolScans ?? 0) + bonusScans;
        if (scanCount >= effectivePoolScans) {
          res.status(403).json({
            error: 'SCAN_LIMIT_REACHED',
            currentUsage: scanCount,
            weeklyLimit: team.poolScans ?? 0,
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

      if (action === 'template' && team.poolTemplates != null) {
        const templateCount = await prisma.template.count({
          where: {
            OR: [
              { location: { adminId: team.id } },
              ...(memberIds.length > 0 ? [{ location: { userId: { in: memberIds } } }] : []),
            ],
          },
        });
        const poolTemplates = team.poolTemplates ?? 0;
        if (templateCount >= poolTemplates) {
          res.status(403).json({
            error: 'TEMPLATE_POOL_EXCEEDED',
            currentUsage: templateCount,
            limit: poolTemplates,
            message: `Team template limit reached (${poolTemplates}). Contact the owner to increase your pool.`,
          });
          return;
        }
      }

      return next();
    }

    const limits = getEffectiveLimits(team);

    switch (action) {
      case 'user': {
        const memberCount = await prisma.user.count({
          where: { adminId: team.id, status: { not: 'DISABLED' } },
        });
        if (memberCount >= limits.maxUsers) {
          res.status(403).json({
            error: 'USER_LIMIT_REACHED',
            currentUsage: memberCount,
            limit: limits.maxUsers,
            message: `You have reached your team member limit (${limits.maxUsers}).`,
          });
          return;
        }
        return next();
      }
      case 'scan': {
        const weekStart = getStartOfWeek();
        const scanCount = await prisma.scanRecord.count({
          where: {
            location: { adminId: team.id },
            source: { in: ['pos', 'excel', 'image'] },
            createdAt: { gte: weekStart },
          },
        });
        const bonusScans = team.bonusScans ?? 0;
        const weeklyLimit = limits.maxScans - bonusScans;
        const totalAvailable = limits.maxScans;
        if (scanCount >= totalAvailable) {
          res.status(403).json({
            error: 'SCAN_LIMIT_REACHED',
            currentUsage: scanCount,
            weeklyLimit,
            bonusScans,
            totalAvailable,
            message: 'You have reached your scan limit.',
          });
          return;
        }
        return next();
      }
      case 'location': {
        const locationCount = await prisma.location.count({
          where: { adminId: team.id },
        });
        if (locationCount >= limits.maxLocations) {
          res.status(403).json({
            error: 'LOCATION_LIMIT_REACHED',
            currentUsage: locationCount,
            limit: limits.maxLocations,
            message: `You have reached your location limit (${limits.maxLocations}).`,
          });
          return;
        }
        return next();
      }
      case 'template': {
        const templateCount = await prisma.template.count({
          where: { location: { adminId: team.id } },
        });
        if (templateCount >= limits.maxTemplates) {
          res.status(403).json({
            error: 'TEMPLATE_LIMIT_REACHED',
            currentUsage: templateCount,
            limit: limits.maxTemplates,
            message: `Template limit reached (${limits.maxTemplates}). Upgrade your plan for more templates.`,
          });
          return;
        }
        return next();
      }
      default:
        return next();
    }
  } catch (err) {
    next(err);
  }
  };
}
