import { PrismaClient } from '@prisma/client';
import { processTrialExpiry, processTimeBombTransitions } from '../lib/team-status';

async function checkTrialExpiry(prisma: PrismaClient): Promise<void> {
  try {
    const expiredCount = await processTrialExpiry(prisma);
    if (expiredCount > 0) {
      console.log(`[TimeBomb] Expired ${expiredCount} trial user${expiredCount !== 1 ? 's' : ''}`);
    }
  } catch (err) {
    console.error('[TimeBomb] checkTrialExpiry error:', err);
  }
}

export function startTimeBombCron(prisma: PrismaClient): void {
  // Run immediately on startup
  checkTrialExpiry(prisma);
  checkTimeBombs(prisma);

  // Then every 60 minutes
  const interval = setInterval(() => {
    checkTrialExpiry(prisma);
    checkTimeBombs(prisma);
  }, 3_600_000);
  interval.unref();
}

async function checkTimeBombs(prisma: PrismaClient): Promise<void> {
  try {
    const result = await processTimeBombTransitions(prisma);
    if (result.gracePeriodCount > 0) {
      console.log(`[TimeBomb] ${result.gracePeriodCount} user(s) entered grace period`);
    }
    if (result.fullyExpiredCount > 0) {
      console.log(`[TimeBomb] ${result.fullyExpiredCount} user(s) fully expired (TIME_BOMBED)`);
    }
  } catch (err) {
    console.error('[TimeBomb] checkTimeBombs error:', err);
  }
}
