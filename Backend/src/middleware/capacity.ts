import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { isSoloPlan } from '../lib/stripe';
import { AuthRequest } from './auth.middleware';

type CapacityAction = 'user' | 'location';

export function requireCapacity(action: CapacityAction) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const teamId = req.user!.adminId ?? req.user!.userId;
    const team = await prisma.user.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        subscriptionSource: true,
        currentPlan: true,
        maxUsers: true,
        maxLocations: true,
      },
    });

    if (!team) {
      return next(new AppError('Team not found', 404));
    }

    if (team.subscriptionSource !== 'stripe' || !team.currentPlan) {
      return next();
    }

    switch (action) {
      case 'user': {
        if (isSoloPlan(team.currentPlan)) {
          return next(new AppError('Solo plan is limited to 1 user. Upgrade to Starter for team features.', 403));
        }

        if (team.maxUsers != null) {
          const currentCount = await prisma.user.count({ where: { adminId: team.id } });
          if (currentCount >= team.maxUsers) {
            return next(
              new AppError(
                `Your plan (${team.currentPlan}) allows up to ${team.maxUsers} users. Upgrade to add more.`,
                403
              )
            );
          }
        }

        break;
      }

      case 'location': {
        if (team.maxLocations != null) {
          const currentCount = await prisma.location.count({
            where: {
              OR: [{ adminId: team.id }, { userId: team.id }],
            },
          });
          if (currentCount >= team.maxLocations) {
            return next(
              new AppError(
                `Location limit reached (${team.maxLocations}). Upgrade your plan for more locations.`,
                403
              )
            );
          }
        }
        break;
      }
    }

    next();
  };
}
