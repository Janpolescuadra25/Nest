import { PrismaClient } from '@prisma/client';
import { processTrialExpiry, processTimeBombTransitions } from '../lib/team-status';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'TimeBomb' });

async function checkTrialExpiry(prisma: PrismaClient): Promise<void> {
  try {
    const expiredCount = await processTrialExpiry(prisma);
    if (expiredCount > 0) {
      log.info({ expiredCount }, 'Expired trial users');
    }
  } catch (err) {
    log.error({ err }, 'checkTrialExpiry error');
  }
}

export async function startTimeBombCron(prisma: PrismaClient): Promise<void> {
  // Run immediately on startup — sequential
  await checkTrialExpiry(prisma);
  await checkTimeBombs(prisma);

  // Then every 60 minutes — also sequential
  const interval = setInterval(async () => {
    await checkTrialExpiry(prisma);
    await checkTimeBombs(prisma);
  }, 3_600_000);
  interval.unref();
}

async function checkTimeBombs(prisma: PrismaClient): Promise<void> {
  try {
    const result = await processTimeBombTransitions(prisma);
    if (result.gracePeriodCount > 0) {
      log.info({ gracePeriodCount: result.gracePeriodCount }, 'Users entered grace period');
    }
    if (result.fullyExpiredCount > 0) {
      log.info({ fullyExpiredCount: result.fullyExpiredCount }, 'Users fully expired');
    }
  } catch (err) {
    log.error({ err }, 'checkTimeBombs error');
  }
}
