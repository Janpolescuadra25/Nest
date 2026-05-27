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

export const journalEntrySchema = z.object({
  txnDate: z.string().min(1, 'Transaction date is required'),
  lines: z.array(z.object({
    amount: z.number().positive('Amount must be positive'),
    postingType: z.enum(['Debit', 'Credit']),
    accountRef: z.object({
      value: z.string().min(1, 'Account value is required'),
      name: z.string().optional(),
    }),
    description: z.string().optional(),
    classRef: z.object({
      value: z.string().optional(),
      name: z.string().optional(),
    }).optional(),
    departmentRef: z.object({
      value: z.string().optional(),
      name: z.string().optional(),
    }).optional(),
    entityRef: z.object({
      value: z.string().optional(),
      name: z.string().optional(),
      type: z.string().optional(),
    }).optional(),
    memo: z.string().optional(),
  })).min(1, 'At least one line item is required'),
  scanRecordId: z.string().optional(),
  privateNote: z.string().optional(),
  docNumber: z.string().optional(),
});
