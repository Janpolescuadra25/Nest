import { Router, Request, Response, NextFunction } from 'express';
import { AppError, asyncHandler } from '../lib/errors';
import { randomBytes } from 'crypto';
import { authenticate, AuthRequest, locationFilter, requireFeaturePermission } from '../middleware/auth.middleware';
import { authLimiter } from '../middleware/rate-limit';
import { enforceEffectiveRole } from '../middleware/effective-role';
import { qbService } from '../services/qb.service';
import { getFileBuffer } from '../lib/storage';
import { CreateBillInput, CreateBillPaymentInput, CreateChequeInput, CreateJournalEntryInput, QBJournalLineItem, QBBillLineItem, QBChequeLineItem, BillPaymentLine } from '../types';
import { Prisma, SyncType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { validate } from '../middleware/validate';
import { billSchema, chequeSchema, vendorCreditSchema, billPaymentSchema, journalEntrySchema } from '../lib/validators';
import { encrypt, decryptSafe, hashToken } from '../lib/encryption';
import { QBApiError } from '../lib/qb-errors';
import { createSyncLogEntry, countSyncAttempts, findDuplicateSync, hashSyncRequest } from '../lib/dedup';
import { logAction } from '../middleware/audit';

const router = Router();

const QB_CLIENT_ID = process.env.QB_CLIENT_ID;
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) {
  throw new Error('QB_CLIENT_ID and QB_CLIENT_SECRET environment variables are required');
}

const QB_REDIRECT_URI = process.env.QB_REDIRECT_URI ?? '';
const QB_AUTH_URL = process.env.QB_AUTH_URL ?? 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = process.env.QB_TOKEN_URL ?? 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function restrictSkipDedup(req: AuthRequest, _res: Response, next: NextFunction) {
  if (req.body?.skipDedupCheck) {
    const role = req.user?.role;
    if (role !== 'OWNER' && role !== 'ADMIN') {
      console.warn(
        `[Security] User ${req.user?.userId} (${role}) attempted skipDedupCheck without OWNER/ADMIN role`
      );
      req.body.skipDedupCheck = false;
    }
  }
  next();
}

// ── GET /api/quickbooks/auth-url ──────────────────────────────────────────────
// Requires JWT — binds the CSRF state to this user and persists it in the DB
// so the callback works even after server restarts.
router.get('/auth-url', authenticate, asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const state = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-min TTL

    // Persist state → userId in DB (survives server restarts)
    await prisma.oAuthState.upsert({
      where: { state: hashToken(state) },
      update: { userId: req.user!.userId, expiresAt },
      create: { state: hashToken(state), userId: req.user!.userId, expiresAt },
    });

    const params = new URLSearchParams({
      client_id: QB_CLIENT_ID,
      redirect_uri: QB_REDIRECT_URI,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      state,
    });

    const authUrl = `${QB_AUTH_URL}?${params.toString()}`;
    res.json({ authUrl, state });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[QB] Failed to generate auth URL:', err);
    throw new AppError('Failed to generate authorization URL', 500);
  }
}))

// ── GET /api/quickbooks/callback ──────────────────────────────────────────────
// Browser redirect from Intuit — NO Authorization header.
// Uses the DB-persisted state to identify the user.
router.get('/callback', authLimiter, asyncHandler(async(req: Request, res: Response) => {
  const { code, realmId, state, error } = req.query as {
    code?: string; realmId?: string; state?: string; error?: string;
  };

  // ── Intuit sent back an OAuth error ───────────────────────────────────────
  if (error) {
    console.error('[QB] Intuit returned OAuth error:', error);
    res.send(errorPage(`Intuit returned error: ${error}`));
    return;
  }

  // ── Missing required params ───────────────────────────────────────────────
  if (!code || !realmId || !state) {
    const missing = [!code && 'code', !realmId && 'realmId', !state && 'state'].filter(Boolean);
    console.error('[QB] Missing OAuth params:', missing.join(', '));
    return res.send(errorPage(`Missing required parameters: ${missing.join(', ')}`));
  }

  // ── Look up user from persisted state ─────────────────────────────────────
  let userId: string;
  try {
    const stateRecord = await prisma.oAuthState.findUnique({ where: { state: hashToken(state) } });

    if (!stateRecord) {
      console.error('[QB] State not found in DB — may have been used already or expired. state:', state);
      return res.send(errorPage('Authorization session not found or already used. Please start the connection flow again from the extension.'));
    }

    if (stateRecord.expiresAt < new Date()) {
      console.error('[QB] State expired at', stateRecord.expiresAt);
      await prisma.oAuthState.delete({ where: { state: hashToken(state) } }).catch(() => {});
      return res.send(errorPage('Authorization session expired. Please start the connection flow again from the extension.'));
    }

    userId = stateRecord.userId;
    await prisma.oAuthState.delete({ where: { state: hashToken(state) } }); // one-time use
  } catch (err) {
    console.error('[QB] DB error during state lookup:', err);
    return res.send(errorPage('Internal error verifying authorization state.'));
  }

  // ── Exchange code for tokens ───────────────────────────────────────────────
  try {
    const credentials = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64');
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: QB_REDIRECT_URI,
    });

    const tokenResponse = await fetch(QB_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenBody.toString(),
    });

    const responseText = await tokenResponse.text();

    if (!tokenResponse.ok) {
      console.error('[QB] Token exchange FAILED — status:', tokenResponse.status, '| body:', responseText);
      res.send(errorPage(`Token exchange failed (HTTP ${tokenResponse.status}): ${responseText}`));
      return;
    }

    const tokens = JSON.parse(responseText) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type?: string;
    };

    if (!tokens.access_token || !tokens.refresh_token) {
      console.error('[QB] Token response missing required fields:', tokens);
      res.send(errorPage('Token response from Intuit was missing access_token or refresh_token.'));
      return;
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const encryptedAccessToken = encrypt(tokens.access_token);
    const encryptedRefreshToken = encrypt(tokens.refresh_token);

    // ── Persist tokens in DB ─────────────────────────────────────────────────
    await prisma.qBToken.upsert({
      where: { userId },
      update: {
        realmId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt,
      },
      create: {
        userId,
        realmId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt,
      },
    });

    res.send(successPage(realmId));
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error('[QB] Unexpected error during token exchange / DB write:', err);
    return res.send(
      errorPage(
        process.env.NODE_ENV !== 'production'
          ? errMessage
          : 'An unexpected error occurred. Please try again.'
      )
    );
  }
}))

// ── GET /api/quickbooks/status ────────────────────────────────────────────────
router.get('/status', authenticate, asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const token = await prisma.qBToken.findUnique({ where: { userId: req.user!.userId } });
    if (!token) {
      res.json({
        connected: false,
        reason: 'not_connected',
        environment: process.env.QB_ENVIRONMENT ?? 'production',
      });
      return;
    }
    if (token.stale || token.expiresAt < new Date()) {
      res.json({
        connected: false,
        reason: 'token_expired',
        realmId: token.realmId,
        tokenExpired: true,
        expiresAt: token.expiresAt.toISOString(),
        environment: process.env.QB_ENVIRONMENT ?? 'production',
      });
      return;
    }
    res.json({
      connected: true,
      realmId: token.realmId,
      tokenExpired: false,
      expiresAt: token.expiresAt.toISOString(),
      environment: process.env.QB_ENVIRONMENT ?? 'production',
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[QB] status error:', err);
    throw new AppError('Failed to check QB status', 500);
  }
}))

