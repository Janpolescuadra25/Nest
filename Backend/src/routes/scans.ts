import { AppError, asyncHandler } from '../lib/errors';
import { Router, Response } from 'express';
import path from 'path';
import Excel from 'exceljs';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { uploadFile, deleteFile, getPresignedUrl } from '../lib/storage';
import { requireCapacity, checkStorageQuota } from '../middleware/capacity';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { logAction } from '../middleware/audit';
import { validate } from '../middleware/validate';
import { scanSubmitSchema, scanApproveSchema, scanRejectSchema, scanCreateSchema } from '../lib/validators';
import type { Prisma } from '@prisma/client';
import { ScanRawData } from '../types';
import { prisma } from '../lib/prisma';
import multer from 'multer';
import { detectPOS, parseDocumentWithGemini, parseInvoiceWithGemini, parsePOSReport } from '../lib/gemini';
import type { ParsePOSTabResponse } from '../types';
import { validateTransactionType } from './templates';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'Scans' });

async function deductBonusScan(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { bonusScans: true },
  });
  if (!user || user.bonusScans <= 0) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { bonusScans: { decrement: 1 } },
  });
  return true;
}

const router = Router();

// Multer config for AI invoice parsing (memory storage, 10MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    const allowedExts = ['.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
      cb(null, true);
      return;
    }

    if (!allowedMimes.includes(file.mimetype)) {
      cb(new AppError(`Unsupported file type: ${file.mimetype}`, 400));
    } else {
      cb(new AppError(`Unsupported file extension: ${ext}`, 400));
    }
  },
});

router.use(authenticate, enforceEffectiveRole);

// ── POST /api/scans ───────────────────────────────────────────────────────────
// Save raw Toast POS scan data for a location
router.post('/', requireFeaturePermission('scan', 'write'), validate(scanCreateSchema), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { locationId, scanDate, rawData, rawScanEntry, source, transactionType, attachment, autoAttach } = req.body as {
      locationId?: string;
      scanDate?: string;
      rawData?: ScanRawData;
      rawScanEntry?: unknown;
      source?: string;
      transactionType?: string;
      attachment?: { fileName: string; storageKey: string; fileSize: number; mimeType: string };
      autoAttach?: boolean;
    };
    validateTransactionType(transactionType);

    if (!locationId || !scanDate) {
      throw new AppError('locationId and scanDate are required', 400);
    }
    if (!rawData && (!source || source === 'pos')) {
      throw new AppError('rawData is required for POS scans', 400);
    }
    if (source && source !== 'pos' && !rawScanEntry) {
      throw new AppError('rawScanEntry is required for non-POS scans', 400);
    }

    // Verify the location is visible to the authenticated user
    const location = await prisma.location.findFirst({
      where: { id: locationId, ...locationFilter(req.user!) },
    });

    if (!location) {
      throw new AppError('Location not found', 404);
    }

    const parsedDate = new Date(scanDate);
    if (isNaN(parsedDate.getTime())) {
      throw new AppError('scanDate must be a valid ISO date string', 400);
    }

    const scan = await prisma.scanRecord.create({
      data: {
        locationId,
        scanDate: parsedDate,
        rawData: (rawData ?? {}) as unknown as Prisma.InputJsonValue,
        rawScanEntry: rawScanEntry ? rawScanEntry as unknown as Prisma.InputJsonValue : undefined,
        source: source || 'pos',
        status: 'PENDING',
        autoAttach: autoAttach ?? true,
        ...(transactionType ? { transactionType } : {}),
      },
    });

    if (attachment) {
      const createdAttachment = await prisma.attachment.create({
        data: {
          scanRecordId: scan.id,
          fileName: attachment.fileName,
          storageKey: attachment.storageKey,
          fileSize: attachment.fileSize,
          mimeType: attachment.mimeType,
        },
      });
      logAction({
        actorId: req.user!.userId,
        action: 'ATTACHMENT_UPLOADED',
        details: { fileName: createdAttachment.fileName, fileSize: createdAttachment.fileSize, scanRecordId: scan.id },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    // Generate Excel from POS scan data
    if (source === 'pos' && rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
      try {
        const posData = rawData as Record<string, unknown>;
        const keys = Object.keys(posData);
        if (keys.length > 0) {
          const workbook = new Excel.Workbook();
          const worksheet = workbook.addWorksheet('POS Data');
          worksheet.columns = keys.map((key) => ({ header: key, key }));
          worksheet.addRow(posData);
          const excelBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

          const excelFile = await uploadFile(
            excelBuffer,
            `pos-data-${scan.id}.xlsx`,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            req.user!.adminId ?? req.user!.userId,
          );

          await prisma.attachment.create({
            data: {
              scanRecordId: scan.id,
              fileName: `pos-data-${scan.id}.xlsx`,
              storageKey: excelFile.storageKey,
              fileSize: excelFile.fileSize,
              mimeType: excelFile.mimeType,
            },
          });
          logAction({
            actorId: req.user!.userId,
            action: 'ATTACHMENT_UPLOADED',
            details: { fileName: `pos-data-${scan.id}.xlsx`, fileSize: excelFile.fileSize, scanRecordId: scan.id },
            ip: req.ip,
            userAgent: req.headers['user-agent'],
          });
        }
      } catch (err) {
        log.error({ err }, 'Failed to generate POS Excel export');
      }
    }

    res.status(201).json(scan);
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'Create error');
    throw new AppError('Failed to save scan record', 500);
  }
}));

