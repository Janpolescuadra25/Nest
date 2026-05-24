import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { qbService } from '../services/qb.service';
import { CreateJournalEntryInput, QBJournalLineItem } from '../types';

// In-memory state → userId map for OAuth CSRF protection (one-time use, 10-min TTL)
const oauthStateMap = new Map<string, string>();

const router = Router();
const prisma = new PrismaClient();

const QB_CLIENT_ID = process.env.QB_CLIENT_ID ?? '';
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET ?? '';
const QB_REDIRECT_URI = process.env.QB_REDIRECT_URI ?? '';
const QB_AUTH_URL = process.env.QB_AUTH_URL ?? 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = process.env.QB_TOKEN_URL ?? 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

// ── GET /api/quickbooks/auth-url ──────────────────────────────────────────────
// Generate QB OAuth URL — requires auth so state can be bound to this user
router.get('/auth-url', authenticate, (req: AuthRequest, res: Response): void => {
  const state = randomBytes(16).toString('hex');
  oauthStateMap.set(state, req.user!.userId);
  setTimeout(() => oauthStateMap.delete(state), 10 * 60 * 1000); // expire in 10 min

  const params = new URLSearchParams({
    client_id: QB_CLIENT_ID,
    redirect_uri: QB_REDIRECT_URI,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    state,
  });

  const authUrl = `${QB_AUTH_URL}?${params.toString()}`;
  console.log('[QB] Auth URL generated for userId:', req.user!.userId);
  res.json({ authUrl, state });
});

// ── GET /api/quickbooks/callback ──────────────────────────────────────────────
// OAuth browser redirect — NO Authorization header here (it's a browser redirect from Intuit)
// Identify user via the state parameter stored in oauthStateMap
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, realmId, state, error } = req.query as {
      code?: string; realmId?: string; state?: string; error?: string;
    };

    if (error) {
      console.error('[QB] OAuth error from Intuit:', error);
      res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center;padding:40px;background:#1e293b;border-radius:12px">
          <div style="font-size:48px">❌</div>
          <h2 style="color:#ef4444">Authorization Failed</h2>
          <p>${error}</p><p style="color:#64748b">Close this tab and try again from the extension.</p>
        </div></body></html>`);
      return;
    }

    if (!code || !realmId || !state) {
      res.status(400).send('Missing required OAuth parameters.');
      return;
    }

    const userId = oauthStateMap.get(state);
    if (!userId) {
      res.status(400).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center;padding:40px;background:#1e293b;border-radius:12px">
          <div style="font-size:48px">⚠️</div>
          <h2 style="color:#f59e0b">Session Expired</h2>
          <p style="color:#64748b">Please start the authorization flow again from the extension.</p>
        </div></body></html>`);
      return;
    }
    oauthStateMap.delete(state); // one-time use

    console.log('[QB] OAuth callback — userId:', userId, 'realmId:', realmId);

    const credentials = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64');
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: QB_REDIRECT_URI,
    });

    const tokenResponse = await fetch(QB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: tokenBody.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[QB] Token exchange failed:', errorText);
      res.send(`<html><body><h2>Token exchange failed</h2><pre>${errorText}</pre></body></html>`);
      return;
    }

    const tokens = await tokenResponse.json() as {
      access_token: string; refresh_token: string; expires_in: number;
    };

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await prisma.qBToken.upsert({
      where: { userId },
      update: { realmId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt },
      create: { userId, realmId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt },
    });

    console.log('[QB] Tokens stored successfully for userId:', userId);

    res.send(`<!DOCTYPE html>
<html><head><title>Nest — QuickBooks Connected</title></head>
<body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="text-align:center;padding:40px;background:#1e293b;border-radius:12px;border:1px solid #334155">
    <div style="font-size:48px">✅</div>
    <h2 style="color:#22d3ee;margin:16px 0 8px">QuickBooks Connected!</h2>
    <p style="color:#94a3b8;margin:0">Company ID: ${realmId}</p>
    <p style="color:#64748b;font-size:14px;margin-top:16px">Close this tab and return to the Nest extension.</p>
  </div>
</body></html>`);
  } catch (err) {
    console.error('[QB] callback error:', err);
    res.status(500).send('<html><body>Internal server error during OAuth callback.</body></html>');
  }
});

// ── GET /api/quickbooks/status ────────────────────────────────────────────────
router.get('/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const token = await prisma.qBToken.findUnique({ where: { userId: req.user!.userId } });
    if (!token) { res.json({ connected: false }); return; }

    const isExpired = token.expiresAt < new Date();
    res.json({ connected: true, realmId: token.realmId, expiresAt: token.expiresAt, tokenExpired: isExpired });
  } catch (err) {
    console.error('[QB] status error:', err);
    res.status(500).json({ error: 'Failed to check QB status' });
  }
});

// ── POST /api/quickbooks/journal-entry ────────────────────────────────────────
// Create a QB Journal Entry from mapped scan data
router.post('/journal-entry', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { txnDate, lines, privateNote, scanRecordId } = req.body as {
      txnDate?: string;
      lines?: QBJournalLineItem[];
      privateNote?: string;
      scanRecordId?: string;
    };

    if (!txnDate || !lines || !Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: 'txnDate and lines[] are required' });
      return;
    }

    // Retrieve QB tokens for this user
    const qbToken = await prisma.qBToken.findUnique({ where: { userId: req.user!.userId } });

    if (!qbToken) {
      res.status(400).json({ error: 'QuickBooks not connected. Please complete OAuth first via /api/quickbooks/auth-url' });
      return;
    }

    // Auto-refresh access token if expired
    let accessToken = qbToken.accessToken;
    if (qbToken.expiresAt < new Date()) {
      console.log('[QB] Access token expired — refreshing...');
      const refreshed = await qbService.refreshAccessToken(qbToken.refreshToken);
      await prisma.qBToken.update({
        where: { userId: req.user!.userId },
        data: {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        },
      });
      accessToken = refreshed.accessToken;
    }

    const input: CreateJournalEntryInput = {
      txnDate,
      lines,
      privateNote,
      realmId: qbToken.realmId,
      accessToken,
    };

    const result = await qbService.createJournalEntry(input);

    // If a scanRecordId was provided, create a SyncLog and update status
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

    res.status(500).json({ error: 'Failed to create Journal Entry', message });
  }
});

export default router;
