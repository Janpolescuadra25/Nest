import { PrismaClient } from '@prisma/client';
import { processTrialWarnings } from '../lib/team-status';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'TrialWarnings' });

async function checkTrialWarnings(prisma: PrismaClient): Promise<void> {
  try {
    const warningsSent = await processTrialWarnings(prisma);
    log.info({ warningsSent }, 'Sent warnings');
  } catch (err) {
    log.error({ err }, 'checkTrialWarnings error');
  }
}

export function startTrialWarningCron(prisma: PrismaClient): void {
  checkTrialWarnings(prisma);
  const interval = setInterval(() => checkTrialWarnings(prisma), 21_600_000);
  interval.unref();
}
