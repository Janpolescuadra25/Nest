import { AppError, asyncHandler } from '../lib/errors';
import { Router, Response } from 'express';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { qbService } from '../services/qb.service';
import { suggestMappings, suggestValueMappings, ValueMappingFieldTypeString } from '../lib/gemini';
import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import { validateMappingConditions } from '../lib/validate-conditions';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'Mappings' });
const router = Router();

router.use(authenticate, enforceEffectiveRole);

async function recordMappingPreference(locationId: string, sourceField: string, accountId: string, accountName: string) {
  if (!locationId || !sourceField || !accountId) return;
  await prisma.mappingPreference.upsert({
    where: {
      locationId_sourceField_accountId: {
        locationId,
        sourceField,
        accountId,
      },
    },
    update: {
      timesAccepted: { increment: 1 },
      lastUsedAt: new Date(),
    },
    create: {
      locationId,
      sourceField,
      accountId,
      accountName,
    },
  });
}

// ── PUT /api/mappings/:id ─────────────────────────────────────────────────────
router.put('/:id', requireFeaturePermission('map', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const mapping = await prisma.mapping.findFirst({
      where: { id, location: locationFilter(req.user!) },
      include: { location: true },
    });

    if (!mapping) {
      throw new AppError('Mapping not found', 404);
    }

    const { sourceField, targetAccount, postingType, keepSeparate, targetClass, targetName, targetDescription, targetMemo, priority, conditions, templateId } =
      req.body as {
        sourceField?: string; targetAccount?: string; postingType?: string; keepSeparate?: boolean; targetClass?: string;
        targetName?: string; targetDescription?: string; targetMemo?: string; priority?: number; conditions?: Prisma.JsonValue | null; templateId?: string | null;
      };

    const conditionsValidation = validateMappingConditions(conditions);
    if (!conditionsValidation.valid) {
      throw new AppError(conditionsValidation.error ?? 'Invalid conditions', 400);
    }
    const conditionsInput = conditions as Prisma.InputJsonValue;

    if (templateId !== undefined) {
      if (templateId !== null && templateId !== '') {
        const template = await prisma.template.findFirst({
          where: { id: templateId, locationId: mapping.locationId },
        });
        if (!template) {
          throw new AppError('Template not found', 404);
        }
      }
    }

    const updateData: Prisma.MappingUncheckedUpdateInput = {
      ...(sourceField !== undefined && { sourceField }),
      ...(targetAccount !== undefined && { targetAccount }),
      ...(postingType !== undefined && { postingType }),
      ...(keepSeparate !== undefined && { keepSeparate }),
      ...(targetClass !== undefined && { targetClass }),
      ...(targetName !== undefined && { targetName }),
      ...(targetDescription !== undefined && { targetDescription }),
      ...(targetMemo !== undefined && { targetMemo }),
      ...(conditions !== undefined && { conditions: conditionsInput }),
      ...(priority !== undefined && { priority }),
      ...(templateId !== undefined && { templateId }),
    };

    const updated = await prisma.mapping.update({
      where: { id },
      data: updateData,
    });

    await recordMappingPreference(
      mapping.locationId,
      sourceField ?? mapping.sourceField,
      targetAccount ?? mapping.targetAccount,
      targetAccount ?? mapping.targetAccount,
    );

    res.json(updated);
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'Update error');
    throw new AppError('Failed to update mapping', 500);
  }
}));

// ── DELETE /api/mappings/:id ──────────────────────────────────────────────────
router.delete('/:id', requireFeaturePermission('map', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const mapping = await prisma.mapping.findFirst({
      where: { id, location: locationFilter(req.user!) },
      include: { location: true },
    });

    if (!mapping) {
      throw new AppError('Mapping not found', 404);
    }

    await prisma.mapping.delete({ where: { id } });
    res.json({ message: 'Mapping deleted' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'Delete error');
    throw new AppError('Failed to delete mapping', 500);
  }
}));

