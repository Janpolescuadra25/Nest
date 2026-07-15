import { PrismaClient } from '@prisma/client';

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
      const result = await prisma.scanRecord.deleteMany({
        where: {
          createdAt: { lt: cutoff },
          location: { adminId: user.id },
        },
      });

      if (result.count > 0) {
        console.log(`[ScanCleanup] Deleted ${result.count} scan(s) for user ${user.id} older than ${cutoff.toISOString()}`);
        totalDeleted += result.count;
      }
    } catch (err) {
      console.error(`[ScanCleanup] user ${user.id} cleanup error:`, err);
    }
  }

  if (totalDeleted > 0) {
    console.log(`[ScanCleanup] Total deleted ${totalDeleted} stale scans`);
  }
}

export async function startScanCleanupCron(prisma: PrismaClient): Promise<void> {
  await cleanupScanHistory(prisma);

  const interval = setInterval(async () => {
    await cleanupScanHistory(prisma);
  }, 86_400_000);
  interval.unref();
}