// ── POST /api/quickbooks/journal-entry ────────────────────────────────────────
router.post('/journal-entry', authenticate, enforceEffectiveRole, requireFeaturePermission('sync', 'execute'), restrictSkipDedup, validate(journalEntrySchema), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { txnDate, lines, privateNote, scanRecordId, docNumber, skipDedupCheck } = req.body as {
      txnDate?: string;
      lines?: QBJournalLineItem[];
      privateNote?: string;
      scanRecordId?: string;
      docNumber?: string;
      skipDedupCheck?: boolean;
    };

    if (!txnDate || !lines || !Array.isArray(lines) || lines.length === 0) {
      throw new AppError('txnDate and lines[] are required', 400);
    }

    if (!scanRecordId) {
      const isAdminOrOwner = req.user!.role === 'ADMIN' || req.user!.role === 'OWNER';
      if (!isAdminOrOwner) {
        throw new AppError('Only admins and owners can sync without an approved scan record', 403);
      }
    }

    if (scanRecordId) {
      const scan = await prisma.scanRecord.findUnique({
        where: { id: scanRecordId },
        select: { locationId: true, status: true },
      });
      if (!scan) {
        throw new AppError('Scan record not found', 404);
      }

      const loc = await prisma.location.findFirst({
        where: { id: scan.locationId, ...locationFilter(req.user!) },
      });
      if (!loc) {
        throw new AppError("You don't have access to this location", 403);
      }

      const isAdminOrOwner = req.user!.role === 'ADMIN' || req.user!.role === 'OWNER';
      if (!isAdminOrOwner && scan.status !== 'APPROVED') {
        throw new AppError(`Scan must be approved before syncing (current status: ${scan.status})`, 403);
      }
    }

    const result = await syncSingleScan(
      req.user!.userId,
      scanRecordId ?? undefined,
      txnDate,
      lines,
      privateNote,
      docNumber,
      Boolean(skipDedupCheck),
    );

    if (result.status === 'SKIPPED') {
      if (result.reason === 'already_synced') {
        res.json({
          success: true,
          skipped: true,
          qbJournalEntryId: result.qbJournalEntryId,
          docNumber: result.docNumber,
          message: 'Already synced',
        });
        return;
      }

      res.status(409).json({
        error: 'Duplicate journal entry detected',
        reason: result.reason,
        qbJournalEntryId: result.qbJournalEntryId,
        docNumber: result.docNumber,
      });
      return;
    }

    if (result.status === 'FAILED') {
      console.error('[QB] journal-entry error:', result.errorMessage);
      const isValidation = result.errorType === 'VALIDATION';
      throw new AppError(
        isValidation
          ? result.errorMessage ?? 'Validation error from QuickBooks'
          : (process.env.NODE_ENV !== 'production'
              ? result.errorMessage ?? 'Unknown error'
              : 'An unexpected error occurred. Please try again.'),
        isValidation ? 400 : 500,
      );
    }

    res.json({
      message: 'Journal Entry created successfully',
      journalEntryId: result.qbJournalEntryId,
      txnDate: result.txnDate,
      totalAmount: result.totalAmount,
      docNumber: result.docNumber,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] journal-entry error:', message);
    throw new AppError(process.env.NODE_ENV !== 'production'
        ? message
        : 'An unexpected error occurred. Please try again.', 500);
  }
}));

// ── POST /api/quickbooks/bill ───────────────────────────────────────────────
router.post(
  '/check-duplicate',
  authenticate,
  enforceEffectiveRole,
  requireFeaturePermission('sync', 'execute'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const { syncType, payload } = req.body as {
      syncType?: string;
      payload?: unknown;
    };

    if (!syncType || !payload) {
      throw new AppError('syncType and payload are required', 400);
    }

    const requestHash = hashSyncRequest(syncType as any, payload);
    const existing = await findDuplicateSync(
      req.user!.userId,
      syncType as any,
      requestHash,
    );

    if (existing) {
      res.json({
        isDuplicate: true,
        existingId: existing.qbJournalEntryId ?? undefined,
        syncedAt: existing.syncedAt.toISOString(),
        docNumber: existing.docNumber ?? undefined,
      });
      return;
    }

    res.json({ isDuplicate: false });
  }),
);

router.post('/bill', authenticate, enforceEffectiveRole, requireFeaturePermission('sync', 'execute'), restrictSkipDedup, validate(billSchema), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      txnDate,
      vendorRef,
      apAccountRef,
      termsRef,
      dueDate,
      memo,
      privateNote,
      docNumber,
      lines,
      scanRecordId,
    } = req.body as {
      txnDate?: string;
      vendorRef?: { value: string; name?: string };
      apAccountRef?: { value: string; name?: string };
      termsRef?: { value: string; name?: string };
      dueDate?: string;
      memo?: string;
      privateNote?: string;
      docNumber?: string;
      lines?: QBBillLineItem[];
      scanRecordId?: string;
    };

    if (!txnDate || !lines || !Array.isArray(lines) || lines.length === 0 || !vendorRef?.value || !apAccountRef?.value) {
      throw new AppError('txnDate, vendorRef, apAccountRef and lines[] are required', 400);
    }

    if (!scanRecordId) {
      const isAdminOrOwner = req.user!.role === 'ADMIN' || req.user!.role === 'OWNER';
      if (!isAdminOrOwner) {
        throw new AppError('Only admins and owners can sync without an approved scan record', 403);
      }
    }

    if (scanRecordId) {
      const scan = await prisma.scanRecord.findUnique({
        where: { id: scanRecordId },
        select: { locationId: true, status: true },
      });
      if (!scan) {
        throw new AppError('Scan record not found', 404);
      }

      const loc = await prisma.location.findFirst({
        where: { id: scan.locationId, ...locationFilter(req.user!) },
      });
      if (!loc) {
        throw new AppError("You don't have access to this location", 403);
      }

      const isAdminOrOwner = req.user!.role === 'ADMIN' || req.user!.role === 'OWNER';
      if (!isAdminOrOwner && scan.status !== 'APPROVED') {
        throw new AppError(`Scan must be approved before syncing (current status: ${scan.status})`, 403);
      }
    }

    const result = await syncSingleBill(
      req.user!.userId,
      scanRecordId,
      txnDate,
      vendorRef,
      apAccountRef,
      termsRef,
      dueDate,
      memo,
      privateNote,
      lines,
      docNumber,
      Boolean(req.body.skipDedupCheck),
    );

    if (result.status === 'SKIPPED') {
      if (result.reason === 'already_synced') {
        res.json({
          success: true,
          skipped: true,
          qbJournalEntryId: result.qbJournalEntryId,
          docNumber: result.docNumber,
          message: 'Already synced',
        });
        return;
      }

      res.status(409).json({
        error: 'Duplicate bill detected',
        reason: result.reason,
        qbJournalEntryId: result.qbJournalEntryId,
        docNumber: result.docNumber,
      });
      return;
    }

    if (result.status === 'FAILED') {
      console.error('[QB] bill error:', result.errorMessage);
      const isValidation = result.errorType === 'VALIDATION';
      throw new AppError(
        isValidation
          ? result.errorMessage ?? 'Validation error from QuickBooks'
          : (process.env.NODE_ENV !== 'production'
              ? result.errorMessage ?? 'Unknown error'
              : 'An unexpected error occurred. Please try again.'),
        isValidation ? 400 : 500,
      );
    }

    res.json({
      message: 'Bill created successfully',
      billId: result.qbJournalEntryId,
      txnDate: result.txnDate,
      totalAmount: result.totalAmount,
      docNumber: result.docNumber,
    });
    return;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] bill error:', message);
    throw new AppError(process.env.NODE_ENV !== 'production'
        ? message
        : 'An unexpected error occurred. Please try again.', 500);
  }
}));

// ── POST /api/quickbooks/vendorcredit ───────────────────────────────────────
router.post('/vendorcredit', authenticate, enforceEffectiveRole, requireFeaturePermission('sync', 'execute'), restrictSkipDedup, validate(vendorCreditSchema), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      vendorRef,
      txnDate,
      apAccountRef,
      lines,
      scanRecordId,
      memo,
      privateNote,
      docNumber,
    } = req.body as {
      vendorRef?: { value: string; name?: string };
      txnDate?: string;
      apAccountRef?: { value: string; name?: string };
      lines?: QBBillLineItem[];
      scanRecordId?: string;
      memo?: string;
      privateNote?: string;
      docNumber?: string;
    };

    if (!vendorRef?.value || !txnDate || !apAccountRef?.value || !lines || !Array.isArray(lines) || lines.length === 0) {
      throw new AppError('vendorRef, txnDate, apAccountRef and lines[] are required', 400);
    }

    if (!scanRecordId) {
      const isAdminOrOwner = req.user!.role === 'ADMIN' || req.user!.role === 'OWNER';
      if (!isAdminOrOwner) {
        throw new AppError('Only admins and owners can sync without an approved scan record', 403);
      }
    }

    if (scanRecordId) {
      const scan = await prisma.scanRecord.findUnique({
        where: { id: scanRecordId },
        select: { locationId: true, status: true },
      });
      if (!scan) {
        throw new AppError('Scan record not found', 404);
      }

      const loc = await prisma.location.findFirst({
        where: { id: scan.locationId, ...locationFilter(req.user!) },
      });
      if (!loc) {
        throw new AppError("You don't have access to this location", 403);
      }

      const isAdminOrOwner = req.user!.role === 'ADMIN' || req.user!.role === 'OWNER';
      if (!isAdminOrOwner && scan.status !== 'APPROVED') {
        throw new AppError(`Scan must be approved before syncing (current status: ${scan.status})`, 403);
      }
    }

    const result = await syncSingleVendorCredit(
      req.user!.userId,
      scanRecordId,
      txnDate,
      vendorRef,
      apAccountRef,
      memo,
      privateNote,
      lines,
      docNumber,
      Boolean(req.body.skipDedupCheck),
    );

    if (result.status === 'SKIPPED') {
      if (result.reason === 'already_synced') {
        res.json({
          success: true,
          skipped: true,
          qbJournalEntryId: result.qbJournalEntryId,
          docNumber: result.docNumber,
          message: 'Already synced',
        });
        return;
      }

      res.status(409).json({
        error: 'Duplicate vendor credit detected',
        reason: result.reason,
        qbJournalEntryId: result.qbJournalEntryId,
        docNumber: result.docNumber,
      });
      return;
    }

    if (result.status === 'FAILED') {
      console.error('[QB] vendorcredit error:', result.errorMessage);
      const isValidation = result.errorType === 'VALIDATION';
      throw new AppError(
        isValidation
          ? result.errorMessage ?? 'Validation error from QuickBooks'
          : (process.env.NODE_ENV !== 'production'
              ? result.errorMessage ?? 'Unknown error'
              : 'An unexpected error occurred. Please try again.'),
        isValidation ? 400 : 500,
      );
    }

    res.json({
      message: 'Vendor Credit created successfully',
      vendorCreditId: result.qbJournalEntryId,
      txnDate: result.txnDate,
      totalAmount: result.totalAmount,
      docNumber: result.docNumber,
    });
    return;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] vendorcredit error:', message);
    throw new AppError(process.env.NODE_ENV !== 'production'
        ? message
        : 'An unexpected error occurred. Please try again.', 500);
  }
}));

