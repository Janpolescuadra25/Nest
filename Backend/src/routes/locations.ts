import { Router, Response } from 'express';
import { AppError, asyncHandler } from '../lib/errors';
import multer from 'multer';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { uploadLocationAttachment, getPresignedUrl, deleteFile } from '../lib/storage';
import { logAction } from '../middleware/audit';
import { requireCapacity, checkStorageQuota } from '../middleware/capacity';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import { createLocationTemplateRouter } from './templates';
import { parsePagination, buildPaginationMeta } from '../lib/pagination';
import { validateMappingConditions } from '../lib/validate-conditions';
import { validate } from '../middleware/validate';
import { locationCreateSchema, locationUpdateSchema, importTemplateSchema, mappingCreateSchema, ruleCreateSchema } from '../lib/validators';

const router = Router();

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
      'image/webp',
      'text/plain',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, Word, Excel, images, text.'));
    }
  },
});

// All location routes require authentication + effective role enforcement
router.use(authenticate, enforceEffectiveRole);

async function getTemplateOrFail(templateId: string, user: AuthRequest['user'], locationId?: string) {
  const where: Record<string, unknown> = {
    id: templateId,
    location: { ...locationFilter(user!) },
  };
  if (locationId) {
    where.locationId = locationId;
  }
  const template = await prisma.template.findFirst({
    where,
  });
  if (!template) {
    throw new AppError('Template not found', 404);
  }
  return template;
}

// ── GET /api/locations ────────────────────────────────────────────────────────
router.get('/', asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip, take } = parsePagination(req.query);
    const where = locationFilter(req.user!);
    const [total, data] = await Promise.all([
      prisma.location.count({ where }),
      prisma.location.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);
    res.json({ data, pagination: buildPaginationMeta(total, page, limit) });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Locations] list error:', err);
    throw new AppError('Failed to fetch locations', 500);
  }
}))

// ── POST /api/locations ───────────────────────────────────────────────────────
router.post('/', requireFeaturePermission('locations', 'write'), requireCapacity('location'), validate(locationCreateSchema), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name } = req.body as { name?: string };

    if (!name) {
      throw new AppError('name is required', 400);
    }

    const user = req.user!;
    const adminId =
      user.role === 'OWNER' ? null
      : user.role === 'ADMIN' ? user.userId
      : user.adminId ?? null;

    const location = await prisma.location.create({
      data: { userId: user.userId, adminId, name },
    });

    res.status(201).json(location);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Locations] create error:', err);
    throw new AppError('Failed to create location', 500);
  }
}))

// ── GET /api/locations/:id ────────────────────────────────────────────────────
router.get('/:id', asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
      include: { mappings: true, rules: true },
    });

    if (!location) {
      throw new AppError('Location not found', 404);
      return;
    }

    res.json(location);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Locations] get error:', err);
    throw new AppError('Failed to fetch location', 500);
  }
}))

// ── PUT /api/locations/:id ────────────────────────────────────────────────────
router.put('/:id', requireFeaturePermission('locations', 'write'), validate(locationUpdateSchema), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const existing = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
    });

    if (!existing) {
      throw new AppError('Location not found', 404);
      return;
    }

    const { name, isActive, description } = req.body as {
      name?: string; isActive?: boolean; description?: string;
    };

    const updated = await prisma.location.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(isActive !== undefined && { isActive }),
        ...(description !== undefined && { description: description || null }),
      },
    });

    res.json(updated);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Locations] update error:', err);
    throw new AppError('Failed to update location', 500);
  }
}))

// ── DELETE /api/locations/:id ─────────────────────────────────────────────────
router.delete('/:id', requireFeaturePermission('locations', 'write'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const existing = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
    });

    if (!existing) {
      throw new AppError('Location not found', 404);
      return;
    }

    await prisma.location.delete({ where: { id } });
    res.json({ message: 'Location deleted' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Locations] delete error:', err);
    throw new AppError('Failed to delete location', 500);
  }
}))

