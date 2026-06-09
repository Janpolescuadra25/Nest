import { AppError, asyncHandler } from '../lib/errors';
import { Router, Response } from 'express';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { prisma } from '../lib/prisma';
import { applyRules, applyRulesToLineItems } from '../services/rules.engine';

const router = Router();

router.use(authenticate, enforceEffectiveRole);

async function getTemplateOrFail(templateId: string, user: AuthRequest['user']) {
  const template = await prisma.template.findFirst({
    where: { id: templateId, location: { ...locationFilter(user!) } },
  });
  if (!template) {
    throw new AppError('Template not found', 404);
  }
  return template;
}

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

    const { name, ruleType, config, isActive, templateId } = req.body as {
      name?: string; ruleType?: string; config?: object; isActive?: boolean; templateId?: string | null;
    };

    const validTypes = ['COMBINE', 'DEDUCT', 'THRESHOLD', 'FORMULA'];
    if (ruleType && !validTypes.includes(ruleType)) {
      throw new AppError(`ruleType must be one of: ${validTypes.join(', ')}`, 400);
    }

    let template;
    if (templateId !== undefined && templateId) {
      template = await getTemplateOrFail(templateId, req.user);
      if (template.locationId !== rule.locationId) {
        throw new AppError('Template not found', 404);
      }
    }

    const updated = await prisma.rule.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(ruleType !== undefined && { ruleType: ruleType as 'COMBINE' | 'DEDUCT' | 'THRESHOLD' | 'FORMULA' }),
        ...(config !== undefined && { config }),
        ...(isActive !== undefined && { isActive }),
        ...(templateId !== undefined && { templateId: templateId || null }),
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

router.post('/apply', requireFeaturePermission('rules', 'read'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { scanData, lineItems, rules } = req.body as {
    scanData?: Record<string, number>;
    lineItems?: Record<string, string>[];
    rules: Array<{
      id: string;
      name: string;
      ruleType: 'COMBINE' | 'DEDUCT' | 'THRESHOLD' | 'FORMULA';
      config: Record<string, unknown>;
      isActive: boolean;
    }>;
  };

  if (!rules || !Array.isArray(rules)) {
    res.status(400).json({ error: 'Rules array is required' });
    return;
  }

  const activeRules = rules.filter((r) => r.isActive);
  if (activeRules.length === 0) {
    if (scanData) {
      res.json({ type: 'flat', data: scanData });
      return;
    }
    if (Array.isArray(lineItems)) {
      res.json({ type: 'lineItems', data: lineItems });
      return;
    }
    res.status(400).json({ error: 'Provide scanData or lineItems' });
    return;
  }

  if (scanData && typeof scanData === 'object' && !Array.isArray(scanData)) {
    const result = applyRules(scanData, activeRules);
    res.json({ type: 'flat', data: result });
    return;
  }

  if (Array.isArray(lineItems)) {
    const processedLineItems = applyRulesToLineItems(lineItems, activeRules);
    res.json({ type: 'lineItems', data: processedLineItems });
    return;
  }

  res.status(400).json({ error: 'Provide scanData or lineItems' });
}));

export default router;
