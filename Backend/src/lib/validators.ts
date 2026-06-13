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
  trialDays: z.number().int().min(1).max(365).optional(),
  customExpiryMessage: z.string().max(200).optional(),
});

export const inviteLinkSchema = z.object({
  roleHint: z.enum(['ACCOUNTANT', 'STAFF', 'VIEWER', 'ADMIN']).optional(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
  maxUses: z.number().int().min(1).max(100).optional(),
});

export const patchTeamMemberSchema = z.object({
  role: z.enum(['ACCOUNTANT', 'STAFF', 'VIEWER']).optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  trialExpiresAt: z.string().min(1).optional().nullable(),
  customExpiryMessage: z.string().max(500).optional().nullable(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

export const billSchema = z.object({
  txnDate: z.string().min(1, 'Transaction date is required'),
  vendorRef: z.object({
    value: z.string().min(1, 'Vendor is required'),
    name: z.string().optional(),
  }),
  apAccountRef: z.object({
    value: z.string().min(1, 'AP account is required'),
    name: z.string().optional(),
  }),
  termsRef: z.object({
    value: z.string().min(1, 'Terms reference is required'),
    name: z.string().optional(),
  }).optional(),
  dueDate: z.string().optional(),
  memo: z.string().optional(),
  docNumber: z.string().optional(),
  lines: z.array(z.object({
    amount: z.number().positive('Amount must be positive'),
    accountRef: z.object({
      value: z.string().min(1, 'Account value is required'),
      name: z.string().optional(),
    }),
    description: z.string().optional(),
    classRef: z.object({
      value: z.string().optional(),
      name: z.string().optional(),
    }).optional(),
    taxCodeRef: z.object({
      value: z.string().optional(),
      name: z.string().optional(),
    }).optional(),
  })).min(1, 'At least one line item is required'),
  scanRecordId: z.string().optional(),
});

export const chequeSchema = z.object({
  txnDate: z.string().min(1, 'Transaction date is required'),
  bankAccountRef: z.object({
    value: z.string().min(1, 'Bank account is required'),
    name: z.string().optional(),
  }),
  payeeRef: z.object({
    value: z.string().min(1, 'Payee is required'),
    name: z.string().optional(),
  }),
  amount: z.number().positive('Amount must be positive'),
  memo: z.string().optional(),
  docNumber: z.string().optional(),
  lines: z.array(z.object({
    amount: z.number().positive('Amount must be positive'),
    accountRef: z.object({
      value: z.string().min(1, 'Account value is required'),
      name: z.string().optional(),
    }),
    description: z.string().optional(),
    classRef: z.object({
      value: z.string().optional(),
      name: z.string().optional(),
    }).optional(),
  })).min(1, 'At least one line item is required'),
  scanRecordId: z.string().optional(),
});

export const vendorCreditSchema = z.object({
  txnDate: z.string().min(1, 'Credit date is required'),
  vendorRef: z.object({
    value: z.string().min(1, 'Vendor is required'),
    name: z.string().optional(),
  }),
  apAccountRef: z.object({
    value: z.string().min(1, 'AP account is required'),
    name: z.string().optional(),
  }),
  memo: z.string().optional(),
  docNumber: z.string().optional(),
  lines: z.array(z.object({
    amount: z.number().positive('Amount must be positive'),
    accountRef: z.object({
      value: z.string().min(1, 'Account value is required'),
      name: z.string().optional(),
    }),
    description: z.string().optional(),
    classRef: z.object({
      value: z.string().optional(),
      name: z.string().optional(),
    }).optional(),
    taxCodeRef: z.object({
      value: z.string().optional(),
      name: z.string().optional(),
    }).optional(),
  })).min(1, 'At least one line item is required'),
  scanRecordId: z.string().optional(),
});

export const billPaymentSchema = z.object({
  vendorRef: z.object({
    value: z.string().min(1, 'Vendor is required'),
    name: z.string().optional(),
  }),
  payType: z.enum(['Cash', 'Check', 'CreditCard', 'Other']),
  bankAccountRef: z.object({
    value: z.string().optional(),
    name: z.string().optional(),
  }).optional(),
  checkNum: z.string().optional(),
  txnDate: z.string().min(1, 'Transaction date is required'),
  totalAmt: z.number().positive('Total amount must be positive'),
  lines: z.array(z.object({
    amount: z.number(),
    linkedTxn: z.object({
      txnId: z.string().min(1),
      txnType: z.enum(['Bill', 'VendorCredit']),
    }),
  })).min(1, 'At least one linked transaction is required'),
}).superRefine((data, ctx) => {
  if ((data.payType === 'Check' || data.payType === 'CreditCard') && !data.bankAccountRef?.value) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Bank account is required for ${data.payType} payments`,
      path: ['bankAccountRef'],
    });
  }
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
