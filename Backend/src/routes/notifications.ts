import { Router, Response } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware';
import { asyncHandler } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { validate } from '../middleware/validate';
import { notificationPreferencesSchema } from '../lib/validators';
import { validate } from '../middleware/validate';
import { notificationPreferencesSchema } from '../lib/validators';

const router = Router();
router.use(authenticate);

router.get('/preferences', asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  let prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
  if (!prefs) {
    prefs = await prisma.notificationPreference.create({
      data: { userId },
    });
  }

  return res.json({
    syncFailureAlerts: prefs.syncFailureAlerts,
    quotaWarningAlerts: prefs.quotaWarningAlerts,
    teamChangeAlerts: prefs.teamChangeAlerts,
  });
}));

router.put('/preferences', validate(notificationPreferencesSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { syncFailureAlerts, quotaWarningAlerts, teamChangeAlerts } = req.body as {
    syncFailureAlerts?: boolean;
    quotaWarningAlerts?: boolean;
    teamChangeAlerts?: boolean;
  };

  const prefs = await prisma.notificationPreference.upsert({
    where: { userId },
    update: {
      ...(typeof syncFailureAlerts === 'boolean' ? { syncFailureAlerts } : {}),
      ...(typeof quotaWarningAlerts === 'boolean' ? { quotaWarningAlerts } : {}),
      ...(typeof teamChangeAlerts === 'boolean' ? { teamChangeAlerts } : {}),
    },
    create: {
      userId,
      syncFailureAlerts: typeof syncFailureAlerts === 'boolean' ? syncFailureAlerts : true,
      quotaWarningAlerts: typeof quotaWarningAlerts === 'boolean' ? quotaWarningAlerts : true,
      teamChangeAlerts: typeof teamChangeAlerts === 'boolean' ? teamChangeAlerts : true,
    },
  });

  return res.json({
    syncFailureAlerts: prefs.syncFailureAlerts,
    quotaWarningAlerts: prefs.quotaWarningAlerts,
    teamChangeAlerts: prefs.teamChangeAlerts,
  });
}));

export { router as notificationRoutes };
