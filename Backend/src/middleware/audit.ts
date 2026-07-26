import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

type AuditAction =
  | 'USER_CREATED'
  | 'ROLE_CHANGE'
  | 'STATUS_CHANGE'
  | 'TIME_BOMB_SET'
  | 'TIME_BOMB_CLEARED'
  | 'USER_BLOCKED'
  | 'USER_UNBLOCKED'
  | 'USER_DELETED'
  | 'APPROVAL_GRANTED'
  | 'APPROVAL_REJECTED'
  | 'PERMISSION_OVERRIDE'
  | 'OWNER_TRANSFER'
  | 'USER_LIMIT_SET'
  | 'INVITE_CREATED'
  | 'INVITE_USED'
  | 'INVITE_REVOKED'
  | 'ADMIN_UPDATED'
  | 'ADMIN_APPROVED'
  | 'ADMIN_REJECTED'
  | 'USER_INVITED'
  | 'USER_DISABLED'
  | 'TRIAL_EXPIRED'
  | 'TRIAL_RESET'
  | 'TRIAL_EXPIRY_WARNING'
  | 'OWNER_RESET_TRIAL'
  | 'PASSWORD_RESET'
  | 'EMAIL_VERIFIED'
  | 'CANX_RESET'
  | 'PERMISSIONS_RESET'
  | 'SYNC_FAILURE_ALERT'
  | 'DRAFT_SUBMITTED'
  | 'DRAFT_APPROVED'
  | 'DRAFT_REJECTED'
  | 'ATTACHMENT_UPLOADED'
  | 'ATTACHMENT_AUTO_ATTACHED'
  | 'ATTACHMENT_FAILED';

export async function logAction(params: {
  actorId: string;
  action: AuditAction;
  targetUserId?: string;
  details?: Prisma.InputJsonValue | null;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        targetUserId: params.targetUserId ?? null,
        details: params.details ?? undefined,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
  } catch (err: unknown) {
    console.error('[Audit] Failed to log action:', params.action, err);
    // Audit logging should never block the main operation
  }
}