// ── POST /api/quickbooks/cheque ─────────────────────────────────────────────────
router.post('/cheque', authenticate, enforceEffectiveRole, requireFeaturePermission('sync', 'execute'), restrictSkipDedup, validate(chequeSchema), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      txnDate,
      bankAccountRef,
      payeeRef,
      amount,
      memo,
      docNumber,
      lines,
      scanRecordId,
    } = req.body as {
      txnDate?: string;
      bankAccountRef?: { value: string; name?: string };
      payeeRef?: { value: string; name?: string };
      amount?: number;
      memo?: string;
      docNumber?: string;
      lines?: QBChequeLineItem[];
      scanRecordId?: string;
    };

    if (!txnDate || !bankAccountRef?.value || !payeeRef?.value || amount === undefined || amount === null || amount <= 0 || !lines || !Array.isArray(lines) || lines.length === 0) {
      throw new AppError('txnDate, bankAccountRef, payeeRef, amount and lines[] are required', 400);
    }

    if (!scanRecordId) {
      const isAdminOrOwner = req.user!.role === 'ADMIN' || req.user!.role === 'OWNER';
      if (!isAdminOrOwner) {
        throw new AppError('Only admins and owners can sync without an approved scan record', 403);
      }
    }

    if (scanRecordId) {
      const scan = await prisma.scanRecord.findUnique({
        where: { id: scanRecordId },
        select: { locationId: true, status: true },
      });
      if (!scan) {
        throw new AppError('Scan record not found', 404);
      }

      const loc = await prisma.location.findFirst({
        where: { id: scan.locationId, ...locationFilter(req.user!) },
      });
      if (!loc) {
        throw new AppError("You don't have access to this location", 403);
      }

      const isAdminOrOwner = req.user!.role === 'ADMIN' || req.user!.role === 'OWNER';
      if (!isAdminOrOwner && scan.status !== 'APPROVED') {
        throw new AppError(`Scan must be approved before syncing (current status: ${scan.status})`, 403);
      }
    }

    const result = await syncSingleCheque(
      req.user!.userId,
      scanRecordId ?? undefined,
      txnDate,
      bankAccountRef,
      payeeRef,
      amount,
      memo,
      lines,
      docNumber,
      Boolean(req.body.skipDedupCheck),
    );

    if (result.status === 'SKIPPED') {
      if (result.reason === 'already_synced') {
        res.json({
          success: true,
          skipped: true,
          qbJournalEntryId: result.qbJournalEntryId,
          docNumber: result.docNumber,
          message: 'Already synced',
        });
        return;
      }

      res.status(409).json({
        error: 'Duplicate check detected',
        reason: result.reason,
        qbJournalEntryId: result.qbJournalEntryId,
        docNumber: result.docNumber,
      });
      return;
    }

    if (result.status === 'FAILED') {
      console.error('[QB] cheque error:', result.errorMessage);
      const isValidation = result.errorType === 'VALIDATION';
      throw new AppError(
        isValidation
          ? result.errorMessage ?? 'Validation error from QuickBooks'
          : (process.env.NODE_ENV !== 'production'
              ? result.errorMessage ?? 'Unknown error'
              : 'An unexpected error occurred. Please try again.'),
        isValidation ? 400 : 500,
      );
    }

    res.json({
      message: 'Cheque created successfully',
      chequeId: result.qbJournalEntryId,
      txnDate: result.txnDate,
      totalAmount: result.totalAmount,
      docNumber: result.docNumber,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] cheque error:', message);
    throw new AppError(process.env.NODE_ENV !== 'production'
        ? message
        : 'An unexpected error occurred. Please try again.', 500);
  }
}));


// ── syncSingleScan helper ─────────────────────────────────────────────────────

interface SyncSingleResult {
  status: 'SYNCED' | 'SKIPPED' | 'FAILED';
  qbJournalEntryId?: string;
  docNumber?: string;
  txnDate?: string;
  totalAmount?: number;
  reason?: string;
  errorType?: string;
  errorMessage?: string;
}

async function syncSingleScan(
  userId: string,
  scanRecordId: string | undefined,
  txnDate: string,
  lines: QBJournalLineItem[],
  privateNote?: string,
  docNumber?: string,
  skipDedupCheck = false,
): Promise<SyncSingleResult> {
  const syncType = SyncType.JOURNAL_ENTRY;
  const requestHash = hashSyncRequest(syncType, { txnDate, lines, privateNote, docNumber });

  const attemptCount = scanRecordId
    ? (await prisma.syncLog.count({ where: { scanRecordId } })) + 1
    : (await countSyncAttempts(userId, syncType, requestHash)) + 1;

  const existingScan = scanRecordId
    ? await prisma.syncLog.findFirst({ where: { scanRecordId, status: 'SUCCESS' } })
    : null;

  if (existingScan) {
    return {
      status: 'SKIPPED',
      reason: 'already_synced',
      qbJournalEntryId: existingScan.qbJournalEntryId ?? undefined,
      docNumber: existingScan.docNumber ?? undefined,
    };
  }

  if (!skipDedupCheck) {
    const existingDuplicate = await findDuplicateSync(userId, syncType, requestHash);
    if (existingDuplicate) {
      return {
        status: 'SKIPPED',
        reason: 'duplicate_request',
        qbJournalEntryId: existingDuplicate.qbJournalEntryId ?? undefined,
        docNumber: existingDuplicate.docNumber ?? undefined,
      };
    }
  }

  const finalDocNumber = docNumber || (scanRecordId ? `Q-${scanRecordId.substring(0, 8)}` : `Q-${randomBytes(4).toString('hex')}`);

  try {
    const result = await qbService.callQB(userId, ({ accessToken, realmId }) =>
      qbService.createJournalEntry({
        txnDate,
        docNumber: finalDocNumber,
        lines,
        privateNote,
        realmId,
        accessToken,
      }),
    );

    await createSyncLogEntry({
      userId,
      syncType,
      scanRecordId: scanRecordId ?? undefined,
      qbJournalEntryId: result.id,
      docNumber: finalDocNumber,
      requestHash,
      status: 'SUCCESS',
      attemptCount,
      requestPayload: { txnDate, lines, privateNote, docNumber } as unknown as Prisma.JsonObject,
    });

    if (scanRecordId) {
      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'SYNCED' },
      });

      try {
        const scan = await prisma.scanRecord.findUnique({ where: { id: scanRecordId }, select: { autoAttach: true } });
        if (scan?.autoAttach) {
          const attachments = await prisma.attachment.findMany({ where: { scanRecordId } });
          for (const att of attachments) {
            const { buffer, mimeType } = await getFileBuffer(att.storageKey);
            await qbService.callQB(userId, ({ accessToken, realmId }) =>
              qbService.createAttachment({
                realmId,
                accessToken,
                fileBuffer: buffer,
                fileName: att.fileName,
                mimeType,
                entityId: result.id,
                entityType: 'JournalEntry',
              }),
            );
          }
          logAction({
            actorId: userId,
            action: 'ATTACHMENT_AUTO_ATTACHED',
            details: { scanRecordId, entityType: 'JournalEntry', entityId: result.id, attachmentCount: attachments.length },
          });
        }
      } catch (err) {
        logAction({
          actorId: userId,
          action: 'ATTACHMENT_FAILED',
          details: { scanRecordId, entityType: 'JournalEntry', error: err instanceof Error ? err.message : String(err) },
        });
        console.error('[QB] Failed to attach file to QB entity:', err);
      }
    }

    return {
      status: 'SYNCED',
      qbJournalEntryId: result.id,
      docNumber: finalDocNumber,
      txnDate: result.txnDate,
      totalAmount: result.totalAmount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const errorType = err instanceof QBApiError ? err.category : 'FATAL';

    await createSyncLogEntry({
      userId,
      syncType,
      scanRecordId: scanRecordId ?? undefined,
      requestHash,
      status: 'FAILED',
      attemptCount,
      requestPayload: { txnDate, lines, privateNote, docNumber } as unknown as Prisma.JsonObject,
      errorMessage: message,
      errorType,
    }).catch(console.error);

    if (scanRecordId) {
      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'FAILED' },
      }).catch(console.error);
    }

    return { status: 'FAILED', errorType, errorMessage: message };
  }
}