// ── GET /api/scans/health ─────────────────────────────────────────────────────
router.get('/health', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const days = Math.max(0, Math.min(365, Math.round(Number(req.query['days']) || 3)));
    const locationWhere = locationFilter(req.user!);
    const scopeFilter = Object.keys(locationWhere).length ? { location: locationWhere } : {};
    const cutoff = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
    const countWhere = {
      ...(cutoff && { createdAt: { gte: cutoff } }),
      ...scopeFilter,
    };

    const [
      totalScans,
      successfulScans,
      failedScans,
      pendingScans,
      mappedScans,
      pendingApprovalScans,
      lastScan,
      lastSuccess,
      lastFailure,
    ] = await Promise.all([
      prisma.scanRecord.count({ where: countWhere }),
      prisma.scanRecord.count({ where: { ...countWhere, status: 'SYNCED' } }),
      prisma.scanRecord.count({ where: { ...countWhere, status: 'FAILED' } }),
      prisma.scanRecord.count({ where: { ...countWhere, status: 'PENDING' } }),
      prisma.scanRecord.count({ where: { ...countWhere, status: 'MAPPED' } }),
      prisma.scanRecord.count({ where: { ...countWhere, status: 'PENDING_APPROVAL' } }),
      prisma.scanRecord.findFirst({ where: scopeFilter, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.scanRecord.findFirst({ where: { ...scopeFilter, status: 'SYNCED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.scanRecord.findFirst({ where: { ...scopeFilter, status: 'FAILED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);

    const successRate = totalScans > 0 ? (successfulScans / totalScans) * 100 : 0;

    res.json({
      totalScans,
      successfulScans,
      failedScans,
      pendingScans,
      mappedScans,
      pendingApprovalScans,
      successRate,
      lastScanAt: lastScan?.createdAt ?? null,
      lastSuccessAt: lastSuccess?.createdAt ?? null,
      lastFailureAt: lastFailure?.createdAt ?? null,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'Health error');
    throw new AppError('Failed to fetch scan health', 500);
  }
}));

router.get('/recent', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teamId = req.user!.adminId ?? req.user!.userId;
    const recentScans = await prisma.scanRecord.findMany({
      where: {
        location: { adminId: teamId },
        source: { in: ['pos', 'excel', 'image'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        source: true,
        status: true,
        createdAt: true,
        scanDate: true,
        transactionType: true,
        location: { select: { name: true } },
      },
    });
    res.json({ scans: recentScans });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'Recent error');
    throw new AppError('Failed to fetch recent scans', 500);
  }
}));

router.post('/bulk-approve', requireFeaturePermission('drafts', 'execute'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const scanIds: string[] = Array.isArray(req.body?.scanIds)
    ? (req.body.scanIds as unknown[]).map((id: unknown) => String(id))
    : [];
  const uniqueScanIds = Array.from(new Set(scanIds)).slice(0, 50);

  if (!uniqueScanIds.length) {
    throw new AppError('scanIds must be a non-empty array', 400);
  }

  const scans = await prisma.scanRecord.findMany({
    where: {
      id: { in: uniqueScanIds },
      location: { ...locationFilter(req.user!) },
    },
    select: { id: true, status: true, submittedById: true, locationId: true },
  });

  const approvableScans = scans.filter((scan) => scan.status === 'PENDING_APPROVAL' && scan.submittedById !== userId);
  const approvedIds = approvableScans.map((scan) => scan.id);

  if (approvedIds.length) {
    await prisma.$transaction(approvedIds.map((id) => prisma.scanRecord.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
      },
    })));

    await Promise.all(approvableScans.map((scan) => logAction({
      actorId: userId,
      action: 'DRAFT_APPROVED',
      details: { scanRecordId: scan.id, locationId: scan.locationId },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })));
  }

  res.json({ approved: approvedIds.length, skipped: uniqueScanIds.length - approvedIds.length });
}));

