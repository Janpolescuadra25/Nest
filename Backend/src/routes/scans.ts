import { Router, Response } from 'express';
import { authenticate, AuthRequest, locationFilter, requirePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import type { Prisma } from '@prisma/client';
import { ScanRawData } from '../types';
import { prisma } from '../lib/prisma';

const router = Router();

router.use(authenticate, enforceEffectiveRole);

// ── POST /api/scans ───────────────────────────────────────────────────────────
// Save raw Toast POS scan data for a location
router.post('/', requirePermission('canScan'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { locationId, scanDate, rawData } = req.body as {
      locationId?: string;
      scanDate?: string;
      rawData?: ScanRawData;
    };

    if (!locationId || !scanDate || !rawData) {
      res.status(400).json({ error: 'locationId, scanDate, and rawData are required' });
      return;
    }

    // Verify the location is visible to the authenticated user
    const location = await prisma.location.findFirst({
      where: { id: locationId, ...locationFilter(req.user!) },
    });

    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const parsedDate = new Date(scanDate);
    if (isNaN(parsedDate.getTime())) {
      res.status(400).json({ error: 'scanDate must be a valid ISO date string' });
      return;
    }

    const scan = await prisma.scanRecord.create({
      data: {
        locationId,
        scanDate: parsedDate,
        rawData: rawData as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
      },
    });

    res.status(201).json(scan);
  } catch (err) {
    console.error('[Scans] create error:', err);
    res.status(500).json({ error: 'Failed to save scan record' });
  }
});

// ── GET /api/scans/health ─────────────────────────────────────────────────────
router.get('/health', async (req: AuthRequest, res: Response): Promise<void> => {
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
    res.status(500).json({ error: 'Failed to fetch scan health' });
  }
});

// ── GET /api/scans/:id ────────────────────────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const scan = await prisma.scanRecord.findUnique({
      where: { id },
      include: { location: true, syncLogs: true },
    });

    if (!scan) {
      res.status(404).json({ error: 'Scan record not found' });
      return;
    }
    // Verify location access
    const hasAccess = await prisma.location.count({
      where: { id: scan.location.id, ...locationFilter(req.user!) },
    });
    if (!hasAccess) {
      res.status(404).json({ error: 'Scan record not found' });
      return;
    }

    res.json(scan);
  } catch (err) {
    console.error('[Scans] get error:', err);
    res.status(500).json({ error: 'Failed to fetch scan record' });
  }
});

export default router;
