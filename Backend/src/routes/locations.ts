import { Router, Response } from 'express';
import { authenticate, AuthRequest, locationFilter, requirePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { prisma } from '../lib/prisma';
import { parsePagination, buildPaginationMeta } from '../lib/pagination';

const router = Router();

// All location routes require authentication + effective role enforcement
router.use(authenticate, enforceEffectiveRole);

// ── GET /api/locations ────────────────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
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
    console.error('[Locations] list error:', err);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// ── POST /api/locations ───────────────────────────────────────────────────────
router.post('/', requirePermission('canManageLocs'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, posUrl } = req.body as { name?: string; posUrl?: string };

    if (!name || !posUrl) {
      res.status(400).json({ error: 'name and posUrl are required' });
      return;
    }

    const user = req.user!;
    const adminId =
      user.role === 'OWNER' ? null
      : user.role === 'ADMIN' ? user.userId
      : user.adminId ?? null;

    const location = await prisma.location.create({
      data: { userId: user.userId, adminId, name, posUrl },
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
      where: { id, ...locationFilter(req.user!) },
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
router.put('/:id', requirePermission('canManageLocs'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const existing = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
    });

    if (!existing) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const { name, posUrl, isActive, memoTemplate, docNumberTemplate } = req.body as {
      name?: string; posUrl?: string; isActive?: boolean;
      memoTemplate?: string; docNumberTemplate?: string;
    };

    const updated = await prisma.location.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(posUrl !== undefined && { posUrl }),
        ...(isActive !== undefined && { isActive }),
        ...(memoTemplate !== undefined && { memoTemplate }),
        ...(docNumberTemplate !== undefined && { docNumberTemplate }),
      },
    });

    res.json(updated);
  } catch (err) {
    console.error('[Locations] update error:', err);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// ── DELETE /api/locations/:id ─────────────────────────────────────────────────
router.delete('/:id', requirePermission('canManageLocs'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const existing = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
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

// ── POST /api/locations/:id/import-template ──────────────────────────────────
router.post('/:id/import-template', requirePermission('canMap'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    const lf = locationFilter(req.user!);

    const location = await prisma.location.findFirst({
      where: { id, ...lf },
    });
    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const body = req.body as {
      mappings?: Array<Record<string, unknown>>;
      rules?: Array<Record<string, unknown>>;
      memoTemplate?: string;
      docNumberTemplate?: string;
      mode?: 'replace' | 'merge';
    };

    const mode = body.mode || 'merge';

    if (!body.mappings?.length && !body.rules?.length && body.memoTemplate === undefined && body.docNumberTemplate === undefined) {
      res.status(400).json({ error: 'No template data provided' });
      return;
    }
    if (body.mappings && !Array.isArray(body.mappings)) {
      res.status(400).json({ error: 'mappings must be an array' });
      return;
    }
    if (body.rules && !Array.isArray(body.rules)) {
      res.status(400).json({ error: 'rules must be an array' });
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
          await tx.mapping.create({
            data: {
              locationId: id,
              sourceField: sf,
              targetAccount: ta,
              postingType: m['postingType'] === 'Debit' ? 'Debit' : 'Credit',
              keepSeparate: Boolean(m['keepSeparate']),
              targetClass: m['targetClass'] ? String(m['targetClass']) : null,
              targetName: m['targetName'] ? String(m['targetName']) : null,
              targetDescription: m['targetDescription'] ? String(m['targetDescription']) : null,
              targetMemo: m['targetMemo'] ? String(m['targetMemo']) : null,
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

      if (body.memoTemplate !== undefined || body.docNumberTemplate !== undefined) {
        await tx.location.update({
          where: { id },
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
    const message = err instanceof Error ? err.message : 'Import failed';
    console.error('[import-template]', message);
    res.status(500).json({
      error: process.env.NODE_ENV !== 'production'
        ? message
        : 'Template import failed. Please try again.',
    });
  }
});

// ── GET /api/locations/:id/mappings ───────────────────────────────────────────
router.get('/:id/mappings', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
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
router.post('/:id/mappings', requirePermission('canMap'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
    });

    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const { sourceField, targetAccount, postingType, keepSeparate, targetClass, targetName, targetDescription, targetMemo, priority } =
      req.body as {
        sourceField?: string; targetAccount?: string; postingType?: string; keepSeparate?: boolean;
        targetClass?: string; targetName?: string; targetDescription?: string; targetMemo?: string; priority?: number;
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
        postingType: postingType ?? 'Credit',
        keepSeparate: keepSeparate ?? false,
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
      where: { id, ...locationFilter(req.user!) },
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
router.post('/:id/rules', requirePermission('canMap'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const location = await prisma.location.findFirst({
      where: { id, ...locationFilter(req.user!) },
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
      where: { id, ...locationFilter(req.user!) },
    });

    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const { page, limit, skip } = parsePagination(req.query);
    const take = limit + 1;

    const rows = await prisma.scanRecord.findMany({
      where: { locationId: id },
      orderBy: { scanDate: 'desc' },
      include: { syncLogs: true },
      skip,
      take,
    });

    const hasMore = rows.length > limit;
    const scans = hasMore ? rows.slice(0, limit) : rows;

    res.json({ scans, hasMore });
  } catch (err) {
    console.error('[Locations] scans list error:', err);
    res.status(500).json({ error: 'Failed to fetch scans' });
  }
});

export default router;
