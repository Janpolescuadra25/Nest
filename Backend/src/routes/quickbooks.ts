import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { authenticate, AuthRequest, locationFilter, requirePermission } from '../middleware/auth.middleware';
import { qbService } from '../services/qb.service';
import { CreateJournalEntryInput, QBJournalLineItem } from '../types';
import { prisma } from '../lib/prisma';
import { validate } from '../middleware/validate';
import { journalEntrySchema } from '../lib/validators';
import { encrypt, decryptSafe } from '../lib/encryption';

const router = Router();

const QB_CLIENT_ID = process.env.QB_CLIENT_ID;
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) {
  throw new Error('QB_CLIENT_ID and QB_CLIENT_SECRET environment variables are required');
}

const QB_REDIRECT_URI = process.env.QB_REDIRECT_URI ?? '';
const QB_AUTH_URL = process.env.QB_AUTH_URL ?? 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = process.env.QB_TOKEN_URL ?? 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

// ── GET /api/quickbooks/auth-url ──────────────────────────────────────────────
// Requires JWT — binds the CSRF state to this user and persists it in the DB
// so the callback works even after server restarts.
router.get('/auth-url', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const state = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-min TTL

    // Persist state → userId in DB (survives server restarts)
    await prisma.oAuthState.upsert({
      where: { state },
      update: { userId: req.user!.userId, expiresAt },
      create: { state, userId: req.user!.userId, expiresAt },
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
    console.error('[QB] Failed to generate auth URL:', err);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

// ── GET /api/quickbooks/callback ──────────────────────────────────────────────
// Browser redirect from Intuit — NO Authorization header.
// Uses the DB-persisted state to identify the user.
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
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
    res.status(400).send(errorPage(`Missing required parameters: ${missing.join(', ')}`));
    return;
  }

  // ── Look up user from persisted state ─────────────────────────────────────
  let userId: string;
  try {
    const stateRecord = await prisma.oAuthState.findUnique({ where: { state } });

    if (!stateRecord) {
      console.error('[QB] State not found in DB — may have been used already or expired. state:', state);
      res.status(400).send(errorPage('Authorization session not found or already used. Please start the connection flow again from the extension.'));
      return;
    }

    if (stateRecord.expiresAt < new Date()) {
      console.error('[QB] State expired at', stateRecord.expiresAt);
      await prisma.oAuthState.delete({ where: { state } }).catch(() => {});
      res.status(400).send(errorPage('Authorization session expired. Please start the connection flow again from the extension.'));
      return;
    }

    userId = stateRecord.userId;
    await prisma.oAuthState.delete({ where: { state } }); // one-time use
  } catch (err) {
    console.error('[QB] DB error during state lookup:', err);
    res.status(500).send(errorPage('Internal error verifying authorization state.'));
    return;
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
    res.status(500).send(errorPage(errMessage));
  }
});

// ── GET /api/quickbooks/status ────────────────────────────────────────────────
router.get('/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const token = await prisma.qBToken.findUnique({ where: { userId: req.user!.userId } });
    if (!token) {
      res.json({ connected: false });
      return;
    }
    const tokenExpired = token.expiresAt < new Date();
    res.json({
      connected: true,
      realmId: token.realmId,
      expiresAt: token.expiresAt,
      tokenExpired,
    });
  } catch (err) {
    console.error('[QB] status error:', err);
    res.status(500).json({ error: 'Failed to check QB status' });
  }
});

// ── POST /api/quickbooks/journal-entry ────────────────────────────────────────
router.post('/journal-entry', authenticate, requirePermission('canSync'), validate(journalEntrySchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { txnDate, lines, privateNote, scanRecordId, docNumber } = req.body as {
      txnDate?: string;
      lines?: QBJournalLineItem[];
      privateNote?: string;
      scanRecordId?: string;
      docNumber?: string;
    };

    if (!txnDate || !lines || !Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: 'txnDate and lines[] are required' });
      return;
    }

    // Verify scan's location is accessible when scanRecordId is provided
    if (scanRecordId) {
      const scan = await prisma.scanRecord.findUnique({
        where: { id: scanRecordId },
        select: { locationId: true },
      });
      if (scan) {
        const loc = await prisma.location.findFirst({
          where: { id: scan.locationId, ...locationFilter(req.user!) },
        });
        if (!loc) {
          res.status(403).json({ error: "You don't have access to this location" });
          return;
        }
      }
    }

    const { accessToken, realmId } = await getValidToken(req.user!.userId);

    const input: CreateJournalEntryInput = {
      txnDate,
      docNumber,
      lines,
      privateNote,
      realmId,
      accessToken,
    };

    const result = await qbService.createJournalEntry(input);

    if (scanRecordId) {
      await prisma.syncLog.create({
        data: {
          scanRecordId,
          qbJournalEntryId: result.id,
          status: 'SUCCESS',
        },
      });

      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'SYNCED' },
      });
    }

    res.json({
      message: 'Journal Entry created successfully',
      journalEntryId: result.id,
      txnDate: result.txnDate,
      totalAmount: result.totalAmount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] journal-entry error:', message);

    // Log failure if scanRecordId was provided
    const { scanRecordId } = req.body as { scanRecordId?: string };
    if (scanRecordId) {
      await prisma.syncLog.create({
        data: {
          scanRecordId,
          status: 'FAILED',
          errorMessage: message,
        },
      }).catch(console.error);

      await prisma.scanRecord.update({
        where: { id: scanRecordId },
        data: { status: 'FAILED' },
      }).catch(console.error);
    }

    res.status(500).json({ error: message });
  }
});

