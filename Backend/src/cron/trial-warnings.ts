import { PrismaClient } from '@prisma/client';
import { processTrialWarnings } from '../lib/team-status';

async function checkTrialWarnings(prisma: PrismaClient): Promise<void> {
  try {
    const warningsSent = await processTrialWarnings(prisma);
    console.log(`[TrialWarnings] Sent ${warningsSent} warnings`);
  } catch (err) {
    console.error('[TrialWarnings] checkTrialWarnings error:', err);
  }
}

export function startTrialWarningCron(prisma: PrismaClient): void {
  checkTrialWarnings(prisma);
  setInterval(() => checkTrialWarnings(prisma), 21_600_000);
}
