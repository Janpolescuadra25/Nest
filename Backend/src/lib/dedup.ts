import { createHash } from 'crypto';
import { Prisma, SyncType } from '@prisma/client';
import { prisma } from './prisma';

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const normalized: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) {
        normalized[key] = canonicalize(item);
      }
    }
    return normalized;
  }

  return value;
}

export function hashSyncRequest(syncType: SyncType, payload: unknown): string {
  const normalized = JSON.stringify(canonicalize(payload));
  return createHash('sha256').update(`${syncType}:${normalized}`, 'utf8').digest('hex');
}

export async function findDuplicateSync(
  userId: string,
  syncType: SyncType,
  requestHash: string,
) {
  return prisma.syncLog.findFirst({
    where: {
      userId,
      syncType,
      requestHash,
      status: 'SUCCESS',
    },
    orderBy: { syncedAt: 'desc' },
  });
}

export async function countSyncAttempts(
  userId: string,
  syncType: SyncType,
  requestHash: string,
) {
  return prisma.syncLog.count({
    where: {
      userId,
      syncType,
      requestHash,
    },
  });
}

export async function createSyncLogEntry(params: {
  userId: string;
  syncType: SyncType;
  scanRecordId?: string | null;
  qbJournalEntryId?: string | null;
  docNumber?: string | null;
  requestHash: string;
  status: 'SUCCESS' | 'FAILED';
  requestPayload: Prisma.JsonValue | null;
  attemptCount: number;
  errorMessage?: string | null;
  errorType?: string | null;
}) {
  const {
    userId,
    syncType,
    scanRecordId,
    qbJournalEntryId,
    docNumber,
    requestHash,
    status,
    requestPayload,
    attemptCount,
    errorMessage,
    errorType,
  } = params;

  return prisma.syncLog.create({
    data: {
      userId,
      syncType,
      scanRecordId,
      qbJournalEntryId,
      docNumber,
      requestHash,
      status,
      requestPayload: requestPayload as Prisma.InputJsonValue,
      attemptCount,
      errorMessage,
      errorType,
    },
  });
}