async function syncSingleVendorCredit(
  userId: string,
  scanRecordId: string | undefined,
  txnDate: string,
  vendorRef: { value: string; name?: string },
  apAccountRef: { value: string; name?: string },
  memo: string | undefined,
  privateNote: string | undefined,
  lines: QBBillLineItem[],
  docNumber?: string,
  skipDedupCheck = false,
): Promise<SyncSingleResult> {
  const syncType = SyncType.VENDOR_CREDIT;
  const requestHash = hashSyncRequest(syncType, { txnDate, vendorRef, apAccountRef, memo, privateNote, lines, docNumber });

  const attemptCount = scanRecordId
    ? (await prisma.syncLog.count({ where: { scanRecordId } })) + 1
    : (await countSyncAttempts(userId, syncType, requestHash)) + 1;

  const existingSync = scanRecordId
    ? await prisma.syncLog.findFirst({ where: { scanRecordId, status: 'SUCCESS' } })
    : null;

  if (existingSync) {
    return {
      status: 'SKIPPED',
      reason: 'already_synced',
      qbJournalEntryId: existingSync.qbJournalEntryId ?? undefined,
      docNumber: existingSync.docNumber ?? undefined,
    };
  }

  if (!skipDedupCheck) {
    const existingDuplicate = await findDuplicateSync(userId, syncType, requestHash);
    if (existingDuplicate) {
      return {
        status: 'SKIPPED',
        reason: 'duplicate_request',
        qbJournalEntryId: existingDuplicate.qbJournalEntryId ?? undefined,
        docNumber: existingDuplicate.docNumber ?? undefined,
      };
    }
  }

  const finalDocNumber = docNumber || (scanRecordId ? `Q-${scanRecordId.substring(0, 8)}` : `Q-${randomBytes(4).toString('hex')}`);

  try {
    const result = await qbService.callQB(userId, ({ accessToken, realmId }) =>
      qbService.createVendorCredit({
        txnDate,
        docNumber: finalDocNumber,
        vendorRef,
        apAccountRef,
        memo,
        privateNote,
        lines,
        realmId,
        accessToken,
      }),
    );

    await createSyncLogEntry({
      userId,
      syncType,
      scanRecordId: scanRecordId ?? undefined,
      qbJournalEntryId: result.id,
      docNumber: finalDocNumber,
      requestHash,
      status: 'SUCCESS',
      attemptCount,
      requestPayload: { txnDate, vendorRef, apAccountRef, memo, privateNote, docNumber, lines } as unknown as Prisma.JsonObject,
    });

    if (scanRecordId) {
      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'SYNCED' },
      });

      try {
        const scan = await prisma.scanRecord.findUnique({ where: { id: scanRecordId }, select: { autoAttach: true } });
        if (scan?.autoAttach) {
          const attachments = await prisma.attachment.findMany({ where: { scanRecordId } });
          for (const att of attachments) {
            const { buffer, mimeType } = await getFileBuffer(att.storageKey);
            await qbService.callQB(userId, ({ accessToken, realmId }) =>
              qbService.createAttachment({
                realmId,
                accessToken,
                fileBuffer: buffer,
                fileName: att.fileName,
                mimeType,
                entityId: result.id,
                entityType: 'VendorCredit',
              }),
            );
          }
          logAction({
            actorId: userId,
            action: 'ATTACHMENT_AUTO_ATTACHED',
            details: { scanRecordId, entityType: 'VendorCredit', entityId: result.id, attachmentCount: attachments.length },
          });
        }
      } catch (err) {
        logAction({
          actorId: userId,
          action: 'ATTACHMENT_FAILED',
          details: { scanRecordId, entityType: 'VendorCredit', error: err instanceof Error ? err.message : String(err) },
        });
        console.error('[QB] Failed to attach file to QB entity:', err);
      }
    }

    return {
      status: 'SYNCED',
      qbJournalEntryId: result.id,
      docNumber: finalDocNumber,
      txnDate: result.txnDate,
      totalAmount: result.totalAmount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const errorType = err instanceof QBApiError ? err.category : 'FATAL';

    await createSyncLogEntry({
      userId,
      syncType,
      scanRecordId: scanRecordId ?? undefined,
      requestHash,
      status: 'FAILED',
      attemptCount,
      requestPayload: { txnDate, vendorRef, apAccountRef, memo, docNumber, lines } as unknown as Prisma.JsonObject,
      errorMessage: message,
      errorType,
    }).catch(console.error);

    if (scanRecordId) {
      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'FAILED' },
      }).catch(console.error);
    }

    return { status: 'FAILED', errorType, errorMessage: message };
  }
}

async function syncSingleCheque(
  userId: string,
  scanRecordId: string | undefined,
  txnDate: string,
  bankAccountRef: { value: string; name?: string },
  payeeRef: { value: string; name?: string },
  amount: number,
  memo: string | undefined,
  lines: QBChequeLineItem[],
  docNumber?: string,
  skipDedupCheck = false,
): Promise<SyncSingleResult> {
  const syncType = SyncType.CHEQUE;
  const requestHash = hashSyncRequest(syncType, { txnDate, bankAccountRef, payeeRef, amount, memo, lines, docNumber });

  const attemptCount = scanRecordId
    ? (await prisma.syncLog.count({ where: { scanRecordId } })) + 1
    : (await countSyncAttempts(userId, syncType, requestHash)) + 1;

  const existingSync = scanRecordId
    ? await prisma.syncLog.findFirst({ where: { scanRecordId, status: 'SUCCESS' } })
    : null;

  if (existingSync) {
    return {
      status: 'SKIPPED',
      reason: 'already_synced',
      qbJournalEntryId: existingSync.qbJournalEntryId ?? undefined,
      docNumber: existingSync.docNumber ?? undefined,
    };
  }

  if (!skipDedupCheck) {
    const existingDuplicate = await findDuplicateSync(userId, syncType, requestHash);
    if (existingDuplicate) {
      return {
        status: 'SKIPPED',
        reason: 'duplicate_request',
        qbJournalEntryId: existingDuplicate.qbJournalEntryId ?? undefined,
        docNumber: existingDuplicate.docNumber ?? undefined,
      };
    }
  }

  const finalDocNumber = docNumber || (scanRecordId ? `Q-${scanRecordId.substring(0, 8)}` : `Q-${randomBytes(4).toString('hex')}`);

  try {
    const result = await qbService.callQB(userId, ({ accessToken, realmId }) =>
      qbService.createCheque({
        txnDate,
        docNumber: finalDocNumber,
        bankAccountRef,
        payeeRef,
        amount,
        memo,
        lines,
        realmId,
        accessToken,
      }),
    );

    await createSyncLogEntry({
      userId,
      syncType,
      scanRecordId: scanRecordId ?? undefined,
      qbJournalEntryId: result.id,
      docNumber: finalDocNumber,
      requestHash,
      status: 'SUCCESS',
      attemptCount,
      requestPayload: { txnDate, bankAccountRef, payeeRef, amount, memo, docNumber, lines } as unknown as Prisma.JsonObject,
    });

    if (scanRecordId) {
      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'SYNCED' },
      });

      try {
        const scan = await prisma.scanRecord.findUnique({ where: { id: scanRecordId }, select: { autoAttach: true } });
        if (scan?.autoAttach) {
          const attachments = await prisma.attachment.findMany({ where: { scanRecordId } });
          for (const att of attachments) {
            const { buffer, mimeType } = await getFileBuffer(att.storageKey);
            await qbService.callQB(userId, ({ accessToken, realmId }) =>
              qbService.createAttachment({
                realmId,
                accessToken,
                fileBuffer: buffer,
                fileName: att.fileName,
                mimeType,
                entityId: result.id,
                entityType: 'Purchase',
              }),
            );
          }
          logAction({
            actorId: userId,
            action: 'ATTACHMENT_AUTO_ATTACHED',
            details: { scanRecordId, entityType: 'Purchase', entityId: result.id, attachmentCount: attachments.length },
          });
        }
      } catch (err) {
        logAction({
          actorId: userId,
          action: 'ATTACHMENT_FAILED',
          details: { scanRecordId, entityType: 'Purchase', error: err instanceof Error ? err.message : String(err) },
        });
        console.error('[QB] Failed to attach file to QB entity:', err);
      }
    }

    return {
      status: 'SYNCED',
      qbJournalEntryId: result.id,
      docNumber: finalDocNumber,
      txnDate: result.txnDate,
      totalAmount: result.totalAmt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const errorType = err instanceof QBApiError ? err.category : 'FATAL';

    await createSyncLogEntry({
      userId,
      syncType,
      scanRecordId: scanRecordId ?? undefined,
      requestHash,
      status: 'FAILED',
      attemptCount,
      requestPayload: { txnDate, bankAccountRef, payeeRef, amount, memo, docNumber, lines } as unknown as Prisma.JsonObject,
      errorMessage: message,
      errorType,
    }).catch(console.error);

    if (scanRecordId) {
      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'FAILED' },
      }).catch(console.error);
    }

    return { status: 'FAILED', errorType, errorMessage: message };
  }
}

