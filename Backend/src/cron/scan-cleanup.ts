import { PrismaClient } from '@prisma/client';
import { deleteFile } from '../lib/storage';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'ScanCleanup' });

async function cleanupScanHistory(prisma: PrismaClient): Promise<void> {
  const users = await prisma.user.findMany({
    where: { scanHistoryDays: { not: null } },
    select: { id: true, scanHistoryDays: true },
  });

  let totalDeleted = 0;

  for (const user of users) {
    if (!user.scanHistoryDays) continue;

    try {
      const locationCount = await prisma.location.count({ where: { adminId: user.id } });
      if (locationCount === 0) continue;

      const cutoff = new Date(Date.now() - user.scanHistoryDays * 24 * 60 * 60 * 1000);
      const scansToDelete = await prisma.scanRecord.findMany({
        where: {
          createdAt: { lt: cutoff },
          location: { adminId: user.id },
        },
        select: { id: true },
      });

      const scanIds = scansToDelete.map((s) => s.id);
      const attachments = await prisma.attachment.findMany({
        where: { scanRecordId: { in: scanIds } },
        select: { storageKey: true },
      });

      for (const att of attachments) {
        try {
          await deleteFile(att.storageKey);
        } catch (err) {
          log.error({ err, storageKey: att.storageKey }, 'Failed to delete file from R2');
        }
      }

      const result = await prisma.scanRecord.deleteMany({
        where: {
          createdAt: { lt: cutoff },
          location: { adminId: user.id },
        },
      });

      if (result.count > 0) {
        log.info({ count: result.count, userId: user.id, cutoff: cutoff.toISOString() }, 'Deleted scan(s) older than cutoff');
        totalDeleted += result.count;
      }
    } catch (err) {
      log.error({ err, userId: user.id }, 'User cleanup failed');
    }
  }

  if (totalDeleted > 0) {
    log.info({ totalDeleted }, 'Total deleted stale scans');
  }
}

export async function startScanCleanupCron(prisma: PrismaClient): Promise<void> {
  await cleanupScanHistory(prisma);

  const interval = setInterval(async () => {
    await cleanupScanHistory(prisma);
  }, 86_400_000);
  interval.unref();
}
