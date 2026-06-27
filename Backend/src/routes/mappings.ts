import { AppError, asyncHandler } from '../lib/errors';
import { Router, Response } from 'express';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { qbService } from '../services/qb.service';
import { suggestMappings } from '../lib/gemini';
import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import { validateMappingConditions } from '../lib/validate-conditions';

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
    const conditionsInput = conditions as Prisma.JsonValue | null;

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
    console.error('[Mappings] update error:', err);
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
    console.error('[Mappings] delete error:', err);
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
        return {
          ...suggestion,
          accountId: matched?.Id,
        };
      });
    });

    res.json({ suggestions });
  } catch (err: any) {
    console.error('[Mappings] suggestion error:', err);

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

export default router;
