import { AppError, asyncHandler } from '../lib/errors';
import { Router, Response } from 'express';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import type { Prisma } from '@prisma/client';
import { ScanRawData } from '../types';
import { prisma } from '../lib/prisma';
import multer from 'multer';
import { parseDocumentWithGemini, parseInvoiceWithGemini } from '../lib/gemini';
import { validateTransactionType } from './templates';

const router = Router();

// Multer config for AI invoice parsing (memory storage, 10MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

router.use(authenticate, enforceEffectiveRole);

// ── POST /api/scans ───────────────────────────────────────────────────────────
// Save raw Toast POS scan data for a location
router.post('/', requireFeaturePermission('scan', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { locationId, scanDate, rawData, rawScanEntry, source, transactionType } = req.body as {
      locationId?: string;
      scanDate?: string;
      rawData?: ScanRawData;
      rawScanEntry?: unknown;
      source?: string;
      transactionType?: string;
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
        rawScanEntry: rawScanEntry ? rawScanEntry as unknown as Prisma.InputJsonValue : null,
        source: source || 'pos',
        status: 'PENDING',
        ...(transactionType ? { transactionType } : {}),
      },
    });

    res.status(201).json(scan);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Scans] create error:', err);
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
      lastScan,
      lastSuccess,
      lastFailure,
    ] = await Promise.all([
      prisma.scanRecord.count({ where: countWhere }),
      prisma.scanRecord.count({ where: { ...countWhere, status: 'SYNCED' } }),
      prisma.scanRecord.count({ where: { ...countWhere, status: 'FAILED' } }),
      prisma.scanRecord.count({ where: { ...countWhere, status: 'PENDING' } }),
      prisma.scanRecord.count({ where: { ...countWhere, status: 'MAPPED' } }),
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
      successRate,
      lastScanAt: lastScan?.createdAt ?? null,
      lastSuccessAt: lastSuccess?.createdAt ?? null,
      lastFailureAt: lastFailure?.createdAt ?? null,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[Scans] health error:', err);
    throw new AppError('Failed to fetch scan health', 500);
  }
}));

// ── GET /api/scans/:id ────────────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const scan = await prisma.scanRecord.findUnique({
      where: { id },
      include: { location: true, syncLogs: true },
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
    console.error('[Scans] get error:', err);
    throw new AppError('Failed to fetch scan record', 500);
  }
}));

// AI Invoice Parsing — sends image to Gemini 2.5 Flash
router.post(
  '/parse-invoice',
  requireFeaturePermission('scan', 'write'),
  upload.single('file'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    try {
      const result = await parseInvoiceWithGemini(req.file.buffer, req.file.mimetype);
      res.json({ success: true, data: result });
    } catch (err: any) {
      if (err.message?.includes('GEMINI_API_KEY')) {
        throw new AppError('AI scanning is not configured. Please set GEMINI_API_KEY.', 503);
      }
      throw new AppError(`AI parsing failed: ${err.message}`, 500);
    }
  })
);

router.post(
  '/parse-document',
  requireFeaturePermission('scan', 'write'),
  upload.single('file'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    try {
      const result = await parseDocumentWithGemini(req.file.buffer, req.file.mimetype);
      res.json({
        success: true,
        data: {
          classification: result.classification,
          invoiceData: result.invoiceData,
          chequeData: result.chequeData,
        },
      });
    } catch (err: any) {
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
      throw new AppError(`AI parsing failed: ${err.message}`, 500);
    }
  })
);

export default router;
