import { Router, Response } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth.middleware';
import { asyncHandler } from '../lib/errors';
import { prisma } from '../lib/prisma';

const router = Router();

function csvEscape(value: unknown): string {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

router.get('/scans', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
  const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;

  const scans = await prisma.scanRecord.findMany({
    where: {
      location: { user: { id: req.user!.id } },
      ...(dateFrom && { scanDate: { gte: new Date(dateFrom) } }),
      ...(dateTo && { scanDate: { lte: new Date(dateTo) } }),
      ...(status && { status: status as any }),
    },
    orderBy: { createdAt: 'desc' },
  });

  const header = ['ID', 'Scan Date', 'Status', 'Sync Status', 'Source', 'Transaction Type', 'Created At'];
  const rows = scans.map((scan) => [
    csvEscape(scan.id),
    csvEscape(scan.scanDate.toISOString().split('T')[0]),
    csvEscape(scan.status),
    csvEscape(scan.syncStatus),
    csvEscape(scan.source),
    csvEscape(scan.transactionType),
    csvEscape(scan.createdAt.toISOString().split('T')[0]),
  ]);

  const csv = [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="scans-export.csv"');
  res.send(csv);
}));

router.get('/sync-logs', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
  const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
  const syncType = typeof req.query.syncType === 'string' ? req.query.syncType : undefined;

  const logs = await prisma.syncLog.findMany({
    where: {
      userId: req.user!.id,
      ...(dateFrom && { syncedAt: { gte: new Date(dateFrom) } }),
      ...(dateTo && { syncedAt: { lte: new Date(dateTo) } }),
      ...(syncType && { syncType: syncType as any }),
    },
    orderBy: { syncedAt: 'desc' },
  });

  const header = ['ID', 'Sync Type', 'Status', 'Synced At', 'Doc Number', 'Error', 'Attempts'];
  const rows = logs.map((log) => [
    csvEscape(log.id),
    csvEscape(log.syncType),
    csvEscape(log.status),
    csvEscape(log.syncedAt.toISOString().split('T')[0]),
    csvEscape(log.docNumber ?? ''),
    csvEscape(log.errorMessage ?? ''),
    csvEscape(log.attemptCount),
  ]);

  const csv = [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sync-logs-export.csv"');
  res.send(csv);
}));

router.get('/audit-logs', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
  const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;

  const logs = await prisma.auditLog.findMany({
    where: {
      actorId: req.user!.id,
      ...(dateFrom && { createdAt: { gte: new Date(dateFrom) } }),
      ...(dateTo && { createdAt: { lte: new Date(dateTo) } }),
      ...(action && { action }),
    },
    include: {
      actor: { select: { email: true, name: true } },
      targetUser: { select: { email: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const header = ['ID', 'Actor', 'Action', 'Target', 'Date', 'IP', 'User Agent'];
  const rows = logs.map((log) => [
    csvEscape(log.id),
    csvEscape(log.actor?.email ?? ''),
    csvEscape(log.action),
    csvEscape(log.targetUser?.email ?? ''),
    csvEscape(log.createdAt.toISOString().split('T')[0]),
    csvEscape(log.ip ?? ''),
    csvEscape(log.userAgent ?? ''),
  ]);

  const csv = [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-logs-export.csv"');
  res.send(csv);
}));

export default router;