import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { prisma } from '../lib/prisma';
import { AppError, asyncHandler } from '../lib/errors';
import { validate } from '../middleware/validate';
import { payeeMappingCreateSchema, payeeMappingUpdateSchema, payeeMappingBulkImportSchema } from '../lib/validators';

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

function serializePayeeMapping(mapping: { id: string; templateId: string; scannedName: string; vendorId: string; matchingRule: unknown; createdAt: Date; }) {
  return {
    id: mapping.id,
    templateId: mapping.templateId,
    scannedName: mapping.scannedName,
    vendorId: mapping.vendorId,
    matchingRule: mapping.matchingRule,
    createdAt: mapping.createdAt,
  };
}

router.get('/:templateId', requireFeaturePermission('map', 'read'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const template = await getTemplateOrFail(String(req.params.templateId), req.user);
  const mappings = await prisma.payeeMapping.findMany({
    where: { templateId: template.id },
    orderBy: { scannedName: 'asc' },
  });
  res.json(mappings.map(serializePayeeMapping));
}));

router.post('/', requireFeaturePermission('map', 'write'), validate(payeeMappingCreateSchema), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { templateId, scannedName, vendorId, matchingRule } = req.body as {
    templateId?: string;
    scannedName?: string;
    vendorId?: string;
    matchingRule?: Record<string, unknown> | null;
  };

  if (!templateId || !scannedName || !vendorId) {
    throw new AppError('templateId, scannedName, and vendorId are required', 400);
  }

  const template = await getTemplateOrFail(templateId, req.user);

  const existing = await prisma.payeeMapping.findFirst({
    where: { templateId: template.id, scannedName: scannedName.trim() },
  });
  if (existing) {
    throw new AppError('A payee mapping for this template already exists', 409);
  }

  const mapping = await prisma.payeeMapping.create({
    data: {
      templateId: template.id,
      scannedName: scannedName.trim(),
      vendorId: vendorId.trim(),
      matchingRule: matchingRule !== undefined ? matchingRule as unknown as Prisma.InputJsonValue : undefined,
    },
  });

  res.status(201).json(serializePayeeMapping(mapping));
}));

router.put('/:id', requireFeaturePermission('map', 'write'), validate(payeeMappingUpdateSchema), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { scannedName, vendorId, matchingRule } = req.body as {
    scannedName?: string;
    vendorId?: string;
    matchingRule?: Record<string, unknown> | null;
  };

  const mapping = await prisma.payeeMapping.findUnique({ where: { id } });
  if (!mapping) {
    throw new AppError('Payee mapping not found', 404);
  }
  await getTemplateOrFail(mapping.templateId, req.user);

  const updated = await prisma.payeeMapping.update({
    where: { id },
    data: {
      ...(scannedName !== undefined ? { scannedName: scannedName.trim() } : {}),
      ...(vendorId !== undefined ? { vendorId: vendorId.trim() } : {}),
      ...(matchingRule !== undefined ? { matchingRule: matchingRule as unknown as Prisma.InputJsonValue } : {}),
    },
  });

  res.json(serializePayeeMapping(updated));
}));

router.delete('/:id', requireFeaturePermission('map', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const mapping = await prisma.payeeMapping.findUnique({ where: { id } });
  if (!mapping) {
    throw new AppError('Payee mapping not found', 404);
  }
  await getTemplateOrFail(mapping.templateId, req.user);

  await prisma.payeeMapping.delete({ where: { id } });
  res.json({ success: true });
}));

export default router;
