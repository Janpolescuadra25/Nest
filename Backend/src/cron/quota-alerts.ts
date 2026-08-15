import { PrismaClient } from '@prisma/client';
import { sendQuotaWarning } from '../lib/email';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startQuotaAlertCron(prisma: PrismaClient): void {
  checkQuotaAlerts(prisma);
  const interval = setInterval(() => checkQuotaAlerts(prisma), CHECK_INTERVAL_MS);
  interval.unref();
}

async function checkQuotaAlerts(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  try {
    const teamLeads = await prisma.user.findMany({
      where: { adminId: null, status: 'ACTIVE' },
      select: { id: true, email: true, name: true, maxStorageBytes: true },
    });

    for (const lead of teamLeads) {
      if (lead.maxStorageBytes == null) continue;
      const userIds = [lead.id];
      const managedUsers = await prisma.user.findMany({ where: { adminId: lead.id }, select: { id: true } });
      userIds.push(...managedUsers.map((user) => user.id));

      const locationIds = await prisma.location.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
      const locationIdList = locationIds.map((loc) => loc.id);
      if (locationIdList.length === 0) continue;

      const [scanAttachmentSum, locationAttachmentSum] = await Promise.all([
        prisma.attachment.aggregate({
          _sum: { fileSize: true },
          where: { scanRecord: { locationId: { in: locationIdList } } },
        }),
        prisma.locationAttachment.aggregate({
          _sum: { fileSize: true },
          where: { locationId: { in: locationIdList } },
        }),
      ]);

      const totalStorage = (scanAttachmentSum._sum.fileSize ?? 0) + (locationAttachmentSum._sum.fileSize ?? 0);
      const percentage = lead.maxStorageBytes > 0 ? (totalStorage / lead.maxStorageBytes) * 100 : 0;
      if (percentage < 80) continue;

      const prefs = await prisma.notificationPreference.findUnique({ where: { userId: lead.id } });
      if (prefs && !prefs.quotaWarningAlerts) continue;

      const lastAlert = await prisma.auditLog.findFirst({
        where: {
          targetUserId: lead.id,
          action: 'QUOTA_WARNING',
        },
        orderBy: { createdAt: 'desc' },
      });
      if (lastAlert && new Date(lastAlert.createdAt).getTime() > now.getTime() - MS_PER_DAY) {
        continue;
      }

      if (!lead.email) continue;
      const emailResult = await sendQuotaWarning({
        to: lead.email,
        name: lead.name ?? lead.email,
        currentUsage: totalStorage,
        maxStorage: lead.maxStorageBytes,
        percentage,
      });

      if (emailResult.success) {
        await prisma.auditLog.create({
          data: {
            actorId: lead.id,
            targetUserId: lead.id,
            action: 'QUOTA_WARNING',
            details: {
              currentUsage: totalStorage,
              maxStorageBytes: lead.maxStorageBytes,
              percentage: Math.round(percentage),
            },
          },
        });
      }
    }
  } catch (err) {
    console.error('[quota-alerts] Error checking storage quotas:', err);
  }
}
