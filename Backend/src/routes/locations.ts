import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';

const router = Router();

// All location routes require authentication
router.use(authenticate);

// ── GET /api/locations ────────────────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const locations = await prisma.location.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(locations);
  } catch (err) {
    console.error('[Locations] list error:', err);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// ── POST /api/locations ───────────────────────────────────────────────────────
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, toastUrl } = req.body as { name?: string; toastUrl?: string };

    if (!name || !toastUrl) {
      res.status(400).json({ error: 'name and toastUrl are required' });
      return;
    }

    const location = await prisma.location.create({
      data: { userId: req.user!.userId, name, toastUrl },
    });

    res.status(201).json(location);
  } catch (err) {
    console.error('[Locations] create error:', err);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

// ── GET /api/locations/:id ────────────────────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, userId: req.user!.userId },
      include: { mappings: true, rules: true },
    });

    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    res.json(location);
  } catch (err) {
    console.error('[Locations] get error:', err);
    res.status(500).json({ error: 'Failed to fetch location' });
  }
});

// ── PUT /api/locations/:id ────────────────────────────────────────────────────
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const existing = await prisma.location.findFirst({
      where: { id, userId: req.user!.userId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const { name, toastUrl, isActive } = req.body as {
      name?: string; toastUrl?: string; isActive?: boolean;
    };

    const updated = await prisma.location.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(toastUrl !== undefined && { toastUrl }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json(updated);
  } catch (err) {
    console.error('[Locations] update error:', err);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// ── DELETE /api/locations/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const existing = await prisma.location.findFirst({
      where: { id, userId: req.user!.userId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    await prisma.location.delete({ where: { id } });
    res.json({ message: 'Location deleted' });
  } catch (err) {
    console.error('[Locations] delete error:', err);
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

// ── GET /api/locations/:id/mappings ───────────────────────────────────────────
router.get('/:id/mappings', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, userId: req.user!.userId },
    });

    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const mappings = await prisma.mapping.findMany({
      where: { locationId: id },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    res.json(mappings);
  } catch (err) {
    console.error('[Locations] mappings list error:', err);
    res.status(500).json({ error: 'Failed to fetch mappings' });
  }
});

// ── POST /api/locations/:id/mappings ──────────────────────────────────────────
router.post('/:id/mappings', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, userId: req.user!.userId },
    });

    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const { sourceField, targetAccount, targetClass, targetName, targetDescription, targetMemo, priority } =
      req.body as {
        sourceField?: string; targetAccount?: string; targetClass?: string;
        targetName?: string; targetDescription?: string; targetMemo?: string; priority?: number;
      };

    if (!sourceField || !targetAccount) {
      res.status(400).json({ error: 'sourceField and targetAccount are required' });
      return;
    }

    const mapping = await prisma.mapping.create({
      data: {
        locationId: id,
        sourceField,
        targetAccount,
        targetClass,
        targetName,
        targetDescription,
        targetMemo,
        priority: priority ?? 0,
      },
    });

    res.status(201).json(mapping);
  } catch (err) {
    console.error('[Locations] mapping create error:', err);
    res.status(500).json({ error: 'Failed to create mapping' });
  }
});

// ── GET /api/locations/:id/rules ──────────────────────────────────────────────
router.get('/:id/rules', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, userId: req.user!.userId },
    });

    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const rules = await prisma.rule.findMany({
      where: { locationId: id },
      orderBy: { createdAt: 'asc' },
    });

    res.json(rules);
  } catch (err) {
    console.error('[Locations] rules list error:', err);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

// ── POST /api/locations/:id/rules ─────────────────────────────────────────────
router.post('/:id/rules', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, userId: req.user!.userId },
    });

    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const { name, ruleType, config, isActive } = req.body as {
      name?: string; ruleType?: string; config?: object; isActive?: boolean;
    };

    const validTypes = ['COMBINE', 'DEDUCT', 'THRESHOLD', 'FORMULA'];
    if (!name || !ruleType || !config) {
      res.status(400).json({ error: 'name, ruleType, and config are required' });
      return;
    }

    if (!validTypes.includes(ruleType)) {
      res.status(400).json({ error: `ruleType must be one of: ${validTypes.join(', ')}` });
      return;
    }

    const rule = await prisma.rule.create({
      data: {
        locationId: id,
        name,
        ruleType: ruleType as 'COMBINE' | 'DEDUCT' | 'THRESHOLD' | 'FORMULA',
        config,
        isActive: isActive ?? true,
      },
    });

    res.status(201).json(rule);
  } catch (err) {
    console.error('[Locations] rule create error:', err);
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

// ── GET /api/locations/:id/scans ──────────────────────────────────────────────
router.get('/:id/scans', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, userId: req.user!.userId },
    });

    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const scans = await prisma.scanRecord.findMany({
      where: { locationId: id },
      orderBy: { scanDate: 'desc' },
      include: { syncLogs: true },
    });

    res.json(scans);
  } catch (err) {
    console.error('[Locations] scans list error:', err);
    res.status(500).json({ error: 'Failed to fetch scans' });
  }
});

export default router;
