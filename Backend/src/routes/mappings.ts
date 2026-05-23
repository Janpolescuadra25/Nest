import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

// ── PUT /api/mappings/:id ─────────────────────────────────────────────────────
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const mapping = await prisma.mapping.findUnique({
      where: { id: req.params.id },
      include: { location: true },
    });

    if (!mapping || mapping.location.userId !== req.user!.userId) {
      res.status(404).json({ error: 'Mapping not found' });
      return;
    }

    const { sourceField, targetAccount, targetClass, targetName, targetDescription, targetMemo, priority } =
      req.body as {
        sourceField?: string; targetAccount?: string; targetClass?: string;
        targetName?: string; targetDescription?: string; targetMemo?: string; priority?: number;
      };

    const updated = await prisma.mapping.update({
      where: { id: req.params.id },
      data: {
        ...(sourceField !== undefined && { sourceField }),
        ...(targetAccount !== undefined && { targetAccount }),
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
    res.status(500).json({ error: 'Failed to update mapping' });
  }
});

// ── DELETE /api/mappings/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const mapping = await prisma.mapping.findUnique({
      where: { id: req.params.id },
      include: { location: true },
    });

    if (!mapping || mapping.location.userId !== req.user!.userId) {
      res.status(404).json({ error: 'Mapping not found' });
      return;
    }

    await prisma.mapping.delete({ where: { id: req.params.id } });
    res.json({ message: 'Mapping deleted' });
  } catch (err) {
    console.error('[Mappings] delete error:', err);
    res.status(500).json({ error: 'Failed to delete mapping' });
  }
});

export default router;
