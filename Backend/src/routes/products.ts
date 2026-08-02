import { Router, Response } from 'express';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { prisma } from '../lib/prisma';
import { AppError, asyncHandler } from '../lib/errors';

const router = Router();

router.use(authenticate, enforceEffectiveRole);

router.get('/', requireFeaturePermission('products', 'read'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { locationId } = req.query;
  if (!locationId || typeof locationId !== 'string') {
    throw new AppError('locationId is required', 400);
  }

  const location = await prisma.location.findFirst({
    where: { id: locationId, ...locationFilter(req.user!) },
  });
  if (!location) {
    throw new AppError('Location not found', 404);
  }

  const products = await prisma.product.findMany({
    where: { locationId },
    orderBy: { name: 'asc' },
  });
  res.json(products);
}));

router.post('/', requireFeaturePermission('products', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, locationId } = req.body;
  const normalizedName = typeof name === 'string' ? name.trim() : '';

  if (!normalizedName) {
    throw new AppError('Product name is required', 400);
  }
  if (normalizedName.length > 200) {
    throw new AppError('Product name must be 200 characters or fewer', 400);
  }
  if (!locationId) {
    throw new AppError('locationId is required', 400);
  }

  const location = await prisma.location.findFirst({
    where: { id: locationId, ...locationFilter(req.user!) },
  });
  if (!location) {
    throw new AppError('Location not found', 404);
  }

  const existing = await prisma.product.findFirst({
    where: { locationId, name: normalizedName },
  });
  if (existing) {
    throw new AppError('Product already exists in this location', 409);
  }

  const product = await prisma.product.create({
    data: { name: normalizedName, userId: req.user!.userId, locationId },
  });

  res.status(201).json(product);
}));

router.put('/:id', requireFeaturePermission('products', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { name } = req.body;

  const product = await prisma.product.findFirst({
    where: { id, location: { ...locationFilter(req.user!) } },
  });
  if (!product) {
    throw new AppError('Product not found', 404);
  }

  const normalizedName = typeof name === 'string' ? name.trim() : product.name;

  if (!normalizedName) {
    throw new AppError('Product name is required', 400);
  }
  if (normalizedName.length > 200) {
    throw new AppError('Product name must be 200 characters or fewer', 400);
  }

  const duplicate = await prisma.product.findFirst({
    where: {
      locationId: product.locationId,
      name: normalizedName,
      id: { not: String(id) },
    },
  });
  if (duplicate) {
    throw new AppError('A product with this name already exists in this location', 409);
  }

  const updated = await prisma.product.update({
    where: { id },
    data: { name: normalizedName },
  });

  res.json(updated);
}));

router.delete('/:id', requireFeaturePermission('products', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);

  const product = await prisma.product.findFirst({
    where: { id, location: { ...locationFilter(req.user!) } },
  });
  if (!product) {
    throw new AppError('Product not found', 404);
  }

  await prisma.product.delete({ where: { id } });
  res.json({ success: true });
}));

export default router;
