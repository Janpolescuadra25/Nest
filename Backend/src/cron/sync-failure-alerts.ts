import { PrismaClient } from '@prisma/client';
import { sendSyncFailureAlert } from '../lib/email';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MS_PER_DAY = 86_400_000;

export function startSyncFailureAlertCron(prisma: PrismaClient): void {
  checkSyncFailures(prisma);
  const interval = setInterval(() => checkSyncFailures(prisma), CHECK_INTERVAL_MS);
  interval.unref();
}

async function checkSyncFailures(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - MS_PER_DAY);

  try {
    const staleScans = await prisma.scanRecord.findMany({
      where: {
        status: { in: ['PENDING', 'MAPPED'] },
        scanDate: { lt: oneDayAgo },
      },
      include: {
        location: {
          include: {
            user: {
              select: {
                id: true,
                adminId: true,
                email: true,
                name: true,
                status: true,
              },
            },
          },
        },
      },
    });

    const failedScans = await prisma.scanRecord.findMany({
      where: { status: 'FAILED' },
      include: {
        location: {
          include: {
            user: {
              select: {
                id: true,
                adminId: true,
                email: true,
                name: true,
                status: true,
              },
            },
          },
        },
        syncLogs: {
          orderBy: { syncedAt: 'desc' },
        },
      },
    });

    const teamLeadMap = new Map<string, {
      email: string;
      name: string | null;
      staleCount: number;
      maxRetriedCount: number;
      oldFailureCount: number;
    }>();

    const userCache = new Map<string, { id: string; email: string; name: string | null } | null>();

    async function resolveTeamLead(userId: string, adminId: string | null): Promise<{ id: string; email: string; name: string | null } | null> {
      const teamLeadId = adminId ?? userId;
      if (userCache.has(teamLeadId)) return userCache.get(teamLeadId) ?? null;
      const user = await prisma.user.findUnique({
        where: { id: teamLeadId },
        select: { id: true, email: true, name: true, status: true },
      });
      if (!user || user.status !== 'ACTIVE') {
        userCache.set(teamLeadId, null);
        return null;
      }
      const result = { id: user.id, email: user.email, name: user.name };
      userCache.set(teamLeadId, result);
      return result;
    }

    for (const scan of staleScans) {
      const user = scan.location.user;
      const lead = await resolveTeamLead(user.id, user.adminId);
      if (!lead) continue;

      const entry = teamLeadMap.get(lead.id) ?? {
        email: lead.email,
        name: lead.name,
        staleCount: 0,
        maxRetriedCount: 0,
        oldFailureCount: 0,
      };
      entry.staleCount += 1;
      teamLeadMap.set(lead.id, entry);
    }

    for (const scan of failedScans) {
      const user = scan.location.user;
      const lead = await resolveTeamLead(user.id, user.adminId);
      if (!lead) continue;

      const entry = teamLeadMap.get(lead.id) ?? {
        email: lead.email,
        name: lead.name,
        staleCount: 0,
        maxRetriedCount: 0,
        oldFailureCount: 0,
      };

      const latestLog = scan.syncLogs?.[0];
      if (latestLog?.attemptCount >= 3) {
        entry.maxRetriedCount += 1;
      } else if (latestLog && (now.getTime() - new Date(latestLog.syncedAt).getTime()) > MS_PER_DAY) {
        entry.oldFailureCount += 1;
      }

      teamLeadMap.set(lead.id, entry);
    }

    for (const [leadId, data] of teamLeadMap.entries()) {
      const total = data.staleCount + data.maxRetriedCount + data.oldFailureCount;
      if (total === 0) continue;

      const lastAlert = await prisma.auditLog.findFirst({
        where: { targetUserId: leadId, action: 'SYNC_FAILURE_ALERT' },
        orderBy: { createdAt: 'desc' },
      });

      if (lastAlert && new Date(lastAlert.createdAt).getTime() > now.getTime() - COOLDOWN_MS) {
        continue;
      }

      const dashboardLink = process.env.APP_URL
        ? `${process.env.APP_URL}/dashboard`
        : 'https://nestapp.io/dashboard';

      const emailResult = await sendSyncFailureAlert({
        to: data.email,
        name: data.name,
        staleCount: data.staleCount,
        maxRetriedCount: data.maxRetriedCount,
        oldFailureCount: data.oldFailureCount,
        dashboardLink,
      });
      if (!emailResult.success) {
        console.error('[sync-failure-alerts] sendSyncFailureAlert failed:', emailResult.error);
      }

      if (emailResult.success) {
        await prisma.auditLog.create({
          data: {
            actorId: leadId,
            targetUserId: leadId,
            action: 'SYNC_FAILURE_ALERT',
            details: {
              staleCount: data.staleCount,
              maxRetriedCount: data.maxRetriedCount,
              oldFailureCount: data.oldFailureCount,
              totalScans: total,
            },
          },
        });
      }
    }
  } catch (error) {
    console.error('[sync-failure-alerts] Error checking sync failures:', error);
  }
}
