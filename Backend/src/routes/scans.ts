import { AppError, asyncHandler } from '../lib/errors';
import { Router, Response, Request, NextFunction } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import pdfParse from 'pdf-parse';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import type { Prisma } from '@prisma/client';
import { ScanRawData } from '../types';
import { prisma } from '../lib/prisma';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb: any) => {
    const allowedExts = ['.pdf', '.png', '.jpg', '.jpeg'];
    const extension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
    if (!allowedExts.includes(extension)) {
      return cb(new Error('Only PDF and image files are supported'), false);
    }
    cb(null, true);
  },
});

function getSourceFromFilename(fileName: string): 'pdf' | 'image' {
  return fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image';
}

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const pdfParseFn = pdfParse as unknown as (data: Buffer) => Promise<{ text?: string }>;
  const data = await pdfParseFn(buffer);
  return (typeof data.text === 'string' ? data.text.trim() : '') || '';
}

router.use(authenticate, enforceEffectiveRole);

router.post('/upload', requireFeaturePermission('scan', 'write'), (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('File size must be 10MB or less', 400));
      }
      return next(new AppError(err.message || 'File upload failed', 400));
    }
    next();
  });
}, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = req.file;
    const { locationId, scanDate } = req.body as { locationId?: string; scanDate?: string };

    if (!file) {
      throw new AppError('File is required', 400);
    }
    if (!locationId || !scanDate) {
      throw new AppError('locationId and scanDate are required', 400);
    }

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

    const source = getSourceFromFilename(file.originalname);
    const rawText = source === 'pdf' ? await extractTextFromPDF(file.buffer) : '';

    const scanEntry = {
      id: crypto.randomUUID(),
      source,
      fileName: file.originalname,
      header: {} as Record<string, string>,
      lineItems: [] as Record<string, string>[],
      rawText,
    };

    res.status(200).json(scanEntry);
  } catch (err) {
    console.error('[Scans] upload error:', err);
    throw new AppError('Failed to parse uploaded file', 500);
  }
}));

// ── POST /api/scans ───────────────────────────────────────────────────────────
// Save raw Toast POS scan data for a location
router.post('/', requireFeaturePermission('scan', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { locationId, scanDate, rawData, rawScanEntry, source } = req.body as {
      locationId?: string;
      scanDate?: string;
      rawData?: ScanRawData;
      rawScanEntry?: unknown;
      source?: string;
    };

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
      },
    });

    res.status(201).json(scan);
  } catch (err) {
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
    console.error('[Scans] get error:', err);
    throw new AppError('Failed to fetch scan record', 500);
  }
}));

export default router;