// ── POST /api/mappings/suggest ─────────────────────────────────────────────────
router.post('/suggest', requireFeaturePermission('map', 'read'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { locationId, scanFields, transactionType } = req.body as {
      locationId?: string;
      scanFields?: string[];
      transactionType?: string;
    };

    if (!locationId || !Array.isArray(scanFields) || scanFields.length === 0) {
      throw new AppError('locationId and scanFields are required', 400);
    }

    const location = await prisma.location.findFirst({
      where: { id: locationId, ...locationFilter(req.user!) },
    });

    if (!location) {
      throw new AppError('Location not found', 404);
    }

    const preferenceContext = await prisma.mappingPreference.findMany({
      where: {
        locationId,
        sourceField: { in: scanFields },
      },
      orderBy: [{ timesAccepted: 'desc' }, { lastUsedAt: 'desc' }],
      take: 20,
    });

    const preferenceText = preferenceContext.length > 0
      ? preferenceContext.map((preference) =>
          `- ${preference.sourceField} => ${preference.accountName} (${preference.timesAccepted} accepted)`,
        ).join('\n')
      : undefined;

    const suggestions = await qbService.callQB(req.user!.userId, async ({ accessToken, realmId }) => {
      const accounts = await qbService.getAccounts(realmId, accessToken);
      const accountNames = accounts.map((account) => account.FullyQualifiedName);
      const accountTypes = accounts.map((account) => ({
        name: account.FullyQualifiedName,
        type: account.AccountType,
        subType: account.AccountSubType || '',
      }));
      const aiSuggestions = await suggestMappings(scanFields, accountNames, transactionType, preferenceText, accountTypes);
      return aiSuggestions.map((suggestion) => {
        const matched = accounts.find((account) =>
          account.FullyQualifiedName.toLowerCase() === suggestion.accountName.toLowerCase() ||
          account.FullyQualifiedName.toLowerCase().includes(suggestion.accountName.toLowerCase()) ||
          account.FullyQualifiedName.toLowerCase().includes(suggestion.accountHint.toLowerCase()),
        );

        const warnings: string[] = [];
        if (suggestion.postingType !== 'Debit' && suggestion.postingType !== 'Credit') {
          warnings.push(`AI suggested invalid posting type "${suggestion.postingType}"`);
        }

        if (matched) {
          const CREDIT_NATURED = new Set([
            'Revenue', 'Income', 'Other Income',
            'Liability', 'Other Current Liability', 'Long Term Liability', 'Deferred Revenue',
            'Equity', 'Non-Posting',
          ]);
          const isCreditNatured = CREDIT_NATURED.has(matched.AccountType);
          const expectedPosting = isCreditNatured ? 'Credit' : 'Debit';

          if (suggestion.postingType !== expectedPosting) {
            warnings.push(`Account "${matched.FullyQualifiedName}" is ${matched.AccountType} (normally ${expectedPosting}), but AI suggested ${suggestion.postingType}`);
          }
        }

        return {
          ...suggestion,
          accountId: matched?.Id,
          accountType: matched?.AccountType,
          validationWarning: warnings.length > 0 ? warnings.join('; ') : undefined,
        };
      });
    });

    res.json({ suggestions });
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'Suggestion error');

    const isRateLimit = err?.status === 429
      || err?.message?.includes('429')
      || err?.message?.toLowerCase().includes('rate limit')
      || err?.message?.includes('Too Many Requests')
      || err?.message?.toLowerCase().includes('quota');

    if (isRateLimit) {
      let retrySeconds = 30;
      try {
        const retryStr = err?.errorDetails?.[2]?.retryDelay
          || err?.details?.retryDelay?.seconds
          || err?.retry_after;
        if (retryStr) {
          const parsed = parseInt(String(retryStr), 10);
          if (parsed > 0) retrySeconds = parsed;
        }
      } catch (_) {
        // use default retrySeconds
      }

      throw new AppError(`AI rate limited. Please wait ${retrySeconds} seconds and try again.`, 429);
    }

    throw new AppError('Failed to suggest mappings', 500);
  }
}));

router.post('/suggest-values', requireFeaturePermission('map', 'read'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId, valueCategories } = req.body as {
      templateId?: string;
      valueCategories?: unknown;
    };

    if (!templateId || typeof templateId !== 'string') {
      throw new AppError('templateId is required and must be a string', 400);
    }
    if (!Array.isArray(valueCategories) || valueCategories.length === 0) {
      throw new AppError('valueCategories must be a non-empty array', 400);
    }

    const categories = valueCategories.map((category) => {
      if (!category || typeof category !== 'object') {
        throw new AppError('Each valueCategory must be an object', 400);
      }
      const cat = category as Record<string, unknown>;
      const sourceField = typeof cat.sourceField === 'string' ? cat.sourceField.trim() : '';
      const rawFieldType = typeof cat.fieldType === 'string' ? cat.fieldType.trim() : '';
      const scannedValues = Array.isArray(cat.scannedValues) ? cat.scannedValues : undefined;

      if (!sourceField) {
        throw new AppError('Each valueCategory must have a valid sourceField', 400);
      }
      if (!rawFieldType) {
        throw new AppError('Each valueCategory must have a valid fieldType', 400);
      }
      if (!scannedValues || scannedValues.length === 0 || !scannedValues.every((value) => typeof value === 'string')) {
        throw new AppError('Each valueCategory must have a non-empty scannedValues array', 400);
      }

      return {
        sourceField,
        fieldType: rawFieldType as ValueMappingFieldTypeString,
        scannedValues: scannedValues as string[],
      };
    });

    const template = await prisma.template.findFirst({
      where: { id: templateId, ...locationFilter(req.user!) },
    });

    if (!template) {
      throw new AppError('Template not found', 404);
    }

    const needsAccounts = categories.some((category) => category.fieldType === 'account' || category.fieldType === 'bankAccount');
    const needsName = categories.some((category) => category.fieldType === 'name');
    const needsTaxCodes = categories.some((category) => category.fieldType === 'taxCode' || category.fieldType === 'taxType');

    const suggestions = await qbService.callQB(req.user!.userId, async ({ accessToken, realmId }) => {
      const accounts = needsAccounts ? await qbService.getAccounts(realmId, accessToken) : [];
      const vendors = needsName ? await qbService.getVendors(realmId, accessToken) : [];
      const customers = needsName ? await qbService.getCustomers(realmId, accessToken) : [];
      const taxCodes = needsTaxCodes ? await qbService.getTaxCodes(realmId, accessToken) : [];

      return await suggestValueMappings({
        valueCategories: categories,
        qbEntities: {
          accounts,
          vendors,
          customers,
          taxCodes,
        },
        transactionType: template.transactionType ?? undefined,
      });
    });

    res.json({ success: true, data: suggestions });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'Value mapping suggestion error');
    throw new AppError('Failed to suggest value mappings', 500);
  }
}));

export default router;