// ── POST /api/locations/:id/import-template ──────────────────────────────────
router.post('/:id/import-template', requireFeaturePermission('map', 'write'), validate(importTemplateSchema), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    const lf = locationFilter(req.user!);

    const location = await prisma.location.findFirst({
      where: { id, ...lf },
    });
    if (!location) {
      throw new AppError('Location not found', 404);
      return;
    }

    const body = req.body as {
      mappings?: Array<Record<string, unknown>>;
      rules?: Array<Record<string, unknown>>;
      memoTemplate?: string;
      docNumberTemplate?: string;
      mode?: 'replace' | 'merge';
      templateId?: string;
    };

    const mode = body.mode || 'merge';
    if (body.templateId) {
      const template = await prisma.template.findFirst({
        where: { id: body.templateId, locationId: id },
      });
      if (!template) {
        throw new AppError('Template not found', 404);
      }
    }

    if (!body.mappings?.length && !body.rules?.length && body.memoTemplate === undefined && body.docNumberTemplate === undefined) {
      if (!body.templateId) {
        throw new AppError('No template data provided', 400);
        return;
      }
    }
    if ((body.memoTemplate !== undefined || body.docNumberTemplate !== undefined) && !body.templateId) {
      throw new AppError('templateId is required when updating template memo/doc fields', 400);
      return;
    }
    if (body.mappings && !Array.isArray(body.mappings)) {
      throw new AppError('mappings must be an array', 400);
      return;
    }
    if (body.rules && !Array.isArray(body.rules)) {
      throw new AppError('rules must be an array', 400);
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      let createdMappings = 0;
      let createdRules = 0;

      if (body.mappings && body.mappings.length > 0) {
        if (mode === 'replace') {
          await tx.mapping.deleteMany({ where: { locationId: id } });
        }
        for (const m of body.mappings) {
          const sf = String(m['sourceField'] ?? '');
          const ta = String(m['targetAccount'] ?? '');
          if (!sf || !ta) continue;
          const conditionsValidation = validateMappingConditions(m['conditions']);
          if (!conditionsValidation.valid) {
            throw new AppError(conditionsValidation.error ?? 'Invalid conditions', 400);
          }
          const conditionsInput = (m['conditions'] ?? null) as Prisma.InputJsonValue;
          await tx.mapping.create({
            data: {
              locationId: id,
              templateId: body.templateId || null,
              sourceField: sf,
              targetAccount: ta,
              postingType: m['postingType'] === 'Debit' ? 'Debit' : 'Credit',
              keepSeparate: Boolean(m['keepSeparate']),
              targetClass: m['targetClass'] ? String(m['targetClass']) : null,
              targetName: m['targetName'] ? String(m['targetName']) : null,
              targetDescription: m['targetDescription'] ? String(m['targetDescription']) : null,
              targetMemo: m['targetMemo'] ? String(m['targetMemo']) : null,
              conditions: conditionsInput,
              priority: Number(m['priority']) || 0,
            },
          });
          createdMappings++;
        }
      } else if (mode === 'replace') {
        await tx.mapping.deleteMany({ where: { locationId: id } });
      }

      if (body.rules && body.rules.length > 0) {
        if (mode === 'replace') {
          await tx.rule.deleteMany({ where: { locationId: id } });
        }
        for (const r of body.rules) {
          const config = typeof r['config'] === 'object' && r['config'] !== null ? r['config'] as Record<string, unknown> : {};
          await tx.rule.create({
            data: {
              locationId: id,
              name: String(r['name'] ?? 'Imported rule'),
              ruleType: ['COMBINE', 'DEDUCT', 'THRESHOLD', 'FORMULA'].includes(String(r['ruleType']))
                ? String(r['ruleType']) as 'COMBINE' | 'DEDUCT' | 'THRESHOLD' | 'FORMULA'
                : 'COMBINE',
              config: config as unknown as Record<string, string | number | boolean | null>,
              isActive: r['isActive'] === false ? false : true,
            },
          });
          createdRules++;
        }
      } else if (mode === 'replace') {
        await tx.rule.deleteMany({ where: { locationId: id } });
      }

      if ((body.memoTemplate !== undefined || body.docNumberTemplate !== undefined) && body.templateId) {
        await tx.template.update({
          where: { id: body.templateId },
          data: {
            ...(body.memoTemplate !== undefined && { memoTemplate: body.memoTemplate || null }),
            ...(body.docNumberTemplate !== undefined && { docNumberTemplate: body.docNumberTemplate || null }),
          },
        });
      }

      return {
        success: true,
        createdMappings,
        createdRules,
        templatesUpdated: !!(body.memoTemplate || body.docNumberTemplate),
      };
    });

    res.json(result);
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Import failed';
    console.error('[import-template]', message);
    throw new AppError(process.env.NODE_ENV !== 'production'
        ? message
        : 'Template import failed. Please try again.', 500);
  }
}))

