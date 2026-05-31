import { PrismaClient } from '@prisma/client';
import { sendTrialWarning } from '../lib/email';

const THRESHOLDS = [7, 3, 1] as const;
const MS_PER_DAY = 86_400_000;

async function checkTrialWarnings(prisma: PrismaClient): Promise<void> {
  try {
    const now = new Date();

    const users = await prisma.user.findMany({
      where: {
        trialExpiresAt: { not: null },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        email: true,
        name: true,
        trialExpiresAt: true,
        customExpiryMessage: true,
      },
    });

    let warningsSent = 0;

    for (const user of users) {
      if (!user.trialExpiresAt) continue;

      const daysRemaining = Math.ceil((user.trialExpiresAt.getTime() - now.getTime()) / MS_PER_DAY);

      for (const threshold of THRESHOLDS) {
        if (daysRemaining <= threshold && daysRemaining > 0) {
          // Check if this warning was already sent
          const existing = await prisma.auditLog.findFirst({
            where: {
              targetUserId: user.id,
              action: 'TRIAL_EXPIRY_WARNING',
              details: { path: ['daysBefore'], equals: threshold },
            },
          });

          if (!existing) {
            // Fire-and-forget email (sendTrialWarning has internal catch)
            sendTrialWarning({
              to: user.email,
              name: user.name,
              trialExpiresAt: user.trialExpiresAt,
              daysRemaining: threshold,
              customExpiryMessage: user.customExpiryMessage,
            });

            // Write audit log to prevent re-sending
            await prisma.auditLog.create({
              data: {
                actorId: user.id,
                targetUserId: user.id,
                action: 'TRIAL_EXPIRY_WARNING',
                details: { daysBefore: threshold, daysRemaining, trialExpiresAt: user.trialExpiresAt },
              },
            });

            warningsSent++;
          }
        }
      }
    }

    console.log(`[TrialWarnings] Sent ${warningsSent} warnings (${users.length} users checked)`);
  } catch (err) {
    console.error('[TrialWarnings] checkTrialWarnings error:', err);
  }
}

export function startTrialWarningCron(prisma: PrismaClient): void {
  checkTrialWarnings(prisma);
  setInterval(() => checkTrialWarnings(prisma), 21_600_000);
}