async function syncSingleBill(
  userId: string,
  scanRecordId: string | undefined,
  txnDate: string,
  vendorRef: { value: string; name?: string },
  apAccountRef: { value: string; name?: string },
  termsRef: { value: string; name?: string } | undefined,
  dueDate: string | undefined,
  memo: string | undefined,
  privateNote: string | undefined,
  lines: QBBillLineItem[],
  docNumber?: string,
  skipDedupCheck = false,
): Promise<SyncSingleResult> {
  const syncType = SyncType.BILL;
  const requestHash = hashSyncRequest(syncType, { txnDate, vendorRef, apAccountRef, termsRef, dueDate, memo, privateNote, lines, docNumber });

  const attemptCount = scanRecordId
    ? (await prisma.syncLog.count({ where: { scanRecordId } })) + 1
    : (await countSyncAttempts(userId, syncType, requestHash)) + 1;

  const existingSync = scanRecordId
    ? await prisma.syncLog.findFirst({ where: { scanRecordId, status: 'SUCCESS' } })
    : null;

  if (existingSync) {
    return {
      status: 'SKIPPED',
      reason: 'already_synced',
      qbJournalEntryId: existingSync.qbJournalEntryId ?? undefined,
      docNumber: existingSync.docNumber ?? undefined,
    };
  }

  if (!skipDedupCheck) {
    const existingDuplicate = await findDuplicateSync(userId, syncType, requestHash);
    if (existingDuplicate) {
      return {
        status: 'SKIPPED',
        reason: 'duplicate_request',
        qbJournalEntryId: existingDuplicate.qbJournalEntryId ?? undefined,
        docNumber: existingDuplicate.docNumber ?? undefined,
      };
    }
  }

  const finalDocNumber = docNumber || (scanRecordId ? `Q-${scanRecordId.substring(0, 8)}` : `Q-${randomBytes(4).toString('hex')}`);

  try {
    const result = await qbService.callQB(userId, ({ accessToken, realmId }) =>
      qbService.createBill({
        txnDate,
        docNumber: finalDocNumber,
        vendorRef,
        apAccountRef,
        termsRef,
        dueDate,
        memo,
        privateNote,
        lines,
        realmId,
        accessToken,
      }),
    );

    await createSyncLogEntry({
      userId,
      syncType,
      scanRecordId: scanRecordId ?? undefined,
      qbJournalEntryId: result.id,
      docNumber: finalDocNumber,
      requestHash,
      status: 'SUCCESS',
      attemptCount,
      requestPayload: { txnDate, vendorRef, apAccountRef, termsRef, dueDate, memo, privateNote, docNumber, lines } as unknown as Prisma.JsonObject,
    });

    if (scanRecordId) {
      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'SYNCED' },
      });

      try {
        const scan = await prisma.scanRecord.findUnique({ where: { id: scanRecordId }, select: { autoAttach: true } });
        if (scan?.autoAttach) {
          const attachments = await prisma.attachment.findMany({ where: { scanRecordId } });
          for (const att of attachments) {
            const { buffer, mimeType } = await getFileBuffer(att.storageKey);
            await qbService.callQB(userId, ({ accessToken, realmId }) =>
              qbService.createAttachment({
                realmId,
                accessToken,
                fileBuffer: buffer,
                fileName: att.fileName,
                mimeType,
                entityId: result.id,
                entityType: 'Bill',
              }),
            );
          }
          logAction({
            actorId: userId,
            action: 'ATTACHMENT_AUTO_ATTACHED',
            details: { scanRecordId, entityType: 'Bill', entityId: result.id, attachmentCount: attachments.length },
          });
        }
      } catch (err) {
        logAction({
          actorId: userId,
          action: 'ATTACHMENT_FAILED',
          details: { scanRecordId, entityType: 'Bill', error: err instanceof Error ? err.message : String(err) },
        });
        console.error('[QB] Failed to attach file to QB entity:', err);
      }
    }

    return {
      status: 'SYNCED',
      qbJournalEntryId: result.id,
      docNumber: finalDocNumber,
      txnDate: result.txnDate,
      totalAmount: result.totalAmount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const errorType = err instanceof QBApiError ? err.category : 'FATAL';

    await createSyncLogEntry({
      userId,
      syncType,
      scanRecordId: scanRecordId ?? undefined,
      requestHash,
      status: 'FAILED',
      attemptCount,
      requestPayload: { txnDate, vendorRef, apAccountRef, termsRef, dueDate, memo, docNumber, lines } as unknown as Prisma.JsonObject,
      errorMessage: message,
      errorType,
    }).catch(console.error);

    if (scanRecordId) {
      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'FAILED' },
      }).catch(console.error);
    }

    return { status: 'FAILED', errorType, errorMessage: message };
  }
}

async function syncSingleBillPayment(
  userId: string,
  scanRecordId: string | undefined,
  vendorRef: { value: string; name?: string },
  payType: 'Cash' | 'Check' | 'CreditCard' | 'Other',
  txnDate: string,
  totalAmt: number,
  lines: BillPaymentLine[],
  bankAccountRef: { value: string; name?: string } | undefined,
  checkNum: string | undefined,
  skipDedupCheck = false,
): Promise<SyncSingleResult> {
  const syncType = SyncType.BILL_PAYMENT;
  const requestHash = hashSyncRequest(syncType, { vendorRef, payType, txnDate, totalAmt, lines, bankAccountRef, checkNum });

  const attemptCount = scanRecordId
    ? (await prisma.syncLog.count({ where: { scanRecordId } })) + 1
    : (await countSyncAttempts(userId, syncType, requestHash)) + 1;

  const existingSync = scanRecordId
    ? await prisma.syncLog.findFirst({ where: { scanRecordId, status: 'SUCCESS' } })
    : null;

  if (existingSync) {
    return {
      status: 'SKIPPED',
      reason: 'already_synced',
      qbJournalEntryId: existingSync.qbJournalEntryId ?? undefined,
    };
  }

  if (!skipDedupCheck) {
    const existingDuplicate = await findDuplicateSync(userId, syncType, requestHash);
    if (existingDuplicate) {
      return {
        status: 'SKIPPED',
        reason: 'duplicate_request',
        qbJournalEntryId: existingDuplicate.qbJournalEntryId ?? undefined,
      };
    }
  }

  try {
    const result = await qbService.callQB(userId, ({ accessToken, realmId }) =>
      qbService.createBillPayment({ vendorRef, payType, txnDate, totalAmt, lines, realmId, accessToken, bankAccountRef, checkNum }),
    );

    await createSyncLogEntry({
      userId,
      syncType,
      scanRecordId: scanRecordId ?? undefined,
      qbJournalEntryId: result.id,
      requestHash,
      status: 'SUCCESS',
      attemptCount,
      requestPayload: { vendorRef, payType, txnDate, totalAmt, lines, bankAccountRef, checkNum } as unknown as Prisma.JsonObject,
    });

    if (scanRecordId) {
      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'SYNCED' },
      });

      try {
        const scan = await prisma.scanRecord.findUnique({ where: { id: scanRecordId }, select: { autoAttach: true } });
        if (scan?.autoAttach) {
          const attachments = await prisma.attachment.findMany({ where: { scanRecordId } });
          for (const att of attachments) {
            const { buffer, mimeType } = await getFileBuffer(att.storageKey);
            await qbService.callQB(userId, ({ accessToken, realmId }) =>
              qbService.createAttachment({
                realmId,
                accessToken,
                fileBuffer: buffer,
                fileName: att.fileName,
                mimeType,
                entityId: result.id,
                entityType: 'BillPayment',
              }),
            );
          }
          logAction({
            actorId: userId,
            action: 'ATTACHMENT_AUTO_ATTACHED',
            details: { scanRecordId, entityType: 'BillPayment', entityId: result.id, attachmentCount: attachments.length },
          });
        }
      } catch (err) {
        logAction({
          actorId: userId,
          action: 'ATTACHMENT_FAILED',
          details: { scanRecordId, entityType: 'BillPayment', error: err instanceof Error ? err.message : String(err) },
        });
        console.error('[QB] Failed to attach file to QB entity:', err);
      }
    }

    return {
      status: 'SYNCED',
      qbJournalEntryId: result.id,
      totalAmount: result.totalAmt,
      txnDate: result.txnDate,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const errorType = err instanceof QBApiError ? err.category : 'FATAL';

    await createSyncLogEntry({
      userId,
      syncType,
      scanRecordId: scanRecordId ?? undefined,
      requestHash,
      status: 'FAILED',
      attemptCount,
      requestPayload: { vendorRef, payType, txnDate, totalAmt, lines, bankAccountRef, checkNum } as unknown as Prisma.JsonObject,
      errorMessage: message,
      errorType,
    }).catch(console.error);

    if (scanRecordId) {
      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'FAILED' },
      }).catch(console.error);
    }

    return { status: 'FAILED', errorType, errorMessage: message };
  }
}

