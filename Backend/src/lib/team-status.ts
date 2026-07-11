import { PrismaClient, Prisma, UserRole, UserStatus } from '@prisma/client';
import { sendTrialExpired, sendTrialWarning } from './email';
import { UserForAccess } from '../middleware/effective-role';

const TRIAL_WARNING_THRESHOLDS = [7, 3, 1] as const;
const MS_PER_DAY = 86_400_000;

export function getGracePeriodEnd(timeBombAt: Date, gracePeriodHours: number): Date {
  return new Date(timeBombAt.getTime() + gracePeriodHours * 60 * 60 * 1000);
}

export function buildUserForAccess(user: {
  role: UserRole;
  status: UserStatus;
  blocked: boolean;
  timeBombAt: Date | string | null;
  gracePeriodHours: number;
  permissions: unknown;
}): UserForAccess {
  return {
    role: user.role,
    status: user.status,
    blocked: user.blocked,
    timeBombAt: user.timeBombAt,
    gracePeriodHours: user.gracePeriodHours,
    permissions: user.permissions,
  };
}

export async function processTrialExpiry(prisma: PrismaClient): Promise<number> {
  const now = new Date();

  const expiredUsers = await prisma.user.findMany({
    where: {
      trialExpiresAt: { not: null, lt: now },
      status: 'ACTIVE',
      subscriptionSource: { notIn: ['stripe', 'owner'] },
    },
    select: {
      id: true,
      email: true,
      name: true,
      trialExpiresAt: true,
      role: true,
      customExpiryMessage: true,
    },
  });

  if (expiredUsers.length === 0) {
    return 0;
  }

  await prisma.user.updateMany({
    where: { id: { in: expiredUsers.map((user) => user.id) } },
    data: {
      status: 'EXPIRED',
      canScan: false,
      canMap: false,
      canSync: false,
      canManageLocs: false,
    },
  });

  await Promise.allSettled([
    Promise.all(
      expiredUsers.map((user) =>
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
    ).catch((err) => console.error('[TeamStatus] Failed to write audit logs:', err)),
    ...expiredUsers.map((user) =>
      sendTrialExpired({
        to: user.email,
        name: user.name,
        trialExpiresAt: user.trialExpiresAt,
        customExpiryMessage: user.customExpiryMessage,
      }).then((result) => {
        if (!result?.success) {
          console.error(`[TeamStatus] Trial expired email failed for ${user.email}:`, result?.error ?? 'No result returned');
        }
      })
    ),
  ]);

  return expiredUsers.length;
}

export async function processTrialWarnings(prisma: PrismaClient): Promise<number> {
  const now = new Date();

  const users = await prisma.user.findMany({
    where: {
      trialExpiresAt: { not: null },
      status: 'ACTIVE',
      subscriptionSource: { notIn: ['stripe', 'owner'] },
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

    for (const threshold of TRIAL_WARNING_THRESHOLDS) {
      if (daysRemaining <= threshold && daysRemaining > 0) {
        const existing = await prisma.auditLog.findFirst({
          where: {
            targetUserId: user.id,
            action: 'TRIAL_EXPIRY_WARNING',
            details: { path: ['daysBefore'], equals: threshold },
          },
        });

        if (!existing) {
          await prisma.auditLog.create({
            data: {
              actorId: user.id,
              targetUserId: user.id,
              action: 'TRIAL_EXPIRY_WARNING',
              details: { daysBefore: threshold, daysRemaining: daysRemaining, trialExpiresAt: user.trialExpiresAt },
            },
          });
          warningsSent += 1;

          const emailResult = await sendTrialWarning({
            to: user.email,
            name: user.name,
            trialExpiresAt: user.trialExpiresAt,
            daysRemaining: threshold,
            customExpiryMessage: user.customExpiryMessage,
          });

          if (!emailResult?.success) {
            console.error('[TeamStatus] Trial warning email failed:', emailResult?.error ?? 'No result returned');
          }
        }
      }
    }
  }

  return warningsSent;
}

export async function processTimeBombTransitions(prisma: PrismaClient): Promise<{ gracePeriodCount: number; fullyExpiredCount: number }> {
  const now = new Date();

  const gracePeriodEntries = await prisma.user.findMany({
    where: {
      timeBombAt: { not: null, lte: now },
      status: 'ACTIVE',
      blocked: false,
      subscriptionSource: { notIn: ['stripe', 'owner'] },
    },
    select: {
      id: true,
      email: true,
      name: true,
      timeBombAt: true,
      role: true,
      gracePeriodHours: true,
    },
  });

  if (gracePeriodEntries.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: gracePeriodEntries.map((user) => user.id) } },
      data: { status: 'GRACE_PERIOD' },
    });

    await Promise.allSettled(
      gracePeriodEntries.map((user) =>
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
    ).catch((err) => console.error('[TeamStatus] Failed to write grace period audit logs:', err));
  }

  const graceExpiredUsers = await prisma.user.findMany({
    where: {
      status: 'GRACE_PERIOD',
      timeBombAt: { not: null },
      blocked: false,
      subscriptionSource: { notIn: ['stripe', 'owner'] },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      timeBombAt: true,
      gracePeriodHours: true,
    },
  });

  const fullyExpiredUsers = graceExpiredUsers.filter((user) => {
    if (!user.timeBombAt) return false;
    return now >= getGracePeriodEnd(user.timeBombAt, user.gracePeriodHours);
  });

  if (fullyExpiredUsers.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: fullyExpiredUsers.map((user) => user.id) } },
      data: { status: 'TIME_BOMBED' },
    });

    await Promise.allSettled(
      fullyExpiredUsers.map((user) =>
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
    ).catch((err) => console.error('[TeamStatus] Failed to write time bomb expiry audit logs:', err));
  }

  return {
    gracePeriodCount: gracePeriodEntries.length,
    fullyExpiredCount: fullyExpiredUsers.length,
  };
}
