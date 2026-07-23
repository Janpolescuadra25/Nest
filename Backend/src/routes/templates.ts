import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import Excel from 'exceljs';
import { Prisma, ScanMode } from '@prisma/client';
import { AppError, asyncHandler } from '../lib/errors';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { requireCapacity } from '../middleware/capacity';
import { prisma } from '../lib/prisma';

function sheetToArrays(worksheet: Excel.Worksheet, defval: string = ''): string[][] {
  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const arrayValues = Array.isArray(row.values) ? row.values.slice(1) : [];
    const values = arrayValues.map((value) => {
      if (value === null || value === undefined) return defval;
      if (typeof value === 'object' && value !== null && 'text' in value && typeof (value as any).text === 'string') {
        return (value as any).text;
      }
      return String(value);
    });
    rows.push(values);
  });
  return rows;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMimes.includes(file.mimetype) || ['.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new AppError('Only Excel files (.xlsx, .xls) are accepted', 400));
    }
  },
});
const VALID_TRANSACTION_TYPES = ['JOURNAL_ENTRY', 'BILL', 'VENDOR_CREDIT', 'BILL_PAYMENT', 'CHEQUE'] as const;

export function validateTransactionType(transactionType?: string): void {
  if (transactionType !== undefined && !VALID_TRANSACTION_TYPES.includes(transactionType as typeof VALID_TRANSACTION_TYPES[number])) {
    throw new AppError('Invalid transactionType. Must be one of: JOURNAL_ENTRY, BILL, VENDOR_CREDIT, BILL_PAYMENT, CHEQUE', 400);
  }
}

function validateModeTypeCompatibility(scanMode: string, transactionType: string): void {
  const compatibleModes: Record<string, string[]> = {
    POS: ['JOURNAL_ENTRY'],
    IMAGE: ['JOURNAL_ENTRY', 'BILL', 'VENDOR_CREDIT', 'CHEQUE'],
    EXCEL: ['JOURNAL_ENTRY', 'BILL', 'VENDOR_CREDIT', 'CHEQUE'],
  };

  const allowed = compatibleModes[scanMode];
  if (!allowed || !allowed.includes(transactionType)) {
    throw new AppError(
      `Incompatible scan mode "${scanMode}" with transaction type "${transactionType}". ` +
      `POS mode only supports JOURNAL_ENTRY. IMAGE and EXCEL support all types.`,
      400,
    );
  }
}

const router = Router();
router.use(authenticate, enforceEffectiveRole);

async function getLocationOrFail(locationId: string, user: AuthRequest['user']) {
  const location = await prisma.location.findFirst({
    where: { id: locationId, ...locationFilter(user!) },
  });
  if (!location) {
    throw new AppError('Location not found', 404);
  }
  return location;
}

async function getTemplateOrFail(templateId: string, user: AuthRequest['user']) {
  const template = await prisma.template.findFirst({
    where: { id: templateId, location: { ...locationFilter(user!) } },
  });
  if (!template) {
    throw new AppError('Template not found', 404);
  }
  return template;
}

router.get('/', requireFeaturePermission('templates', 'read'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const locationId = String(req.query.locationId || '');
  const scanModeFilter = String(req.query.scanMode || '').trim();
  const where: any = locationId ? { locationId, location: { ...locationFilter(req.user!) } } : { location: { ...locationFilter(req.user!) } };

  if (scanModeFilter) {
    Object.assign(where, { scanMode: scanModeFilter as any });
  }

  const templates = await prisma.template.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  res.json(templates);
}));