router.delete('/:id', requireFeaturePermission('scan', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params['id']);
  const scan = await prisma.scanRecord.findFirst({
    where: {
      id,
      location: { ...locationFilter(req.user!) },
    },
    select: { id: true, status: true, locationId: true },
  });

  if (!scan) {
    throw new AppError('Scan record not found', 404);
  }
  if (scan.status === 'SYNCED') {
    throw new AppError('Cannot delete a synced scan record', 400);
  }

  await prisma.scanRecord.delete({ where: { id } });

  await logAction({
    actorId: req.user!.userId,
    action: 'SCAN_DELETED',
    details: { scanRecordId: id, locationId: scan.locationId },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.json({ success: true, deletedId: id });
}));

router.post('/bulk-delete', requireFeaturePermission('scan', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const scanIds: string[] = Array.isArray(req.body?.scanIds)
    ? (req.body.scanIds as unknown[]).map((id: unknown) => String(id))
    : [];
  const uniqueScanIds = Array.from(new Set(scanIds)).slice(0, 50);

  if (!uniqueScanIds.length) {
    throw new AppError('scanIds must be a non-empty array', 400);
  }

  const scans = await prisma.scanRecord.findMany({
    where: {
      id: { in: uniqueScanIds },
      location: { ...locationFilter(req.user!) },
    },
    select: { id: true, status: true, locationId: true },
  });

  const deletableIds = scans.filter((scan) => scan.status !== 'SYNCED').map((scan) => scan.id);
  const skipped = uniqueScanIds.length - deletableIds.length;

  let deletedCount = 0;
  if (deletableIds.length) {
    const result = await prisma.$transaction([
      prisma.scanRecord.deleteMany({ where: { id: { in: deletableIds } } }),
    ]);
    deletedCount = result[0].count;

    await Promise.all(deletableIds.map((id) => logAction({
      actorId: req.user!.userId,
      action: 'SCAN_DELETED',
      details: { scanRecordId: id },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })));
  }

  res.json({ deleted: deletedCount, skipped });
}));

// ── GET /api/scans/:id ────────────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const scan = await prisma.scanRecord.findUnique({
      where: { id },
      include: {
        location: true,
        syncLogs: true,
        attachments: {
          select: { id: true, fileName: true, fileSize: true, mimeType: true, createdAt: true },
        },
      },
    });

    if (!scan) {
      throw new AppError('Scan record not found', 404);
    }
    // Verify location access
    const hasAccess = await prisma.location.count({
      where: { id: scan.location.id, ...locationFilter(req.user!) },
    });
    if (!hasAccess) {
      throw new AppError('Scan record not found', 404);
    }

    res.json(scan);
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'Get error');
    throw new AppError('Failed to fetch scan record', 500);
  }
}));

router.get('/:id/attachment-url', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const attachment = await prisma.attachment.findFirst({
      where: {
        scanRecord: {
          id,
          location: {
            ...locationFilter(req.user!),
          },
        },
      },
      select: { storageKey: true },
    });

    if (!attachment) {
      throw new AppError('Attachment not found', 404);
    }

    const url = await getPresignedUrl(attachment.storageKey);
    res.json({ url });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err }, 'Attachment URL error');
    throw new AppError('Failed to fetch attachment URL', 500);
  }
}));

router.post('/:id/submit', requireFeaturePermission('scan', 'write'), validate(scanSubmitSchema), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params['id']);
  const userId = req.user!.userId;

  const scan = await prisma.scanRecord.findFirst({ where: { id }, select: { status: true, locationId: true } });
  if (!scan) {
    throw new AppError('Scan record not found', 404);
  }

  if (!['PENDING', 'MAPPED', 'REJECTED'].includes(scan.status)) {
    throw new AppError(`Cannot submit scan with status: ${scan.status}`, 400);
  }

  const updated = await prisma.scanRecord.update({
    where: { id },
    data: {
      status: 'PENDING_APPROVAL',
      submittedById: userId,
      submittedAt: new Date(),
      approvedById: null,
      approvedAt: null,
      approvalNotes: null,
    },
  });

  await logAction({
    actorId: userId,
    action: 'DRAFT_SUBMITTED',
    details: { scanRecordId: id, locationId: scan.locationId },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.json(updated);
}));

router.post('/:id/approve', requireFeaturePermission('drafts', 'execute'), validate(scanApproveSchema), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params['id']);
  const userId = req.user!.userId;

  const scan = await prisma.scanRecord.findFirst({ where: { id }, select: { status: true, locationId: true, submittedById: true } });
  if (!scan) {
    throw new AppError('Scan record not found', 404);
  }
  if (scan.status !== 'PENDING_APPROVAL') {
    throw new AppError(`Cannot approve scan with status: ${scan.status}`, 400);
  }
  if (scan.submittedById === userId) {
    throw new AppError('You cannot approve your own submission', 403);
  }

  const updated = await prisma.scanRecord.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approvedById: userId,
      approvedAt: new Date(),
    },
  });

  await logAction({
    actorId: userId,
    action: 'DRAFT_APPROVED',
    details: { scanRecordId: id, locationId: scan.locationId },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.json(updated);
}));

