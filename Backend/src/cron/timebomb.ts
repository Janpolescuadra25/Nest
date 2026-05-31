import { PrismaClient } from '@prisma/client';
import { sendTrialExpired } from '../lib/email';

async function checkTrialExpiry(prisma: PrismaClient): Promise<void> {
  try {
    // Step 1 — Find ACTIVE users whose trial has expired
    const expiredUsers = await prisma.user.findMany({
      where: {
        trialExpiresAt: { not: null, lt: new Date() },
        status: 'ACTIVE',
      },
      select: { id: true, email: true, name: true, trialExpiresAt: true, role: true, customExpiryMessage: true },
    });

    if (expiredUsers.length === 0) return;

    // Step 2 — Bulk update: flip status + zero permissions
    await prisma.user.updateMany({
      where: { id: { in: expiredUsers.map(u => u.id) } },
      data: {
        status: 'EXPIRED',
        canScan: false,
        canMap: false,
        canSync: false,
        canManageLocs: false,
      },
    });

    // Step 3 — Write audit log entries + send expiry emails in parallel (allSettled so one failure doesn't block the other)
    await Promise.allSettled([
      Promise.all(
        expiredUsers.map(user =>
          prisma.auditLog.create({
            data: {
              actorId: user.id,
              targetUserId: user.id,
              action: 'TRIAL_EXPIRED',
              details: {
                previousRole: user.role,
                trialExpiresAt: user.trialExpiresAt,
                permissionsRevoked: ['canScan', 'canMap', 'canSync', 'canManageLocs'],
              },
            },
          })
        )
      ).catch((err) => console.error('[TimeBomb] Failed to write audit logs:', err)),
      ...expiredUsers.map(user =>
        sendTrialExpired({
          to: user.email,
          name: user.name,
          trialExpiresAt: user.trialExpiresAt,
          customExpiryMessage: user.customExpiryMessage,
        })
      ),
    ]);

    // Step 4 — Log result
    console.log(`[TimeBomb] Expired ${expiredUsers.length} trial user${expiredUsers.length !== 1 ? 's' : ''}`);
  } catch (err) {
    console.error('[TimeBomb] checkTrialExpiry error:', err);
  }
}

export function startTimeBombCron(prisma: PrismaClient): void {
  // Run immediately on startup
  checkTrialExpiry(prisma);
  checkTimeBombs(prisma);

  // Then every 60 minutes
  setInterval(() => {
    checkTrialExpiry(prisma);
    checkTimeBombs(prisma);
  }, 3_600_000);
}

async function checkTimeBombs(prisma: PrismaClient): Promise<void> {
  try {
    const now = new Date();

    // Find users whose timeBombAt has passed but are not already TIME_BOMBED/BLOCKED
    const detonatedUsers = await prisma.user.findMany({
      where: {
        timeBombAt: { not: null, lt: now },
        status: { notIn: ['TIME_BOMBED', 'BLOCKED', 'DISABLED'] },
      },
      select: {
        id: true,
        email: true,
        name: true,
        timeBombAt: true,
        gracePeriodHours: true,
        role: true,
      },
    });

    if (detonatedUsers.length === 0) return;

    for (const user of detonatedUsers) {
      if (!user.timeBombAt) continue;

      const gracePeriodEndsAt = new Date(
        user.timeBombAt.getTime() + user.gracePeriodHours * 3_600_000,
      );
      const isInGracePeriod = now < gracePeriodEndsAt;
      const newStatus = isInGracePeriod ? 'GRACE_PERIOD' : 'TIME_BOMBED';

      await prisma.user.update({
        where: { id: user.id },
        data: {
          status: newStatus,
          ...(isInGracePeriod ? {} : {
            canScan: false,
            canMap: false,
            canSync: false,
            canManageLocs: false,
          }),
        },
      });

      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          targetUserId: user.id,
          action: isInGracePeriod ? 'GRACE_PERIOD_STARTED' : 'TIMEBOMB_TRIGGERED',
          details: {
            role: user.role,
            timeBombAt: user.timeBombAt,
            gracePeriodHours: user.gracePeriodHours,
            gracePeriodEndsAt,
          },
        },
      });
    }

    console.log(`[TimeBomb] checkTimeBombs: processed ${detonatedUsers.length} user(s)`);
  } catch (err) {
    console.error('[TimeBomb] checkTimeBombs error:', err);
  }
}
