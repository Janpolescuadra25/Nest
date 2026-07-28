import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { qbService } from '../services/qb.service';
import { suggestProductMappings } from '../lib/gemini';
import { prisma } from '../lib/prisma';
import { AppError, asyncHandler } from '../lib/errors';

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

function serializeProductMapping(mapping: { id: string; templateId: string; productId: string; accountId: string; postingType: string; classId: string | null; matchingRule: unknown; createdAt: Date; product: { name: string } }) {
  return {
    id: mapping.id,
    templateId: mapping.templateId,
    productId: mapping.productId,
    productName: mapping.product.name,
    accountId: mapping.accountId,
    postingType: mapping.postingType,
    classId: mapping.classId,
    matchingRule: mapping.matchingRule,
    createdAt: mapping.createdAt,
  };
}

router.get('/:templateId', requireFeaturePermission('map', 'read'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const template = await getTemplateOrFail(String(req.params.templateId), req.user);
  const mappings = await prisma.productMapping.findMany({
    where: { templateId: template.id },
    include: { product: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(mappings.map(serializeProductMapping));
}));

router.post('/', requireFeaturePermission('map', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { templateId, productId, accountId, postingType, classId } = req.body as {
    templateId?: string;
    productId?: string;
    accountId?: string;
    postingType?: string;
    classId?: string;
  };

  if (!templateId || !productId || !accountId || !postingType) {
    throw new AppError('templateId, productId, accountId, and postingType are required', 400);
  }
  if (postingType !== 'Debit' && postingType !== 'Credit') {
    throw new AppError('postingType must be Debit or Credit', 400);
  }

  const template = await getTemplateOrFail(templateId, req.user);
  const product = await prisma.product.findFirst({
    where: { id: productId, userId: req.user!.userId },
  });
  if (!product) {
    throw new AppError('Product not found', 404);
  }

  const existing = await prisma.productMapping.findFirst({
    where: { templateId: template.id, productId: product.id },
  });
  if (existing) {
    throw new AppError('A product mapping for this template already exists', 409);
  }

  const mapping = await prisma.productMapping.create({
    data: {
      templateId: template.id,
      productId: product.id,
      accountId: accountId.trim(),
      postingType,
      classId: classId?.trim() || null,
    },
    include: { product: { select: { name: true } } },
  });

  res.status(201).json(serializeProductMapping(mapping));
}));

router.put('/:id', requireFeaturePermission('map', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { accountId, postingType, classId, matchingRule } = req.body as {
    accountId?: string;
    postingType?: string;
    classId?: string | null;
    matchingRule?: Record<string, unknown> | null;
  };

  const mapping = await prisma.productMapping.findUnique({ where: { id } });
  if (!mapping) {
    throw new AppError('Product mapping not found', 404);
  }
  await getTemplateOrFail(mapping.templateId, req.user);

  if (postingType !== undefined && postingType !== 'Debit' && postingType !== 'Credit') {
    throw new AppError('postingType must be Debit or Credit', 400);
  }

  const updated = await prisma.productMapping.update({
    where: { id },
    data: {
      ...(accountId !== undefined ? { accountId: accountId.trim() } : {}),
      ...(postingType !== undefined ? { postingType } : {}),
      ...(classId !== undefined ? { classId: classId?.trim() || null } : {}),
      ...(matchingRule !== undefined ? { matchingRule: matchingRule as unknown as Prisma.InputJsonValue } : {}),
    },
    include: { product: { select: { name: true } } },
  });

  res.json(serializeProductMapping(updated));
}));

router.delete('/:id', requireFeaturePermission('map', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const mapping = await prisma.productMapping.findUnique({ where: { id } });
  if (!mapping) {
    throw new AppError('Product mapping not found', 404);
  }
  await getTemplateOrFail(mapping.templateId, req.user);

  await prisma.productMapping.delete({ where: { id } });
  res.json({ success: true });
}));

router.post('/suggest', requireFeaturePermission('map', 'read'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { templateId, scanProductNames } = req.body as {
    templateId?: string;
    scanProductNames?: string[];
  };

  if (!templateId || !Array.isArray(scanProductNames) || scanProductNames.length === 0) {
    throw new AppError('templateId and scanProductNames are required', 400);
  }

  const template = await getTemplateOrFail(templateId, req.user);

  const products = await prisma.product.findMany({
    where: { userId: req.user!.userId },
  });
  const productMap = new Map(products.map((product) => [product.name.trim().toLowerCase(), product.id]));

  const suggestions = await qbService.callQB(req.user!.userId, async ({ accessToken, realmId }) => {
    const accounts = await qbService.getAccounts(realmId, accessToken);
    const accountNames = accounts.map((account) => account.FullyQualifiedName);
    const accountTypes = accounts.map((account) => ({
      name: account.FullyQualifiedName,
      type: account.AccountType,
      subType: account.AccountSubType || '',
    }));

    const aiSuggestions = await suggestProductMappings(
      scanProductNames,
      accountNames,
      template.transactionType,
      accountTypes,
    );

    return aiSuggestions.map((suggestion) => {
      const matchedAccount = accounts.find((account) =>
        account.FullyQualifiedName.toLowerCase() === suggestion.accountName.toLowerCase() ||
        account.FullyQualifiedName.toLowerCase().includes(suggestion.accountName.toLowerCase()) ||
        account.FullyQualifiedName.toLowerCase().includes(suggestion.accountHint.toLowerCase())
      );

      const warnings: string[] = [];
      if (suggestion.postingType !== 'Debit' && suggestion.postingType !== 'Credit') {
        warnings.push(`AI suggested invalid posting type "${suggestion.postingType}"`);
      }

      if (matchedAccount) {
        const CREDIT_NATURED = new Set([
          'Revenue', 'Income', 'Other Income',
          'Liability', 'Other Current Liability', 'Long Term Liability', 'Deferred Revenue',
          'Equity', 'Non-Posting',
        ]);
        const isCreditNatured = CREDIT_NATURED.has(matchedAccount.AccountType);
        const expectedPosting = isCreditNatured ? 'Credit' : 'Debit';

        if (suggestion.postingType !== expectedPosting) {
          warnings.push(`Account "${matchedAccount.FullyQualifiedName}" is ${matchedAccount.AccountType} (normally ${expectedPosting}), but AI suggested ${suggestion.postingType}`);
        }
      }

      return {
        ...suggestion,
        accountId: matchedAccount?.Id,
        accountType: matchedAccount?.AccountType,
        productId: productMap.get(suggestion.productName.trim().toLowerCase()),
        validationWarning: warnings.length > 0 ? warnings.join('; ') : undefined,
      };
    });
  });

  res.json({ suggestions });
}));

export default router;
