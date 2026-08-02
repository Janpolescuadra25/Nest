import { z } from 'zod';
import { ALL_ACTIONS, ALL_FEATURES } from '../middleware/permissions';

const validPermissionKeys = new Set<string>(ALL_FEATURES.flatMap(feature => ALL_ACTIONS.map(action => `${feature}:${action}`)));

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
  role: z.enum(['ACCOUNTANT', 'STAFF', 'VIEWER', 'MANAGER']),
  trialDays: z.number().int().min(1).max(365).optional(),
  customExpiryMessage: z.string().max(200).optional(),
});

export const inviteLinkSchema = z.object({
  roleHint: z.enum(['ACCOUNTANT', 'STAFF', 'VIEWER', 'ADMIN', 'MANAGER']).optional(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
  maxUses: z.number().int().min(1).max(100).optional(),
});

export const patchTeamMemberSchema = z.object({
  role: z.enum(['ACCOUNTANT', 'STAFF', 'VIEWER']).optional(),
  permissions: z.record(z.string().refine(key => validPermissionKeys.has(key), 'Invalid permission key'), z.boolean()).optional(),
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
  privateNote: z.string().optional(),
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
  skipDedupCheck: z.boolean().optional(),
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
  skipDedupCheck: z.boolean().optional(),
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
  privateNote: z.string().optional(),
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
  skipDedupCheck: z.boolean().optional(),
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
  scanRecordId: z.string().optional(),
  skipDedupCheck: z.boolean().optional(),
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
  skipDedupCheck: z.boolean().optional(),
  privateNote: z.string().optional(),
  docNumber: z.string().optional(),
});

export const scanSubmitSchema = z.object({}).strict();

export const scanApproveSchema = z.object({}).strict();

export const scanRejectSchema = z.object({
  notes: z.string().max(500).optional(),
}).strict();

export const scanCreateSchema = z.object({
  locationId: z.string().min(1),
  scanDate: z.string().min(1),
  rawData: z.unknown().optional(),
  rawScanEntry: z.unknown().optional(),
  source: z.string().max(100).optional(),
  transactionType: z.string().max(50).optional(),
  attachment: z.object({
    fileName: z.string(),
    storageKey: z.string(),
    fileSize: z.number(),
    mimeType: z.string(),
  }).optional(),
  autoAttach: z.boolean().optional(),
}).strict();

export const teamAllocationSchema = z.object({
  allocatedScans: z.number().int().min(0).nullable().optional(),
  allocatedLocations: z.number().int().min(0).nullable().optional(),
  allocatedTemplates: z.number().int().min(0).nullable().optional(),
}).strict();

export const locationCreateSchema = z.object({
  name: z.string().min(1).max(200),
}).strict();

export const locationUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
}).strict();

export const importTemplateSchema = z.object({
  mappings: z.array(z.record(z.string(), z.unknown())).optional(),
  rules: z.array(z.record(z.string(), z.unknown())).optional(),
  memoTemplate: z.string().max(1000).optional(),
  docNumberTemplate: z.string().max(200).optional(),
  mode: z.enum(['replace', 'merge']).optional(),
  templateId: z.string().optional(),
}).strict();

export const mappingCreateSchema = z.object({
  sourceField: z.string().min(1),
  targetAccount: z.string().min(1),
  postingType: z.string().optional(),
  keepSeparate: z.boolean().optional(),
  targetClass: z.string().max(200).optional(),
  targetName: z.string().max(500).optional(),
  targetDescription: z.string().max(1000).optional(),
  targetMemo: z.string().max(1000).optional(),
  priority: z.number().int().optional(),
  conditions: z.unknown().optional(),
  templateId: z.string().optional(),
}).strict();

export const ruleCreateSchema = z.object({
  name: z.string().min(1).max(200),
  ruleType: z.enum(['COMBINE', 'DEDUCT', 'THRESHOLD', 'FORMULA']),
  config: z.record(z.string(), z.unknown()),
  isActive: z.boolean().optional(),
  templateId: z.string().nullable().optional(),
}).strict();

export const templateCreateSchema = z.object({
  locationId: z.string().min(1),
  name: z.string().min(1).max(200),
  transactionType: z.string().max(50).optional(),
  scanModes: z.array(z.enum(['IMAGE', 'EXCEL', 'POS'])).optional().default(['IMAGE']),
  posSystem: z.string().max(50).nullable().optional(),
  memoTemplate: z.string().max(1000).optional(),
  docNumberTemplate: z.string().max(200).optional(),
  defaults: z.record(z.string(), z.unknown()).nullable().optional(),
  columnMappings: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict();

export const templateUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  scanModes: z.array(z.enum(['IMAGE', 'EXCEL', 'POS'])).optional(),
  posSystem: z.string().max(50).nullable().optional(),
  memoTemplate: z.string().max(1000).nullable().optional(),
  docNumberTemplate: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
  defaults: z.record(z.string(), z.unknown()).nullable().optional(),
  columnMappings: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict();

export const locationTemplateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  transactionType: z.string().max(50).optional(),
  scanModes: z.array(z.enum(['IMAGE', 'EXCEL', 'POS'])).optional().default(['IMAGE']),
  posSystem: z.string().max(50).nullable().optional(),
  memoTemplate: z.string().max(1000).optional(),
  docNumberTemplate: z.string().max(200).optional(),
  defaults: z.record(z.string(), z.unknown()).nullable().optional(),
  columnMappings: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict();
