import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { prisma } from '../lib/prisma';
import { AppError, asyncHandler } from '../lib/errors';
import { validate } from '../middleware/validate';
import { valueMappingCreateSchema, valueMappingUpdateSchema } from '../lib/validators';

const router = Router();
router.use(authenticate, enforceEffectiveRole);

async function getTemplateOrFail(templateId: string, user: AuthRequest['user']) {
  const template = await prisma.template.findFirst({
    where: { id: templateId, location: { ...locationFilter(user!) } },
  });
  if (!template) {
    throw new AppError('Template not found', 404);
  }
  return template;
}

function serializeValueMapping(mapping: { id: string; templateId: string; fieldType: string; scannedText: string; sourceField: string | null; entityId: string; matchingRule: unknown; createdAt: Date; updatedAt: Date; }) {
  return {
    id: mapping.id,
    templateId: mapping.templateId,
    fieldType: mapping.fieldType,
    scannedText: mapping.scannedText,
    sourceField: mapping.sourceField,
    entityId: mapping.entityId,
    matchingRule: mapping.matchingRule ?? null,
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt.toISOString(),
  };
}

router.get('/:templateId', requireFeaturePermission('map', 'read'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const template = await getTemplateOrFail(String(req.params.templateId), req.user);
  const mappings = await prisma.valueMapping.findMany({
    where: { templateId: template.id },
    orderBy: [{ fieldType: 'asc' }, { scannedText: 'asc' }],
  });
  res.json(mappings.map(serializeValueMapping));
}));

router.post('/', requireFeaturePermission('map', 'write'), validate(valueMappingCreateSchema), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { templateId, fieldType, scannedText, sourceField, entityId, matchingRule } = req.body as {
    templateId?: string;
    fieldType?: string;
    scannedText?: string;
    sourceField?: string | null;
    entityId?: string;
    matchingRule?: Record<string, unknown> | null;
  };

  if (sourceField !== undefined && sourceField !== null && typeof sourceField !== 'string') {
    throw new AppError('sourceField must be a string, null, or omitted', 400);
  }

  const normalizedSourceField = sourceField?.trim() ?? null;
  const normalizedSourceFieldValue = normalizedSourceField === '' ? null : normalizedSourceField;

  if (!templateId || !fieldType || !scannedText || !entityId) {
    throw new AppError('templateId, fieldType, scannedText, and entityId are required', 400);
  }

  const validFieldTypes = ['account', 'name', 'class', 'taxCode'];
  if (!validFieldTypes.includes(fieldType)) {
    throw new AppError(`fieldType must be one of: ${validFieldTypes.join(', ')}`, 400);
  }

  const template = await getTemplateOrFail(templateId, req.user);

  const trimmedScannedText = scannedText.trim();
  const existing = await prisma.valueMapping.findFirst({
    where: { templateId: template.id, fieldType, sourceField: normalizedSourceFieldValue, scannedText: trimmedScannedText },
  });
  if (existing) {
    throw new AppError('A value mapping for this template already exists', 409);
  }

  const mapping = await prisma.valueMapping.create({
    data: {
      templateId: template.id,
      fieldType,
      scannedText: trimmedScannedText,
      sourceField: normalizedSourceFieldValue,
      entityId: entityId.trim(),
      matchingRule: matchingRule !== undefined ? matchingRule as unknown as Prisma.InputJsonValue : undefined,
    },
  });

  res.status(201).json(serializeValueMapping(mapping));
}));

router.put('/:id', requireFeaturePermission('map', 'write'), validate(valueMappingUpdateSchema), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { fieldType, scannedText, sourceField, entityId, matchingRule } = req.body as {
    fieldType?: string;
    scannedText?: string;
    sourceField?: string | null;
    entityId?: string;
    matchingRule?: Record<string, unknown> | null;
  };

  if (sourceField !== undefined && sourceField !== null && typeof sourceField !== 'string') {
    throw new AppError('sourceField must be a string, null, or omitted', 400);
  }

  const mapping = await prisma.valueMapping.findUnique({ where: { id } });
  if (!mapping) {
    throw new AppError('Value mapping not found', 404);
  }
  await getTemplateOrFail(mapping.templateId, req.user);

  const effectiveFieldType = fieldType !== undefined ? fieldType : mapping.fieldType;
  const effectiveScannedText = scannedText !== undefined ? scannedText.trim() : mapping.scannedText;
  const sourceFieldNormalized = sourceField === undefined ? mapping.sourceField : sourceField?.trim() ?? null;
  const effectiveSourceField = sourceField === undefined ? mapping.sourceField : sourceFieldNormalized === '' ? null : sourceFieldNormalized;

  const existing = await prisma.valueMapping.findFirst({
    where: {
      id: { not: id },
      templateId: mapping.templateId,
      fieldType: effectiveFieldType,
      sourceField: effectiveSourceField,
      scannedText: effectiveScannedText,
    },
  });
  if (existing) {
    throw new AppError('A value mapping for this template already exists', 409);
  }

  const updated = await prisma.valueMapping.update({
    where: { id },
    data: {
      ...(fieldType !== undefined ? { fieldType } : {}),
      ...(scannedText !== undefined ? { scannedText: scannedText.trim() } : {}),
      ...(sourceField !== undefined ? { sourceField: effectiveSourceField } : {}),
      ...(entityId !== undefined ? { entityId: entityId.trim() } : {}),
      ...(matchingRule !== undefined ? { matchingRule: matchingRule as unknown as Prisma.InputJsonValue } : {}),
    },
  });

  res.json(serializeValueMapping(updated));
}));

router.delete('/:id', requireFeaturePermission('map', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const mapping = await prisma.valueMapping.findUnique({ where: { id } });
  if (!mapping) {
    throw new AppError('Value mapping not found', 404);
  }
  await getTemplateOrFail(mapping.templateId, req.user);

  await prisma.valueMapping.delete({ where: { id } });
  res.json({ success: true });
}));

export default router;
