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

    // Step 1 — Users whose timeBombAt has been reached but status is still ACTIVE
    const gracePeriodEntries = await prisma.user.findMany({
      where: {
        timeBombAt: { not: null, lte: now },
        status: 'ACTIVE',
        blocked: false,
      },
      select: { id: true, email: true, name: true, timeBombAt: true, role: true, gracePeriodHours: true },
    });

    if (gracePeriodEntries.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: gracePeriodEntries.map(u => u.id) } },
        data: { status: 'GRACE_PERIOD' },
      });

      await Promise.allSettled(
        gracePeriodEntries.map(user =>
          prisma.auditLog.create({
            data: {
              actorId: user.id,
              targetUserId: user.id,
              action: 'STATUS_CHANGE',
              details: {
                previousStatus: 'ACTIVE',
                newStatus: 'GRACE_PERIOD',
                trigger: 'timeBombAt reached',
                timeBombAt: user.timeBombAt,
                gracePeriodHours: user.gracePeriodHours,
              },
            },
          })
        )
      );

      console.log(`[TimeBomb] ${gracePeriodEntries.length} user(s) entered grace period`);
    }

    // Step 2 — Users in GRACE_PERIOD whose grace period has expired
    const graceExpired = await prisma.user.findMany({
      where: {
        status: 'GRACE_PERIOD',
        timeBombAt: { not: null },
        blocked: false,
      },
      select: { id: true, email: true, name: true, timeBombAt: true, role: true, gracePeriodHours: true },
    });

    const fullyExpired = graceExpired.filter(user => {
      if (!user.timeBombAt) return false;
      const graceEnd = new Date(
        new Date(user.timeBombAt).getTime() + (user.gracePeriodHours * 60 * 60 * 1000)
      );
      return now >= graceEnd;
    });

    if (fullyExpired.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: fullyExpired.map(u => u.id) } },
        data: { status: 'TIME_BOMBED' },
      });

      await Promise.allSettled(
        fullyExpired.map(user =>
          prisma.auditLog.create({
            data: {
              actorId: user.id,
              targetUserId: user.id,
              action: 'STATUS_CHANGE',
              details: {
                previousStatus: 'GRACE_PERIOD',
                newStatus: 'TIME_BOMBED',
                trigger: 'grace period expired',
                timeBombAt: user.timeBombAt,
                gracePeriodHours: user.gracePeriodHours,
                previousRole: user.role,
                effectiveRole: 'VIEWER',
              },
            },
          })
        )
      );

      console.log(`[TimeBomb] ${fullyExpired.length} user(s) fully expired (TIME_BOMBED)`);
    }
  } catch (err) {
    console.error('[TimeBomb] checkTimeBombs error:', err);
  }
}
