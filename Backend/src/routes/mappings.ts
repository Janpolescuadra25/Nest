import { AppError, asyncHandler } from '../lib/errors';
import { Router, Response } from 'express';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { prisma } from '../lib/prisma';

const router = Router();

router.use(authenticate, enforceEffectiveRole);

// ── PUT /api/mappings/:id ─────────────────────────────────────────────────────
router.put('/:id', requireFeaturePermission('map', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const mapping = await prisma.mapping.findFirst({
      where: { id, location: locationFilter(req.user!) },
      include: { location: true },
    });

    if (!mapping) {
      throw new AppError('Mapping not found', 404);
    }

    const { sourceField, targetAccount, postingType, keepSeparate, targetClass, targetName, targetDescription, targetMemo, priority } =
      req.body as {
        sourceField?: string; targetAccount?: string; postingType?: string; keepSeparate?: boolean; targetClass?: string;
        targetName?: string; targetDescription?: string; targetMemo?: string; priority?: number;
      };

    const updated = await prisma.mapping.update({
      where: { id },
      data: {
        ...(sourceField !== undefined && { sourceField }),
        ...(targetAccount !== undefined && { targetAccount }),
        ...(postingType !== undefined && { postingType }),
        ...(keepSeparate !== undefined && { keepSeparate }),
        ...(targetClass !== undefined && { targetClass }),
        ...(targetName !== undefined && { targetName }),
        ...(targetDescription !== undefined && { targetDescription }),
        ...(targetMemo !== undefined && { targetMemo }),
        ...(priority !== undefined && { priority }),
      },
    });

    res.json(updated);
  } catch (err) {
    console.error('[Mappings] update error:', err);
    throw new AppError('Failed to update mapping', 500);
  }
}));

// ── DELETE /api/mappings/:id ──────────────────────────────────────────────────
router.delete('/:id', requireFeaturePermission('map', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const mapping = await prisma.mapping.findFirst({
      where: { id, location: locationFilter(req.user!) },
      include: { location: true },
    });

    if (!mapping) {
      throw new AppError('Mapping not found', 404);
    }

    await prisma.mapping.delete({ where: { id } });
    res.json({ message: 'Mapping deleted' });
  } catch (err) {
    console.error('[Mappings] delete error:', err);
    throw new AppError('Failed to delete mapping', 500);
  }
}));

export default router;
