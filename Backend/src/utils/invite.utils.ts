
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { UserRole } from '@prisma/client';

export interface InviteLinkWithCreator {
  id: string;
  token: string;
  createdBy: string;
  roleHint: UserRole | null;
  expiresAt: Date;
  usedAt: Date | null;
  maxUses: number;
  useCount: number;
  createdAt: Date;
  creator: {
    id: string;
    role: UserRole;
    status: string;
    adminId: string | null;
  };
}

export class InviteError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'EXPIRED' | 'MAX_USES_REACHED' | 'ALREADY_USED',
    message: string,
  ) {
    super(message);
    this.name = 'InviteError';
  }
}

/**
 * Create a new invite link.
 * Returns the full InviteLink record including the plaintext token.
 * Callers MUST check maxUsers BEFORE calling this.
 */
export async function createInviteLink(params: {
  createdBy: string;
  roleHint?: UserRole;
  maxUses?: number;
  expiresInHours?: number;
}) {
  const token = crypto.randomUUID();
  const expiresInHours = params.expiresInHours ?? 72;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
  return prisma.inviteLink.create({
    data: {
      token,
      createdBy: params.createdBy,
      roleHint: params.roleHint ?? 'VIEWER',
      expiresAt,
      maxUses: params.maxUses ?? 1,
    },
  });
}

/**
 * Validate an invite link for consumption.
 * Returns the invite with creator info if valid.
 * Throws InviteError if invalid.
 */
export async function validateInviteLink(token: string): Promise<InviteLinkWithCreator> {
  const invite = await prisma.inviteLink.findUnique({
    where: { token },
    include: {
      creator: {
        select: { id: true, role: true, status: true, adminId: true },
      },
    },
  });

  if (!invite) {
    throw new InviteError('NOT_FOUND', 'Invite link not found');
  }
  if (new Date() > invite.expiresAt) {
    throw new InviteError('EXPIRED', 'Invite link has expired');
  }
  if (invite.maxUses > 0 && invite.useCount >= invite.maxUses) {
    throw new InviteError('MAX_USES_REACHED', 'Invite link has reached its maximum number of uses');
  }
  if (invite.maxUses === 1 && invite.usedAt) {
    throw new InviteError('ALREADY_USED', 'Invite link has already been used');
  }

  return invite as InviteLinkWithCreator;
}
