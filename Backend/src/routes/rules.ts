import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';

const router = Router();

router.use(authenticate);

// ── PUT /api/rules/:id ────────────────────────────────────────────────────────
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const rule = await prisma.rule.findUnique({
      where: { id },
      include: { location: true },
    });

    if (!rule || rule.location.userId !== req.user!.userId) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    const { name, ruleType, config, isActive } = req.body as {
      name?: string; ruleType?: string; config?: object; isActive?: boolean;
    };

    const validTypes = ['COMBINE', 'DEDUCT', 'THRESHOLD', 'FORMULA'];
    if (ruleType && !validTypes.includes(ruleType)) {
      res.status(400).json({ error: `ruleType must be one of: ${validTypes.join(', ')}` });
      return;
    }

    const updated = await prisma.rule.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(ruleType !== undefined && { ruleType: ruleType as 'COMBINE' | 'DEDUCT' | 'THRESHOLD' | 'FORMULA' }),
        ...(config !== undefined && { config }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json(updated);
  } catch (err) {
    console.error('[Rules] update error:', err);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

// ── DELETE /api/rules/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const rule = await prisma.rule.findUnique({
      where: { id },
      include: { location: true },
    });

    if (!rule || rule.location.userId !== req.user!.userId) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    await prisma.rule.delete({ where: { id } });
    res.json({ message: 'Rule deleted' });
  } catch (err) {
    console.error('[Rules] delete error:', err);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

export default router;
