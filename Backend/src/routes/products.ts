import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { prisma } from '../lib/prisma';
import { AppError, asyncHandler } from '../lib/errors';

const router = Router();

router.use(authenticate, enforceEffectiveRole);

router.get('/', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const products = await prisma.product.findMany({
    where: { userId: req.user!.userId },
    orderBy: { name: 'asc' },
  });
  res.json(products);
}));

router.post('/', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { name } = req.body as { name?: string };
  const normalizedName = typeof name === 'string' ? name.trim() : '';

  if (!normalizedName) {
    throw new AppError('Product name is required', 400);
  }
  if (normalizedName.length > 200) {
    throw new AppError('Product name must be 200 characters or fewer', 400);
  }

  const existing = await prisma.product.findFirst({
    where: {
      userId: req.user!.userId,
      name: normalizedName,
    },
  });
  if (existing) {
    throw new AppError('A product with this name already exists', 409);
  }

  const product = await prisma.product.create({
    data: {
      name: normalizedName,
      userId: req.user!.userId,
    },
  });

  res.status(201).json(product);
}));

router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { name } = req.body as { name?: string };
  const normalizedName = typeof name === 'string' ? name.trim() : undefined;

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product || product.userId !== req.user!.userId) {
    throw new AppError('Product not found', 404);
  }

  if (normalizedName !== undefined) {
    if (!normalizedName) {
      throw new AppError('Product name is required', 400);
    }
    if (normalizedName.length > 200) {
      throw new AppError('Product name must be 200 characters or fewer', 400);
    }
    const duplicate = await prisma.product.findFirst({
      where: {
        userId: req.user!.userId,
        name: normalizedName,
        id: { not: id },
      },
    });
    if (duplicate) {
      throw new AppError('A product with this name already exists', 409);
    }
  }

  const updated = await prisma.product.update({
    where: { id },
    data: {
      ...(normalizedName !== undefined ? { name: normalizedName } : {}),
    },
  });

  res.json(updated);
}));

router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product || product.userId !== req.user!.userId) {
    throw new AppError('Product not found', 404);
  }

  await prisma.product.delete({ where: { id } });
  res.json({ success: true });
}));

export default router;