router.post('/:id/reject', requireFeaturePermission('drafts', 'execute'), validate(scanRejectSchema), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params['id']);
  const userId = req.user!.userId;
  const { notes } = req.body as { notes?: string };

  const scan = await prisma.scanRecord.findFirst({ where: { id }, select: { status: true, locationId: true } });
  if (!scan) {
    throw new AppError('Scan record not found', 404);
  }
  if (scan.status !== 'PENDING_APPROVAL') {
    throw new AppError(`Cannot reject scan with status: ${scan.status}`, 400);
  }

  const updated = await prisma.scanRecord.update({
    where: { id },
    data: {
      status: 'REJECTED',
      approvedById: userId,
      approvedAt: new Date(),
      approvalNotes: notes ?? null,
    },
  });

  await logAction({
    actorId: userId,
    action: 'DRAFT_REJECTED',
    details: { scanRecordId: id, locationId: scan.locationId, notes },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.json(updated);
}));

// AI Invoice Parsing — sends image to Gemini 2.5 Flash
router.post(
  '/parse-invoice',
  requireFeaturePermission('scan', 'write'),
  requireCapacity('scan'),
  upload.single('file'),
  checkStorageQuota,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    let attachment: { fileName: string; storageKey: string; fileSize: number; mimeType: string } | null = null;
    if (req.file) {
      try {
        attachment = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, req.user!.userId);
      } catch (err) {
        log.error({ err }, 'Failed to upload file');
      }
    }

    try {
      await deductBonusScan(req.user!.adminId ?? req.user!.userId);
      const result = await parseInvoiceWithGemini(req.file.buffer, req.file.mimetype);
      res.json({ success: true, attachment, data: result });
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err.message?.includes('GEMINI_API_KEY')) {
        throw new AppError('AI scanning is not configured. Please set GEMINI_API_KEY.', 503);
      }
      const detail = process.env.NODE_ENV !== 'production' ? `: ${err.message}` : '. Please try again.';
      throw new AppError(`AI parsing failed${detail}`, 500);
    }
  })
);

router.post(
  '/parse-document',
  requireFeaturePermission('scan', 'write'),
  requireCapacity('scan'),
  upload.single('file'),
  checkStorageQuota,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    let attachment: { fileName: string; storageKey: string; fileSize: number; mimeType: string } | null = null;
    if (req.file) {
      try {
        attachment = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, req.user!.userId);
      } catch (err) {
        log.error({ err }, 'Failed to upload file');
      }
    }

    try {
      await deductBonusScan(req.user!.adminId ?? req.user!.userId);
      const result = await parseDocumentWithGemini(req.file.buffer, req.file.mimetype);
      res.json({
        success: true,
        attachment,
        data: {
          classification: result.classification,
          invoiceData: result.invoiceData,
          chequeData: result.chequeData,
        },
      });
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      const isServiceUnavailable = err?.status === 503
        || err?.message?.includes('503')
        || err?.message?.includes('Service Unavailable')
        || err?.message?.toLowerCase().includes('high demand');

      if (isServiceUnavailable) {
        throw new AppError('AI service is temporarily busy (high demand). Please wait about 30 seconds and try again.', 503);
      }

      if (err.message?.includes('GEMINI_API_KEY')) {
        throw new AppError('AI scanning is not configured. Please set GEMINI_API_KEY.', 503);
      }
      const detail = process.env.NODE_ENV !== 'production' ? `: ${err.message}` : '. Please try again.';
      throw new AppError(`AI parsing failed${detail}`, 500);
    }
  })
);

router.post(
  '/parse-pos-tab',
  authenticate,
  enforceEffectiveRole,
  requireFeaturePermission('scan', 'write'),
  upload.single('file'),
  checkStorageQuota,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file) {
      throw new AppError('Image file is required', 400);
    }
    const tabUrl = typeof req.body.tabUrl === 'string' ? req.body.tabUrl : undefined;

    let attachment: { fileName: string; storageKey: string; fileSize: number; mimeType: string } | null = null;
    if (req.file) {
      try {
        attachment = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, req.user!.userId);
      } catch (err) {
        log.error({ err }, 'Failed to upload file');
      }
    }

    const detection = await detectPOS(req.file.buffer, req.file.mimetype);
    if (!detection.isPOS) {
      return res.json({ detection, data: null, attachment } as ParsePOSTabResponse);
    }

    const posType = detection.posType || 'unknown_pos';
    const data = await parsePOSReport(req.file.buffer, req.file.mimetype, posType);

    return res.json({ detection, data, attachment } as ParsePOSTabResponse);
  })
);

export default router;
