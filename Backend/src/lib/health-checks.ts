import { prisma } from './prisma';
import { verifyStorageBucketAccessible } from './storage';

export interface HealthComponentStatus {
  component: string;
  status: 'ok' | 'error';
  details?: string;
}

export interface HealthCheckResult {
  ok: boolean;
  checks: HealthComponentStatus[];
}

export async function runReadinessChecks(): Promise<HealthCheckResult> {
  const checks: HealthComponentStatus[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ component: 'database', status: 'ok' });
  } catch (err: unknown) {
    checks.push({
      component: 'database',
      status: 'error',
      details: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await verifyStorageBucketAccessible();
    checks.push({ component: 'storage', status: 'ok' });
  } catch (err: unknown) {
    checks.push({
      component: 'storage',
      status: 'error',
      details: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    ok: checks.every((check) => check.status === 'ok'),
    checks,
  };
}