router.post('/', requireFeaturePermission('templates', 'write'), requireCapacity('template'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const body = req.body as {
    locationId?: string;
    name?: string;
    transactionType?: string;
    scanMode?: string;
    posSystem?: string | null;
    memoTemplate?: string;
    docNumberTemplate?: string;
    defaults?: Record<string, unknown> | null;
    columnMappings?: Record<string, unknown> | null;
  };

  if (!body.locationId || !body.name) {
    throw new AppError('locationId and name are required', 400);
  }

  if (body.scanMode === 'POS' && body.posSystem) {
    const validPOS = ['toast', 'oracle', 'salido', 'generic'];
    if (!validPOS.includes(body.posSystem)) {
      throw new AppError(
        `Invalid POS system: "${body.posSystem}". Must be one of: ${validPOS.join(', ')}`,
        400,
      );
    }
  }
  if (body.scanMode === 'POS' && !body.posSystem) {
    throw new AppError('POS system is required when scan mode is POS', 400);
  }

  validateTransactionType(body.transactionType);
  if (body.scanMode) {
    validateModeTypeCompatibility(body.scanMode, body.transactionType ?? 'JOURNAL_ENTRY');
  }
  await getLocationOrFail(body.locationId, req.user);

  const template = await prisma.template.create({
    data: {
      locationId: body.locationId,
      name: body.name.trim(),
      ...(body.transactionType && { transactionType: body.transactionType as string }),
      scanMode: (body.scanMode ?? 'IMAGE') as ScanMode,
      posSystem: body.posSystem ?? null,
      memoTemplate: body.memoTemplate ?? null,
      docNumberTemplate: body.docNumberTemplate ?? null,
      ...(body.defaults !== undefined && { defaults: body.defaults as unknown as Prisma.InputJsonValue }),
      ...(body.columnMappings !== undefined && { columnMappings: body.columnMappings as unknown as Prisma.InputJsonValue }),
    },
  });

  res.status(201).json(template);
}));

router.post('/parse-excel', requireFeaturePermission('templates', 'read'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) {
    throw new AppError('Excel file is required', 400);
  }

  const filename = (req.file.originalname || '').toLowerCase();
  if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
    res.status(400).json({ error: 'Only .xlsx and .xls files are supported' });
    return;
  }

  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(req.file.buffer as any);
  const sheets = workbook.worksheets.map((worksheet) => {
    const rows = sheetToArrays(worksheet);
    const rawHeaders = (rows[0] ?? []).map((header) => String(header ?? '').trim());
    const headers = rawHeaders.map((header, index) => header || `Column ${index + 1}`);
    const previewRows = rows.slice(1, 4).map((row) => {
      const rowData: Record<string, string> = {};
      headers.forEach((header, index) => {
        rowData[header] = String(row?.[index] ?? '');
      });
      return rowData;
    });

    return {
      name: worksheet.name,
      headers,
      rows: previewRows,
    };
  });

  if (sheets.length === 0) {
    throw new AppError('Excel file contains no sheets', 400);
  }

  res.json({
    sheetNames: sheets.map((sheet) => sheet.name),
    sheets,
    selectedSheetName: sheets[0].name,
  });
}))