// ── POST /api/quickbooks/sync-batch ──────────────────────────────────────────
router.post('/sync-batch', authenticate, enforceEffectiveRole, requireFeaturePermission('sync', 'execute'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { items } = req.body as {
      items?: Array<{
        scanRecordId: string;
        transactionType?: string;
        txnDate?: string;
        lines?: QBJournalLineItem[] | QBBillLineItem[] | QBChequeLineItem[];
        privateNote?: string;
        docNumber?: string;
        vendorRef?: { value: string; name?: string };
        apAccountRef?: { value: string; name?: string };
        termsRef?: { value: string; name?: string };
        dueDate?: string;
        memo?: string;
        bankAccountRef?: { value: string; name?: string };
        payeeRef?: { value: string; name?: string };
        amount?: number;
      }>;
    };

    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError('items must be a non-empty array', 400);
    }

    if (items.length > 100) {
      throw new AppError('Batch size cannot exceed 100 items', 400);
    }

    const isAdminOrOwner = req.user!.role === 'ADMIN' || req.user!.role === 'OWNER';

    for (const item of items) {
      if (!item.scanRecordId) {
        throw new AppError('Each item must have a scanRecordId', 400);
      }
    }

    // Verify all scans belong to accessible locations
    const scanRecordIds = items.map((i) => i.scanRecordId);
    const scans = await prisma.scanRecord.findMany({
      where: { id: { in: scanRecordIds } },
      select: { id: true, locationId: true, status: true },
    });

    const accessibleLocations = await prisma.location.findMany({
      where: locationFilter(req.user!),
      select: { id: true },
    });
    const accessibleLocationIds = new Set(accessibleLocations.map((l) => l.id));
    const scanMap = new Map(scans.map((s) => [s.id, s]));

    type BatchResult = {
      scanRecordId: string;
      transactionType: string;
      status: 'SYNCED' | 'SKIPPED' | 'FAILED';
      qbJournalEntryId?: string;
      docNumber?: string;
      reason?: string;
      errorType?: string;
      errorMessage?: string;
    };

    const results: BatchResult[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const scan = scanMap.get(item.scanRecordId);

      if (!scan || !accessibleLocationIds.has(scan.locationId)) {
        results.push({
          scanRecordId: item.scanRecordId,
          transactionType: item.transactionType ?? 'JOURNAL_ENTRY',
          status: 'FAILED',
          errorType: 'VALIDATION',
          errorMessage: 'Scan not found or access denied',
        });
        continue;
      }

      if (!isAdminOrOwner && scan.status !== 'APPROVED') {
        results.push({
          scanRecordId: item.scanRecordId,
          transactionType: item.transactionType ?? 'JOURNAL_ENTRY',
          status: 'FAILED',
          errorType: 'VALIDATION',
          errorMessage: 'Scan must be approved before syncing',
        });
        continue;
      }

      const txnType = (item.transactionType ?? 'JOURNAL_ENTRY').toUpperCase();

      if (txnType === 'BILL_PAYMENT') {
        results.push({
          scanRecordId: item.scanRecordId,
          transactionType: txnType,
          status: 'FAILED',
          errorType: 'VALIDATION',
          errorMessage: 'Bill Payments cannot be batch synced. Sync from the Bill Payment preview form.',
        });
        continue;
      }

      let result: SyncSingleResult;

      switch (txnType) {
        case 'JOURNAL_ENTRY': {
          if (!item.txnDate || !Array.isArray(item.lines) || item.lines.length === 0) {
            results.push({
              scanRecordId: item.scanRecordId,
              transactionType: txnType,
              status: 'FAILED',
              errorType: 'VALIDATION',
              errorMessage: 'JE items require txnDate and non-empty lines[]',
            });
            continue;
          }

          result = await syncSingleScan(
            req.user!.userId,
            item.scanRecordId,
            item.txnDate,
            item.lines as QBJournalLineItem[],
            item.privateNote,
            item.docNumber,
          );
          break;
        }

        case 'VENDOR_CREDIT': {
          if (!item.txnDate || !item.vendorRef?.value || !item.apAccountRef?.value || !Array.isArray(item.lines) || item.lines.length === 0) {
            results.push({
              scanRecordId: item.scanRecordId,
              transactionType: txnType,
              status: 'FAILED',
              errorType: 'VALIDATION',
              errorMessage: 'Vendor Credit items require txnDate, vendorRef, apAccountRef, and non-empty lines[]',
            });
            continue;
          }

          result = await syncSingleVendorCredit(
            req.user!.userId,
            item.scanRecordId,
            item.txnDate,
            item.vendorRef,
            item.apAccountRef,
            item.memo,
            item.privateNote,
            item.lines as QBBillLineItem[],
            item.docNumber,
          );
          break;
        }

        case 'CHEQUE': {
          if (!item.txnDate || !item.bankAccountRef?.value || !item.payeeRef?.value || !item.amount || item.amount <= 0 || !Array.isArray(item.lines) || item.lines.length === 0) {
            results.push({
              scanRecordId: item.scanRecordId,
              transactionType: txnType,
              status: 'FAILED',
              errorType: 'VALIDATION',
              errorMessage: 'Cheque items require txnDate, bankAccountRef, payeeRef, amount > 0, and non-empty lines[]',
            });
            continue;
          }

          result = await syncSingleCheque(
            req.user!.userId,
            item.scanRecordId,
            item.txnDate,
            item.bankAccountRef,
            item.payeeRef,
            item.amount,
            item.memo,
            item.lines as QBChequeLineItem[],
            item.docNumber,
          );
          break;
        }

        case 'BILL': {
          if (!item.txnDate || !item.vendorRef?.value || !item.apAccountRef?.value || !Array.isArray(item.lines) || item.lines.length === 0) {
            results.push({
              scanRecordId: item.scanRecordId,
              transactionType: txnType,
              status: 'FAILED',
              errorType: 'VALIDATION',
              errorMessage: 'Bill items require txnDate, vendorRef, apAccountRef, and non-empty lines[]',
            });
            continue;
          }

          result = await syncSingleBill(
            req.user!.userId,
            item.scanRecordId,
            item.txnDate,
            item.vendorRef,
            item.apAccountRef,
            item.termsRef,
            item.dueDate,
            item.memo,
            item.privateNote,
            item.lines as QBBillLineItem[],
            item.docNumber,
          );
          break;
        }

        default:
          results.push({
            scanRecordId: item.scanRecordId,
            transactionType: txnType,
            status: 'FAILED',
            errorType: 'VALIDATION',
            errorMessage: `Unsupported transaction type for batch sync: ${txnType}`,
          });
          continue;
      }

      results.push({ scanRecordId: item.scanRecordId, transactionType: txnType, ...result });

      if (i < items.length - 1) {
        await sleep(200);
      }
    }

    const summary = {
      total: results.length,
      synced: results.filter((r) => r.status === 'SYNCED').length,
      skipped: results.filter((r) => r.status === 'SKIPPED').length,
      failed: results.filter((r) => r.status === 'FAILED').length,
    };

    res.json({ results, summary });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] sync-batch error:', message);
    throw new AppError('Batch sync failed', 500);
  }
}));

// ── POST /api/quickbooks/retry/:scanRecordId ─────────────────────────────
router.post('/retry/:scanRecordId', authenticate, enforceEffectiveRole, requireFeaturePermission('sync', 'execute'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scanRecordId = String(req.params.scanRecordId);

    const scan = await prisma.scanRecord.findUnique({
      where: { id: scanRecordId },
      select: { id: true, status: true, locationId: true },
    });

    if (!scan) {
      throw new AppError('Scan not found', 404);
    }

    if (scan.status !== 'FAILED') {
      throw new AppError('Only failed scans can be retried', 409);
    }

    const location = await prisma.location.findFirst({
      where: { id: scan.locationId, ...locationFilter(req.user!) },
    });

    if (!location) {
      throw new AppError("You don't have access to this location", 403);
    }

    const latestLog = await prisma.syncLog.findFirst({
      where: { scanRecordId },
      orderBy: { syncedAt: 'desc' },
    });

    if (!latestLog) {
      throw new AppError('No sync log found. Please re-sync from the Preview tab.', 409);
    }

    if (!latestLog.requestPayload) {
      throw new AppError('No sync payload available. Please re-sync from the Preview tab.', 409);
    }

    const existingCount = await prisma.syncLog.count({ where: { scanRecordId } });
    const attemptCount = existingCount + 1;

    if (attemptCount > 3) {
      throw new AppError('Maximum retry attempts (3) reached. Please re-sync from the Preview tab.', 409);
    }

    const result = await retrySyncFromLog(req.user!.userId, scanRecordId, latestLog);

    if (result.status === 'SYNCED' || (result.status === 'SKIPPED' && result.reason === 'already_synced')) {
      res.json({
        success: true,
        qbJournalEntryId: result.qbJournalEntryId,
        docNumber: result.docNumber,
        attemptCount,
      });
    } else if (result.status === 'SKIPPED') {
      res.status(409).json({
        success: false,
        error: result.reason ?? 'Duplicate detected',
        attemptCount,
      });
    } else {
      res.status(422).json({
        success: false,
        error: result.errorMessage ?? 'Retry failed',
        errorType: result.errorType,
        attemptCount,
      });
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] retry error:', message);
    throw err instanceof AppError ? err : new AppError(message, 500);
  }
}));