// ── Helper: get valid (refreshed) QB token for a user ────────────────────────
async function getValidToken(userId: string): Promise<{ accessToken: string; realmId: string }> {
  const qbToken = await prisma.qBToken.findUnique({ where: { userId } });
  if (!qbToken) throw new Error('QuickBooks not connected. Please complete OAuth first.');

  if (qbToken.expiresAt < new Date()) {
    const refreshToken = decryptSafe(qbToken.refreshToken);
    const refreshed = await qbService.refreshAccessToken(refreshToken);
    await prisma.qBToken.update({
      where: { userId },
      data: {
        accessToken: encrypt(refreshed.accessToken),
        refreshToken: encrypt(refreshed.refreshToken),
        expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
      },
    });
    return { accessToken: refreshed.accessToken, realmId: qbToken.realmId };
  }

  return { accessToken: decryptSafe(qbToken.accessToken), realmId: qbToken.realmId };
}

// ── GET /api/quickbooks/accounts ──────────────────────────────────────────────
router.get('/accounts', authenticate, requirePermission('canSync'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accessToken, realmId } = await getValidToken(req.user!.userId);
    const accounts = await qbService.getAccounts(realmId, accessToken);
    res.json({ accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] accounts error:', message);
    res.status(500).json({ error: 'Failed to fetch accounts', message });
  }
});

// ── GET /api/quickbooks/classes ───────────────────────────────────────────────
router.get('/classes', authenticate, requirePermission('canSync'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accessToken, realmId } = await getValidToken(req.user!.userId);
    const classes = await qbService.getClasses(realmId, accessToken);
    res.json({ classes });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] classes error:', message);
    res.status(500).json({ error: 'Failed to fetch classes', message });
  }
});

// ── GET /api/quickbooks/employees ─────────────────────────────────────────────
router.get('/employees', authenticate, requirePermission('canSync'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accessToken, realmId } = await getValidToken(req.user!.userId);
    const employees = await qbService.getEmployees(realmId, accessToken);
    res.json({ employees });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] employees error:', message);
    res.status(500).json({ error: 'Failed to fetch employees', message });
  }
});

// ── GET /api/quickbooks/vendors ───────────────────────────────────────────────
router.get('/vendors', authenticate, requirePermission('canSync'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accessToken, realmId } = await getValidToken(req.user!.userId);
    const vendors = await qbService.getVendors(realmId, accessToken);
    res.json({ vendors });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] vendors error:', message);
    res.status(500).json({ error: 'Failed to fetch vendors', message });
  }
});

// ── GET /api/quickbooks/customers ─────────────────────────────────────────────
router.get('/customers', authenticate, requirePermission('canSync'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accessToken, realmId } = await getValidToken(req.user!.userId);
    const customers = await qbService.getCustomers(realmId, accessToken);
    res.json({ customers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] customers error:', message);
    res.status(500).json({ error: 'Failed to fetch customers', message });
  }
});

// ── GET /api/quickbooks/tax-codes ────────────────────────────────────────────
router.get('/tax-codes', authenticate, requirePermission('canSync'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accessToken, realmId } = await getValidToken(req.user!.userId);
    const taxCodes = await qbService.getTaxCodes(realmId, accessToken);
    res.json({ taxCodes });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] tax-codes error:', message);
    res.status(500).json({ error: 'Failed to fetch tax codes', message });
  }
});

// ── GET /api/quickbooks/sync-all ──────────────────────────────────────────────
router.get('/sync-all', authenticate, requirePermission('canSync'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accessToken, realmId } = await getValidToken(req.user!.userId);
    const [accounts, classes, employees, vendors, customers, taxCodes] = await Promise.all([
      qbService.getAccounts(realmId, accessToken),
      qbService.getClasses(realmId, accessToken),
      qbService.getEmployees(realmId, accessToken),
      qbService.getVendors(realmId, accessToken),
      qbService.getCustomers(realmId, accessToken),
      qbService.getTaxCodes(realmId, accessToken),
    ]);
    res.json({ accounts, classes, employees, vendors, customers, taxCodes });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QB] sync-all error:', message);
    res.status(500).json({ error: message });
  }
});

// ── HTML page helpers ─────────────────────────────────────────────────────────
function successPage(realmId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Nest — QuickBooks Connected</title>
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
    <p class="hint">You can close this tab and return to the Nest extension.</p>
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
  <title>Nest — QuickBooks Error</title>
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
    <p class="hint">Close this tab and try again from the Nest extension.</p>
  </div>
</body>
</html>`;
}

export default router;