router.post('/parse-excel-data', requireFeaturePermission('templates', 'read'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) {
    throw new AppError('Excel file is required', 400);
  }

  const filename = (req.file.originalname || '').toLowerCase();
  if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
    res.status(400).json({ error: 'Only .xlsx and .xls files are supported' });
    return;
  }

  const templateId = String(req.query.templateId || '');
  if (!templateId) {
    throw new AppError('templateId is required', 400);
  }

  const template = await prisma.template.findFirst({
    where: { id: templateId, location: { ...locationFilter(req.user!) } },
  });
  if (!template) {
    throw new AppError('Template not found', 404);
  }

  const columnMappings = template.columnMappings as Record<string, unknown> | null;
  if (!columnMappings || typeof columnMappings !== 'object' || Array.isArray(columnMappings) || Object.keys(columnMappings).length === 0) {
    res.status(400).json({ error: 'Template has no column mapping configured.' });
    return;
  }

  let workbook: Excel.Workbook;
  try {
    workbook = new Excel.Workbook();
    await workbook.xlsx.load(req.file.buffer as any);
  } catch (err) {
    throw new AppError(
      'Failed to read Excel file. It may be corrupted, password-protected, or not a valid Excel file.',
      400
    );
  }

  const requestedSheet = req.query.sheet ? String(req.query.sheet).trim() : '';
  const sheetNames = workbook.worksheets.map(ws => ws.name);
  const sheetName = requestedSheet && sheetNames.includes(requestedSheet)
    ? requestedSheet
    : sheetNames[0];
  const worksheet = workbook.getWorksheet(sheetName)!;
  const rows = sheetToArrays(worksheet);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError('Excel sheet contains no data rows', 400);
  }
  const rawHeaders = (rows[0] ?? []).map((header) => String(header ?? '').trim());
  const headers = rawHeaders.map((header, index) => header || `Column ${index + 1}`);
  const headerLookup = new Map<string, number>();
  headers.forEach((header, index) => {
    headerLookup.set(header.toLowerCase(), index);
  });

  const mappedRows = rows.slice(1).map((row) => {
    const mapped: Record<string, string> = {};
    for (const [fieldKey, excelHeaderValue] of Object.entries(columnMappings)) {
      const excelHeader = String(excelHeaderValue ?? '').trim();
      if (!excelHeader) continue;
      const headerIndex = headerLookup.get(excelHeader.toLowerCase());
      const rawValue = headerIndex !== undefined && headerIndex >= 0 ? row?.[headerIndex] : undefined;
      if (rawValue !== undefined && rawValue !== null) {
        mapped[fieldKey] = String(rawValue).trim();
      }
    }
    return mapped;
  }).filter((row) => Object.keys(row).length > 0);

  const skippedRows = Math.max(0, rows.length - 1 - mappedRows.length);

  const headerKeys = Object.keys(columnMappings).filter((key) => key.startsWith('_header_'));
  const lineItemKeys = Object.keys(columnMappings).filter((key) => !key.startsWith('_header_'));

  const header: Record<string, string> = {};
  for (const headerKey of headerKeys) {
    const cleanKey = headerKey.replace('_header_', '');
    const foundRow = mappedRows.find((row) => row[headerKey] && row[headerKey].trim() !== '');
    header[cleanKey] = foundRow ? foundRow[headerKey] : '';
  }

  const lineItems = mappedRows.map((row) => {
    const item: Record<string, string> = {};
    for (const key of lineItemKeys) {
      if (row[key]) {
        item[key] = row[key];
      }
    }
    if (template.transactionType === 'BILL') {
      item.postingType = 'Credit';
    } else if (template.transactionType === 'VENDOR_CREDIT') {
      item.postingType = 'Debit';
    } else {
      item.postingType = '';
    }
    return item;
  }).filter((item) => Object.keys(item).filter((key) => key !== 'postingType').length > 0);

  res.json({
    transactions: [{
      type: template.transactionType,
      header,
      lineItems,
    }],
    totalRows: mappedRows.length,
    skippedRows,
  });
}))

router.get('/:id', requireFeaturePermission('templates', 'read'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const template = await getTemplateOrFail(String(req.params.id), req.user);
  res.json(template);
}));

router.put('/:id', requireFeaturePermission('templates', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const template = await getTemplateOrFail(String(req.params.id), req.user);
  const body = req.body as {
    name?: string;
    scanMode?: string;
    posSystem?: string | null;
    transactionType?: string;
    memoTemplate?: string | null;
    docNumberTemplate?: string | null;
    isActive?: boolean;
    defaults?: Record<string, unknown> | null;
    columnMappings?: Record<string, unknown> | null;
  };

  validateTransactionType(body.transactionType);
  if (body.scanMode) {
    validateModeTypeCompatibility(body.scanMode, template.transactionType);
  }

  const updateData: any = {
    ...(body.name !== undefined && { name: body.name.trim() }),
    // transactionType is intentionally NOT updatable — locked at creation
    ...(body.memoTemplate !== undefined && { memoTemplate: body.memoTemplate || null }),
    ...(body.docNumberTemplate !== undefined && { docNumberTemplate: body.docNumberTemplate || null }),
    ...(body.isActive !== undefined && { isActive: body.isActive }),
    ...(body.defaults !== undefined && { defaults: body.defaults as unknown as Prisma.InputJsonValue }),
    ...(body.columnMappings !== undefined && { columnMappings: body.columnMappings as unknown as Prisma.InputJsonValue }),
  };

  if (body.scanMode !== undefined) updateData.scanMode = body.scanMode as ScanMode;
  if (body.posSystem !== undefined) updateData.posSystem = body.posSystem;

  const updated = await prisma.template.update({
    where: { id: template.id },
    data: updateData,
  });

  res.json(updated);
}));

router.delete('/:id', requireFeaturePermission('templates', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const template = await getTemplateOrFail(String(req.params.id), req.user);
  await prisma.template.delete({ where: { id: template.id } });
  res.json({ message: 'Template deleted' });
}));

