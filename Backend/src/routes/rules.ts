import { AppError, asyncHandler } from '../lib/errors';
import { Router, Response } from 'express';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { prisma } from '../lib/prisma';

const router = Router();

router.use(authenticate, enforceEffectiveRole);

// ── PUT /api/rules/:id ────────────────────────────────────────────────────────
router.put('/:id', requireFeaturePermission('rules', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const rule = await prisma.rule.findFirst({
      where: { id, location: locationFilter(req.user!) },
      include: { location: true },
    });

    if (!rule) {
      throw new AppError('Rule not found', 404);
    }

    const { name, ruleType, config, isActive } = req.body as {
      name?: string; ruleType?: string; config?: object; isActive?: boolean;
    };

    const validTypes = ['COMBINE', 'DEDUCT', 'THRESHOLD', 'FORMULA'];
    if (ruleType && !validTypes.includes(ruleType)) {
      throw new AppError(`ruleType must be one of: ${validTypes.join(', ')}`, 400);
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
    throw new AppError('Failed to update rule', 500);
  }
}));

// ── DELETE /api/rules/:id ─────────────────────────────────────────────────────
router.delete('/:id', requireFeaturePermission('rules', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const rule = await prisma.rule.findFirst({
      where: { id, location: locationFilter(req.user!) },
      include: { location: true },
    });

    if (!rule) {
      throw new AppError('Rule not found', 404);
    }

    await prisma.rule.delete({ where: { id } });
    res.json({ message: 'Rule deleted' });
  } catch (err) {
    console.error('[Rules] delete error:', err);
    throw new AppError('Failed to delete rule', 500);
  }
}));

export default router;