// ── GET /api/locations/:id/mappings ───────────────────────────────────────────
router.get('/:id/mappings', asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
    });

    if (!location) {
      throw new AppError('Location not found', 404);
      return;
    }

    const mappings = await prisma.mapping.findMany({
      where: { locationId: id },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    res.json(mappings);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Locations] mappings list error:', err);
    throw new AppError('Failed to fetch mappings', 500);
  }
}))

// ── POST /api/locations/:id/mappings ──────────────────────────────────────────
router.post('/:id/mappings', requireFeaturePermission('map', 'write'), validate(mappingCreateSchema), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
    });

    if (!location) {
      throw new AppError('Location not found', 404);
      return;
    }

    const { sourceField, targetAccount, postingType, keepSeparate, targetClass, targetName, targetDescription, targetMemo, priority, conditions, templateId } =
      req.body as {
        sourceField?: string; targetAccount?: string; postingType?: string; keepSeparate?: boolean;
        targetClass?: string; targetName?: string; targetDescription?: string; targetMemo?: string; priority?: number; conditions?: Prisma.JsonValue | null; templateId?: string;
      };

    const conditionsValidation = validateMappingConditions(conditions);
    if (!conditionsValidation.valid) {
      throw new AppError(conditionsValidation.error ?? 'Invalid conditions', 400);
    }
    const conditionsInput = conditions as Prisma.InputJsonValue;

    if (!sourceField || !targetAccount) {
      throw new AppError('sourceField and targetAccount are required', 400);
      return;
    }

    if (templateId) {
      const template = await prisma.template.findFirst({
        where: { id: templateId, locationId: id },
      });
      if (!template) {
        throw new AppError('Template not found', 404);
        return;
      }
    }

    const mapping = await prisma.mapping.create({
      data: {
        locationId: id,
        templateId: templateId || null,
        sourceField,
        targetAccount,
        postingType: postingType ?? 'Credit',
        keepSeparate: keepSeparate ?? false,
        targetClass,
        targetName,
        targetDescription,
        targetMemo,
        conditions: conditionsInput,
        priority: priority ?? 0,
      },
    });

    await prisma.mappingPreference.upsert({
      where: {
        locationId_sourceField_accountId: {
          locationId: id,
          sourceField,
          accountId: targetAccount,
        },
      },
      update: {
        timesAccepted: { increment: 1 },
        lastUsedAt: new Date(),
      },
      create: {
        locationId: id,
        sourceField,
        accountId: targetAccount,
        accountName: targetAccount,
      },
    });

    res.status(201).json(mapping);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Locations] mapping create error:', err);
    throw new AppError('Failed to create mapping', 500);
  }
}))

router.post('/:id/attachments',
  requireFeaturePermission('locations', 'write'),
  attachmentUpload.single('file'),
  checkStorageQuota,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const locationId = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id: locationId, ...locationFilter(req.user!) },
      select: { id: true },
    });
    if (!location) throw new AppError('Location not found', 404);
    if (!req.file) throw new AppError('No file uploaded', 400);

    const uploaded = await uploadLocationAttachment(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      locationId,
    );

    const attachment = await prisma.locationAttachment.create({
      data: {
        locationId,
        fileName: uploaded.fileName,
        storageKey: uploaded.storageKey,
        fileSize: uploaded.fileSize,
        mimeType: uploaded.mimeType,
        uploadedBy: req.user!.userId,
      },
    });

    await logAction({
      actorId: req.user!.userId,
      action: 'ATTACHMENT_UPLOADED',
      details: { fileName: uploaded.fileName, fileSize: uploaded.fileSize, locationId },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json(attachment);
  })
);

