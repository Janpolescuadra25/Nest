import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { qbService } from '../services/qb.service';
import { CreateJournalEntryInput, QBJournalLineItem } from '../types';

const router = Router();
const prisma = new PrismaClient();

const QB_CLIENT_ID = process.env.QB_CLIENT_ID ?? '';
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET ?? '';
const QB_REDIRECT_URI = process.env.QB_REDIRECT_URI ?? '';
const QB_AUTH_URL = process.env.QB_AUTH_URL ?? 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = process.env.QB_TOKEN_URL ?? 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

// ── GET /api/quickbooks/auth-url ──────────────────────────────────────────────
// Generate the QB OAuth 2.0 authorization URL (no auth required — user initiates it)
router.get('/auth-url', (req: Request, res: Response): void => {
  const state = Math.random().toString(36).slice(2); // CSRF protection token

  const params = new URLSearchParams({
    client_id: QB_CLIENT_ID,
    redirect_uri: QB_REDIRECT_URI,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    state,
  });

  const authUrl = `${QB_AUTH_URL}?${params.toString()}`;

  console.log('[QB] Auth URL generated for state:', state);
  res.json({ authUrl, state });
});

// ── GET /api/quickbooks/callback ──────────────────────────────────────────────
// Handle OAuth callback, exchange code for tokens, store them
router.get('/callback', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { code, realmId, state } = req.query as {
      code?: string; realmId?: string; state?: string;
    };

    if (!code || !realmId) {
      res.status(400).json({ error: 'code and realmId are required in query params' });
      return;
    }

    console.log('[QB] Received OAuth callback — state:', state, 'realmId:', realmId);

    // Exchange authorization code for tokens
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
      res.status(502).json({ error: 'Failed to exchange code for tokens', details: errorText });
      return;
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Store tokens in DB
    await prisma.qBToken.upsert({
      where: { userId: req.user!.userId },
      update: {
        realmId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
      },
      create: {
        userId: req.user!.userId,
        realmId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
      },
    });

    res.json({ message: 'QuickBooks connected successfully', realmId });
  } catch (err) {
    console.error('[QB] callback error:', err);
    res.status(500).json({ error: 'Failed to complete QuickBooks authorization' });
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

    const input: CreateJournalEntryInput = {
      txnDate,
      lines,
      privateNote,
      realmId: qbToken.realmId,
      accessToken: qbToken.accessToken,
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