// ── POST /api/quickbooks/retry-batch ─────────────────────────────────────
router.post('/retry-batch', authenticate, enforceEffectiveRole, requireFeaturePermission('sync', 'execute'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { locationId, scanRecordIds } = req.body as { locationId?: string; scanRecordIds?: string[] };

    if (!locationId && (!Array.isArray(scanRecordIds) || scanRecordIds.length === 0)) {
      throw new AppError('locationId or scanRecordIds is required', 400);
    }

    if (scanRecordIds && scanRecordIds.length > 100) {
      throw new AppError('Maximum 100 scans per batch retry', 400);
    }

    const accessibleLocations = await prisma.location.findMany({
      where: locationFilter(req.user!),
      select: { id: true },
    });
    const accessibleLocationIds = new Set(accessibleLocations.map((l) => l.id));

    let scansToRetry: Array<{ id: string; locationId: string; status: string }> = [];
    if (scanRecordIds) {
      scansToRetry = await prisma.scanRecord.findMany({
        where: { id: { in: scanRecordIds } },
        select: { id: true, locationId: true, status: true },
      });
    } else {
      if (!accessibleLocationIds.has(locationId!)) {
        throw new AppError("You don't have access to this location", 403);
      }

      const totalFailed = await prisma.scanRecord.count({
        where: { locationId: locationId!, status: 'FAILED' },
      });

      if (totalFailed > 100) {
        throw new AppError('Maximum 100 scans per batch retry', 400);
      }

      scansToRetry = await prisma.scanRecord.findMany({
        where: { locationId: locationId!, status: 'FAILED' },
        select: { id: true, locationId: true, status: true },
      });
    }

    const scanMap = new Map(scansToRetry.map((scan) => [scan.id, scan]));
    const candidateIds = scanRecordIds ?? scansToRetry.map((scan) => scan.id);

    type RetryBatchResult = {
      scanRecordId: string;
      status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
      qbJournalEntryId?: string;
      docNumber?: string;
      errorMessage?: string;
      errorType?: string;
      skipReason?: 'max_retries' | 'no_payload';
      attemptCount: number;
    };

    const results: RetryBatchResult[] = [];

    for (let i = 0; i < candidateIds.length; i++) {
      const scanRecordId = candidateIds[i]!;
      const scan = scanMap.get(scanRecordId);

      if (!scan || !accessibleLocationIds.has(scan.locationId)) {
        results.push({
          scanRecordId,
          status: 'FAILED',
          errorType: 'VALIDATION',
          errorMessage: 'Scan not found or access denied',
          attemptCount: 0,
        });
        continue;
      }

      if (scan.status !== 'FAILED') {
        results.push({
          scanRecordId,
          status: 'SKIPPED',
          skipReason: 'no_payload',
          attemptCount: 0,
        });
        continue;
      }

      const existingCount = await prisma.syncLog.count({ where: { scanRecordId } });
      if (existingCount >= 3) {
        results.push({
          scanRecordId,
          status: 'SKIPPED',
          skipReason: 'max_retries',
          attemptCount: existingCount,
        });
        continue;
      }

      const latestLog = await prisma.syncLog.findFirst({
        where: { scanRecordId },
        orderBy: { syncedAt: 'desc' },
      });

      if (!latestLog || !latestLog.requestPayload) {
        results.push({
          scanRecordId,
          status: 'SKIPPED',
          skipReason: 'no_payload',
          attemptCount: existingCount,
        });
        continue;
      }

      const attemptCount = existingCount + 1;

      try {
        const result = await retrySyncFromLog(req.user!.userId, scanRecordId, latestLog);

        if (result.status === 'SYNCED' || (result.status === 'SKIPPED' && result.reason === 'already_synced')) {
          results.push({
            scanRecordId,
            status: 'SUCCESS' as const,
            qbJournalEntryId: result.qbJournalEntryId,
            docNumber: result.docNumber,
            attemptCount,
          });
        } else if (result.status === 'SKIPPED') {
          results.push({
            scanRecordId,
            status: 'FAILED' as const,
            errorMessage: result.reason ?? 'Duplicate detected',
            errorType: 'DUPLICATE',
            attemptCount,
          });
        } else {
          results.push({
            scanRecordId,
            status: 'FAILED' as const,
            errorMessage: result.errorMessage ?? 'Retry failed',
            errorType: result.errorType,
            attemptCount,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.push({
          scanRecordId,
          status: 'FAILED' as const,
          errorMessage: message,
          errorType: err instanceof QBApiError ? err.category : 'FATAL',
          attemptCount,
        });
      }

      if (i < candidateIds.length - 1) {
        await sleep(200);
      }
    }

    const summary = {
      total: results.length,
      retried: results.filter((r) => r.status === 'SUCCESS' || r.status === 'FAILED').length,
      succeeded: results.filter((r) => r.status === 'SUCCESS').length,
      skipped: results.filter((r) => r.status === 'SKIPPED').length,
      failed: results.filter((r) => r.status === 'FAILED').length,
    };

    res.json({ results, summary });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] retry-batch error:', message);
    throw new AppError('Batch retry failed', 500);
  }
}));

async function retrySyncFromLog(
  userId: string,
  scanRecordId: string,
  latestLog: { syncType: string; requestPayload: unknown },
): Promise<SyncSingleResult> {
  const { syncType, requestPayload } = latestLog;

  switch (syncType) {
    case 'JOURNAL_ENTRY': {
      const p = requestPayload as {
        txnDate: string;
        lines: QBJournalLineItem[];
        privateNote?: string;
        docNumber?: string;
      };
      return syncSingleScan(userId, scanRecordId, p.txnDate, p.lines, p.privateNote, p.docNumber, true);
    }

    case 'VENDOR_CREDIT': {
      const p = requestPayload as {
        txnDate: string;
        vendorRef: { value: string; name?: string };
        apAccountRef: { value: string; name?: string };
        memo?: string;
        privateNote?: string;
        lines: QBBillLineItem[];
        docNumber?: string;
      };
      return syncSingleVendorCredit(userId, scanRecordId, p.txnDate, p.vendorRef, p.apAccountRef, p.memo, p.privateNote, p.lines, p.docNumber, true);
    }

    case 'CHEQUE': {
      const p = requestPayload as {
        txnDate: string;
        bankAccountRef: { value: string; name?: string };
        payeeRef: { value: string; name?: string };
        amount: number;
        memo?: string;
        lines: QBChequeLineItem[];
        docNumber?: string;
      };
      return syncSingleCheque(userId, scanRecordId, p.txnDate, p.bankAccountRef, p.payeeRef, p.amount, p.memo, p.lines, p.docNumber, true);
    }

    case 'BILL': {
      const p = requestPayload as {
        txnDate: string;
        vendorRef: { value: string; name?: string };
        apAccountRef: { value: string; name?: string };
        termsRef?: { value: string; name?: string };
        dueDate?: string;
        memo?: string;
        privateNote?: string;
        lines: QBBillLineItem[];
        docNumber?: string;
      };
      return syncSingleBill(userId, scanRecordId, p.txnDate, p.vendorRef, p.apAccountRef, p.termsRef, p.dueDate, p.memo, p.privateNote, p.lines, p.docNumber, true);
    }

    case 'BILL_PAYMENT':
      throw new AppError('Bill payments cannot be retried via scan record', 400);

    default:
      throw new AppError(`Unsupported sync type for retry: ${syncType}`, 400);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── DELETE /api/quickbooks/token ──────────────────────────────────────────────
router.delete('/token', authenticate, asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const tokenRow = await prisma.qBToken.findUnique({ where: { userId } });

    if (tokenRow) {
      // Best-effort Intuit revocation — failure does NOT block deletion
      try {
        const decryptedAccess = decryptSafe(tokenRow.accessToken);
        await qbService.revokeAccessToken(decryptedAccess);
      } catch {
        console.warn('[QB] Intuit token revocation failed (best-effort, proceeding with local deletion)');
      }

      await prisma.qBToken.delete({ where: { userId } });
    }

    res.json({ success: true });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[QB] disconnect error:', err);
    throw new AppError('Failed to disconnect QuickBooks', 500);
  }
}));

// ── GET /api/quickbooks/accounts ──────────────────────────────────────────────
router.get('/accounts', authenticate, requireFeaturePermission('sync', 'execute'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const accounts = await qbService.callQB(req.user!.userId, ({ accessToken, realmId }) =>
      qbService.getAccounts(realmId, accessToken),
    );
    res.json({ accounts });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] accounts error:', message);
    throw new AppError('Failed to fetch accounts', 500);
  }
}));