router.get('/:id/attachments', asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = String(req.params['id']);
  const location = await prisma.location.findFirst({
    where: { id: locationId, ...locationFilter(req.user!) },
    select: { id: true },
  });
  if (!location) throw new AppError('Location not found', 404);

  const attachments = await prisma.locationAttachment.findMany({
    where: { locationId },
    orderBy: { createdAt: 'desc' },
    include: { uploader: { select: { name: true } } },
  });

  const withUrls = await Promise.all(attachments.map(async (a) => ({
    id: a.id,
    locationId: a.locationId,
    fileName: a.fileName,
    fileSize: a.fileSize,
    mimeType: a.mimeType,
    uploadedBy: a.uploadedBy,
    uploaderName: a.uploader.name,
    createdAt: a.createdAt.toISOString(),
    url: await getPresignedUrl(a.storageKey),
  })));

  res.json(withUrls);
}));

router.delete('/:id/attachments/:attachmentId',
  requireFeaturePermission('locations', 'write'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const attachmentId = String(req.params['attachmentId']);
    const locationId = String(req.params['id']);

    const attachment = await prisma.locationAttachment.findFirst({
      where: { id: attachmentId, locationId },
    });
    if (!attachment) throw new AppError('Attachment not found', 404);

    const location = await prisma.location.findFirst({
      where: { id: locationId, ...locationFilter(req.user!) },
      select: { id: true },
    });
    if (!location) throw new AppError('Location not found', 404);

    await deleteFile(attachment.storageKey);
    await prisma.locationAttachment.delete({ where: { id: attachmentId } });

    await logAction({
      actorId: req.user!.userId,
      action: 'LOCATION_ATTACHMENT_DELETED',
      details: { fileName: attachment.fileName, locationId },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true });
  })
);

// ── Templates subrouter ─────────────────────────────────────────────────────
router.get('/:id/rules', asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const templateId = String(req.query.templateId || '');
    const location = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
    });

    if (!location) {
      throw new AppError('Location not found', 404);
      return;
    }

    if (templateId) {
      await getTemplateOrFail(templateId, req.user, id);
    }

    const rules = await prisma.rule.findMany({
      where: templateId ? { locationId: id, templateId } : { locationId: id },
      orderBy: { createdAt: 'asc' },
      include: { template: { select: { id: true, name: true, transactionType: true } } },
    });

    res.json(rules);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Locations] rules list error:', err);
    throw new AppError('Failed to fetch rules', 500);
  }
}))

// ── POST /api/locations/:id/rules ─────────────────────────────────────────────
router.post('/:id/rules', requireFeaturePermission('rules', 'write'), validate(ruleCreateSchema), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
    });

    if (!location) {
      throw new AppError('Location not found', 404);
      return;
    }

    const { name, ruleType, config, isActive, templateId } = req.body as {
      name?: string; ruleType?: string; config?: object; isActive?: boolean; templateId?: string | null;
    };

    const validTypes = ['COMBINE', 'DEDUCT', 'THRESHOLD', 'FORMULA'];
    if (!name || !ruleType || !config) {
      throw new AppError('name, ruleType, and config are required', 400);
      return;
    }

    if (templateId) {
      await getTemplateOrFail(templateId, req.user, id);
    }

    if (!validTypes.includes(ruleType)) {
      throw new AppError(`ruleType must be one of: ${validTypes.join(', ')}`, 400);
      return;
    }

    const rule = await prisma.rule.create({
      data: {
        locationId: id,
        templateId: templateId || null,
        name,
        ruleType: ruleType as 'COMBINE' | 'DEDUCT' | 'THRESHOLD' | 'FORMULA',
        config,
        isActive: isActive ?? true,
      },
    });

    res.status(201).json(rule);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Locations] rule create error:', err);
    throw new AppError('Failed to create rule', 500);
  }
}))

// ── GET /api/locations/:id/scans ──────────────────────────────────────────────
router.get('/:id/scans', asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
    });

    if (!location) {
      throw new AppError('Location not found', 404);
      return;
    }

    const { page, limit, skip } = parsePagination(req.query);
    const take = limit + 1;

    const rows = await prisma.scanRecord.findMany({
      where: { locationId: id },
      orderBy: { scanDate: 'desc' },
      include: { syncLogs: true, attachments: true },
      skip,
      take,
    });

    const hasMore = rows.length > limit;
    const scans = hasMore ? rows.slice(0, limit) : rows;

    res.json({ scans, hasMore });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Locations] scans list error:', err);
    throw new AppError('Failed to fetch scans', 500);
  }
}))

router.use('/:id/templates', createLocationTemplateRouter());

export default router;
