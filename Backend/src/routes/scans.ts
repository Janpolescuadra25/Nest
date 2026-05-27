import { Router, Response } from 'express';
import { authenticate, AuthRequest, locationFilter } from '../middleware/auth.middleware';
import type { Prisma } from '@prisma/client';
import { ScanRawData } from '../types';
import { prisma } from '../lib/prisma';

const router = Router();

router.use(authenticate);

// ── POST /api/scans ───────────────────────────────────────────────────────────
// Save raw Toast POS scan data for a location
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
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
