import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { ScanRawData } from '../types';

const router = Router();
const prisma = new PrismaClient();

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

    // Verify the location belongs to the authenticated user
    const location = await prisma.location.findFirst({
      where: { id: locationId, userId: req.user!.userId },
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
        rawData,
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
    const scan = await prisma.scanRecord.findUnique({
      where: { id: req.params.id },
      include: { location: true, syncLogs: true },
    });

    if (!scan || scan.location.userId !== req.user!.userId) {
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