export function createLocationTemplateRouter() {
  const locationRouter = Router({ mergeParams: true });

  locationRouter.get('/', requireFeaturePermission('templates', 'read'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const locationId = String(req.params.id);
    await getLocationOrFail(locationId, req.user);
    const templates = await prisma.template.findMany({
      where: { locationId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(templates);
  }));

  locationRouter.post('/', requireFeaturePermission('templates', 'write'), requireCapacity('template'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const locationId = String(req.params.id);
    await getLocationOrFail(locationId, req.user);
    const body = req.body as {
      name?: string;
      transactionType?: string;
      scanMode?: string;
      posSystem?: string | null;
      memoTemplate?: string;
      docNumberTemplate?: string;
      defaults?: Record<string, unknown> | null;
      columnMappings?: Record<string, unknown> | null;
    };

    if (!body.name) {
      throw new AppError('name is required', 400);
    }

    if (body.scanMode === 'POS' && body.posSystem) {
      const validPOS = ['toast', 'oracle', 'salido', 'generic'];
      if (!validPOS.includes(body.posSystem)) {
        throw new AppError(
          `Invalid POS system: "${body.posSystem}". Must be one of: ${validPOS.join(', ')}`,
          400,
        );
      }
    }
    if (body.scanMode === 'POS' && !body.posSystem) {
      throw new AppError('POS system is required when scan mode is POS', 400);
    }

    validateTransactionType(body.transactionType);
    if (body.scanMode) {
      validateModeTypeCompatibility(body.scanMode, body.transactionType ?? 'JOURNAL_ENTRY');
    }
    const template = await prisma.template.create({
      data: {
        locationId,
        name: body.name.trim(),
        ...(body.transactionType && { transactionType: body.transactionType as string }),
        scanMode: (body.scanMode ?? 'IMAGE') as ScanMode,
        posSystem: body.posSystem ?? null,
        memoTemplate: body.memoTemplate ?? null,
        docNumberTemplate: body.docNumberTemplate ?? null,
        ...(body.defaults !== undefined && { defaults: body.defaults as unknown as Prisma.InputJsonValue }),
        ...(body.columnMappings !== undefined && { columnMappings: body.columnMappings as unknown as Prisma.InputJsonValue }),
      },
    });

    res.status(201).json(template);
  }));

  locationRouter.get('/:templateId', requireFeaturePermission('templates', 'read'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const locationId = String(req.params.id);
    const templateId = String(req.params.templateId);
    await getLocationOrFail(locationId, req.user);
    const template = await prisma.template.findFirst({
      where: { id: templateId, locationId },
    });
    if (!template) {
      throw new AppError('Template not found', 404);
    }
    res.json(template);
  }));

  locationRouter.put('/:templateId', requireFeaturePermission('templates', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const locationId = String(req.params.id);
    const templateId = String(req.params.templateId);
    await getLocationOrFail(locationId, req.user);
    const body = req.body as {
      name?: string;
      memoTemplate?: string | null;
      docNumberTemplate?: string | null;
      isActive?: boolean;
      defaults?: Record<string, unknown> | null;
      columnMappings?: Record<string, unknown> | null;
    };

    const template = await prisma.template.findFirst({
      where: { id: templateId, locationId },
    });
    if (!template) {
      throw new AppError('Template not found', 404);
    }

    const updated = await prisma.template.update({
      where: { id: template.id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.memoTemplate !== undefined && { memoTemplate: body.memoTemplate || null }),
        ...(body.docNumberTemplate !== undefined && { docNumberTemplate: body.docNumberTemplate || null }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.defaults !== undefined && { defaults: body.defaults as unknown as Prisma.InputJsonValue }),
        ...(body.columnMappings !== undefined && { columnMappings: body.columnMappings as unknown as Prisma.InputJsonValue }),
      },
    });

    res.json(updated);
  }));

  locationRouter.delete('/:templateId', requireFeaturePermission('templates', 'write'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const locationId = String(req.params.id);
    const templateId = String(req.params.templateId);
    await getLocationOrFail(locationId, req.user);
    const template = await prisma.template.findFirst({
      where: { id: templateId, locationId },
    });
    if (!template) {
      throw new AppError('Template not found', 404);
    }
    await prisma.template.delete({ where: { id: template.id } });
    res.json({ message: 'Template deleted' });
  }));

  return locationRouter;
}

export default router;
