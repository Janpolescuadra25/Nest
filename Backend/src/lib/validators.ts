import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const adminRequestSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  company: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

export const passwordResetVerifySchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

export const teamInviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['ACCOUNTANT', 'STAFF', 'VIEWER']),
});

export const patchTeamMemberSchema = z.object({
  role: z.enum(['ACCOUNTANT', 'STAFF', 'VIEWER']).optional(),
  canScan: z.boolean().optional(),
  canMap: z.boolean().optional(),
  canSync: z.boolean().optional(),
  canManageLocs: z.boolean().optional(),
  trialExpiresAt: z.string().min(1).optional().nullable(),
  customExpiryMessage: z.string().max(500).optional().nullable(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});