// ── GET /api/quickbooks/classes ───────────────────────────────────────────────
router.get('/classes', authenticate, requireFeaturePermission('sync', 'execute'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classes = await qbService.callQB(req.user!.userId, ({ accessToken, realmId }) =>
      qbService.getClasses(realmId, accessToken),
    );
    res.json({ classes });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] classes error:', message);
    throw new AppError('Failed to fetch classes', 500);
  }
}));

// ── GET /api/quickbooks/employees ─────────────────────────────────────────────
router.get('/employees', authenticate, requireFeaturePermission('sync', 'execute'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const employees = await qbService.callQB(req.user!.userId, ({ accessToken, realmId }) =>
      qbService.getEmployees(realmId, accessToken),
    );
    res.json({ employees });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] employees error:', message);
    throw new AppError('Failed to fetch employees', 500);
  }
}));

// ── GET /api/quickbooks/vendors ───────────────────────────────────────────────
router.get('/vendors', authenticate, requireFeaturePermission('sync', 'execute'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vendors = await qbService.callQB(req.user!.userId, ({ accessToken, realmId }) =>
      qbService.getVendors(realmId, accessToken),
    );
    res.json({ vendors });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] vendors error:', message);
    throw new AppError('Failed to fetch vendors', 500);
  }
}));

// ── GET /api/quickbooks/customers ─────────────────────────────────────────────
router.get('/customers', authenticate, requireFeaturePermission('sync', 'execute'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customers = await qbService.callQB(req.user!.userId, ({ accessToken, realmId }) =>
      qbService.getCustomers(realmId, accessToken),
    );
    res.json({ customers });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] customers error:', message);
    throw new AppError('Failed to fetch customers', 500);
  }
}));

// ── GET /api/quickbooks/tax-codes ────────────────────────────────────────────
router.get('/tax-codes', authenticate, requireFeaturePermission('sync', 'execute'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taxCodes = await qbService.callQB(req.user!.userId, ({ accessToken, realmId }) =>
      qbService.getTaxCodes(realmId, accessToken),
    );
    res.json({ taxCodes });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] tax-codes error:', message);
    throw new AppError('Failed to fetch tax codes', 500);
  }
}));

// ── GET /api/quickbooks/bills ───────────────────────────────────────────────
router.get('/bills', authenticate, requireFeaturePermission('sync', 'execute'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vendorId = req.query.vendorId as string | undefined;
    const bills = await qbService.callQB(req.user!.userId, ({ accessToken, realmId }) =>
      qbService.getOutstandingBills(realmId, accessToken),
    );

    const filteredBills = vendorId ? bills.filter((bill) => bill.vendorRef.value === vendorId) : bills;
    res.json({ bills: filteredBills });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] bills error:', message);
    throw new AppError('Failed to fetch bills', 500);
  }
}));

// ── GET /api/quickbooks/vendor-credits ─────────────────────────────────────────
router.get('/vendor-credits', authenticate, requireFeaturePermission('sync', 'execute'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vendorId = req.query.vendorId as string | undefined;
    const vendorCredits = await qbService.callQB(req.user!.userId, ({ accessToken, realmId }) =>
      qbService.getVendorCredits(realmId, accessToken),
    );

    const filteredCredits = vendorId ? vendorCredits.filter((credit) => credit.vendorRef.value === vendorId) : vendorCredits;
    res.json({ vendorCredits: filteredCredits });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] vendor credits error:', message);
    throw new AppError('Failed to fetch vendor credits', 500);
  }
}));

// ── POST /api/quickbooks/bill-payment ────────────────────────────────────────
router.post('/bill-payment', authenticate, enforceEffectiveRole, requireFeaturePermission('sync', 'execute'), restrictSkipDedup, validate(billPaymentSchema), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateBillPaymentInput & { scanRecordId?: string; skipDedupCheck?: boolean };
    const { vendorRef, payType, txnDate, totalAmt, lines, bankAccountRef, checkNum, scanRecordId, skipDedupCheck } = body;

    if (scanRecordId) {
      const scan = await prisma.scanRecord.findUnique({
        where: { id: scanRecordId },
        select: { status: true },
      });
      if (!scan) {
        throw new AppError('Scan record not found', 404);
      }

      const isAdminOrOwner = req.user!.role === 'ADMIN' || req.user!.role === 'OWNER';
      if (!isAdminOrOwner && scan.status !== 'APPROVED') {
        throw new AppError(`Scan must be approved before syncing (current status: ${scan.status})`, 403);
      }
    }

    const result = await syncSingleBillPayment(
      req.user!.userId,
      scanRecordId,
      vendorRef,
      payType,
      txnDate,
      totalAmt,
      lines,
      bankAccountRef,
      checkNum,
      skipDedupCheck ?? false,
    );

    if (result.status === 'SYNCED') {
      res.json({
        message: 'Bill Payment created successfully',
        billPaymentId: result.qbJournalEntryId,
        totalAmount: result.totalAmount,
        txnDate: result.txnDate,
      });
      return;
    }

    if (result.status === 'SKIPPED') {
      if (result.reason === 'already_synced') {
        res.json({ success: true, skipped: true, message: 'Already synced' });
        return;
      }
      if (result.reason === 'duplicate_request') {
        res.status(409).json({ error: 'Duplicate bill payment detected', reason: result.reason });
        return;
      }
    }

    if (result.status === 'FAILED') {
      console.error('[QB] bill payment error:', result.errorMessage);
      const isValidation = result.errorType === 'VALIDATION';
      throw new AppError(
        isValidation
          ? result.errorMessage ?? 'Validation error from QuickBooks'
          : (process.env.NODE_ENV !== 'production'
              ? result.errorMessage ?? 'An unexpected error occurred. Please try again.'
              : 'An unexpected error occurred. Please try again.'),
        isValidation ? 400 : 500,
      );
    }

    throw new AppError('Unexpected bill payment result', 500);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] bill payment error:', message);
    throw new AppError(process.env.NODE_ENV !== 'production' ? message : 'An unexpected error occurred. Please try again.', 500);
  }
}));

// ── GET /api/quickbooks/sync-all ──────────────────────────────────────────────
router.get('/sync-all', authenticate, requireFeaturePermission('sync', 'execute'), asyncHandler(async(req: AuthRequest, res: Response): Promise<void> => {
  try {
    const entities = await qbService.callQB(req.user!.userId, async ({ accessToken, realmId }) => {
      const [accounts, classes, employees, vendors, customers, taxCodes, terms] = await Promise.all([
        qbService.getAccounts(realmId, accessToken),
        qbService.getClasses(realmId, accessToken),
        qbService.getEmployees(realmId, accessToken),
        qbService.getVendors(realmId, accessToken),
        qbService.getCustomers(realmId, accessToken),
        qbService.getTaxCodes(realmId, accessToken),
        qbService.getTerms(realmId, accessToken),
      ]);
      return { accounts, classes, employees, vendors, customers, taxCodes, terms };
    });
    res.json(entities);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] sync-all error:', message);
    throw new AppError(process.env.NODE_ENV !== 'production'
        ? message
        : 'An unexpected error occurred. Please try again.', 500);
  }
}));

// ── HTML page helpers ─────────────────────────────────────────────────────────
function successPage(realmId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Qyra — QuickBooks Connected</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0f172a; color: #e2e8f0; display: flex;
           align-items: center; justify-content: center;
           height: 100vh; margin: 0; }
    .card { text-align: center; padding: 48px 56px;
            background: #1e293b; border-radius: 16px;
            border: 1px solid #334155; max-width: 420px; }
    h1 { color: #22d3ee; margin: 16px 0 8px; font-size: 1.5rem; }
    .realm { color: #94a3b8; font-family: monospace; font-size: 0.85rem; }
    .hint { color: #475569; font-size: 0.85rem; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:56px">✅</div>
    <h1>QuickBooks Connected!</h1>
    <p class="realm">Company ID: ${realmId}</p>
    <p class="hint">You can close this tab and return to the Qyra extension.</p>
  </div>
</body>
</html>`;
}

function errorPage(message: string): string {
  const safe = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Qyra — QuickBooks Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0f172a; color: #e2e8f0; display: flex;
           align-items: center; justify-content: center;
           height: 100vh; margin: 0; }
    .card { text-align: center; padding: 48px 56px;
            background: #1e293b; border-radius: 16px;
            border: 1px solid #7f1d1d; max-width: 480px; }
    h1 { color: #ef4444; margin: 16px 0 8px; font-size: 1.4rem; }
    .msg { color: #94a3b8; font-size: 0.9rem; word-break: break-word; }
    .hint { color: #475569; font-size: 0.8rem; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:56px">❌</div>
    <h1>Authorization Failed</h1>
    <p class="msg">${safe}</p>
    <p class="hint">Close this tab and try again from the Qyra extension.</p>
  </div>
</body>
</html>`;
}

export default router;


