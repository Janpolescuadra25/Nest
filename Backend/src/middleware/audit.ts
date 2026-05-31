// Centralized audit logging helper for the Nest backend
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export type AuditAction =
  | 'TRIAL_EXPIRED'
  | 'TRIAL_EXPIRY_WARNING'
  | 'TRIAL_RESET'
  | 'USER_INVITED'
  | 'USER_DISABLED'
  | 'USER_STATUS_CHANGED'
  | 'ROLE_CHANGED'
  | 'PERMISSION_UPDATED'
  | 'TIMEBOMB_SET'
  | 'TIMEBOMB_TRIGGERED'
  | 'GRACE_PERIOD_ENDED'
  | 'ADMIN_UPDATED'
  | 'ADMIN_APPROVED'
  | 'ADMIN_REJECTED'
  | 'PASSWORD_RESET'
  | 'INVITE_CREATED'
  | 'INVITE_USED'
  | 'USER_BLOCKED'
  | 'USER_UNBLOCKED'
  | 'PERMISSIONS_OVERRIDDEN';

interface LogActionParams {
  actorId: string;
  action: AuditAction | string;  // string allows legacy callers to pass their own names
  targetUserId?: string | null;
  details?: Prisma.InputJsonValue | null;
}

/**
 * Writes a single audit log entry.
 * Never throws — logs errors to console and resolves silently.
 */
export async function logAction({ actorId, action, targetUserId, details }: LogActionParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId,
        action,
        targetUserId: targetUserId ?? null,
        details: details ?? null,
      },
    });
  } catch (err) {
    console.error('[Audit] Failed to write audit log:', { actorId, action, targetUserId }, err);
  }
}
