import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import analyticsRoutes from './routes/analytics';
import authRoutes from './routes/auth';
import locationRoutes from './routes/locations';
import mappingRoutes from './routes/mappings';
import templateRoutes from './routes/templates';
import ruleRoutes from './routes/rules';
import scanRoutes from './routes/scans';
import quickbooksRoutes from './routes/quickbooks';
import adminRoutes from './routes/admin';
import adminRequestRoutes from './routes/adminRequests';
import ownerRoutes from './routes/owner';
import inviteRoutes from './routes/invite';
import notificationRoutes from './routes/notifications';
import passwordResetRoutes from './routes/password-reset';
import productRoutes from './routes/products';
import productMappingRoutes from './routes/product-mappings';
import payeeMappingRoutes from './routes/payee-mappings';
import valueMappingRoutes from './routes/value-mappings';
import exportRoutes from './routes/exports';
import emailVerificationRoutes from './routes/email-verification';
import checkoutRoutes from './routes/checkout';
import webhookRoutes from './routes/webhooks';
import { authenticate } from './middleware/auth.middleware';
import { prisma } from './lib/prisma';
import { resetOwnerIfRequested } from './lib/owner-reset';
import { startTimeBombCron } from './cron/timebomb';
import { startTrialWarningCron } from './cron/trial-warnings';
import { startSyncFailureAlertCron } from './cron/sync-failure-alerts';
import { startQuotaAlertCron } from './cron/quota-alerts';
import { startScanCleanupCron } from './cron/scan-cleanup';
import { createErrorHandler } from './lib/errors';

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the first proxy hop so req.ip reflects the real client IP (needed for
// accurate rate limiting behind Render's load balancer).
app.set('trust proxy', 1);

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // No origin = server-to-server request (webhooks, health checks). Always allow.
    if (!origin) {
      return callback(null, true);
    }

    // In development, allow all origins
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    // In production, only allow whitelisted origins
    const allowedOrigins = [process.env.APP_URL, process.env.LANDING_PAGE_URL].filter(Boolean);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow the specific Chrome extension by ID (if configured)
    const allowedExtensionId = process.env.ALLOWED_EXTENSION_ID;
    if (allowedExtensionId && origin === `chrome-extension://${allowedExtensionId}`) {
      return callback(null, true);
    }

    // Allow any chrome-extension:// origin when ALLOWED_EXTENSION_ID is not set.
    // Extension IDs vary per computer when loaded unpacked. Set ALLOWED_EXTENSION_ID
    // to lock to a specific ID after publishing to the Chrome Web Store.
    if (origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }

    // Reject non-whitelisted origins — server-side rejection, route handler never executes
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '1mb' }), webhookRoutes);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "https://cdn.tailwindcss.com"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.static(path.join(__dirname, '../public')));

// ── Health Check — before globalLimiter so Render's poller is never 429'd ──
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', service: 'qyra-backend', database: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[Health] Database check failed:', err);
    res.status(503).json({ status: 'error', service: 'qyra-backend', database: 'disconnected', timestamp: new Date().toISOString() });
  }
});

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use(globalLimiter);

// ── Request Logger ─────────────────────────────────────────────────────────
app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[${req.method}] ${req.path}`);
  }
  next();
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/mappings', mappingRoutes);
app.use('/api/rules', ruleRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/quickbooks', quickbooksRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/invite', inviteRoutes);
app.use('/api/admin-requests', adminRequestRoutes);
app.use('/api/analytics', authenticate, analyticsRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/product-mappings', productMappingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/exports', authenticate, exportRoutes);
app.use('/api/payee-mappings', payeeMappingRoutes);
app.use('/api/value-mappings', valueMappingRoutes);
app.use('/api/password-reset', passwordResetRoutes);
app.use('/api/email-verification', emailVerificationRoutes);
app.use('/api/checkout', checkoutRoutes);

app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ── Web Pages ───────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/landing/index.html'));
});
app.get('/reset-password', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/reset-password/index.html'));
});
app.get('/verify-email', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/verify-email/index.html'));
});
app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/privacy.html'));
});
app.get('/terms', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/terms.html'));
});
app.get('/billing-success', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/billing-success.html'));
});
app.get('/billing-cancel', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/billing-cancel.html'));
});

// ── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global Error Handler ────────────────────────────────────────────────────
app.use(createErrorHandler());

// ── Start ────────────────────────────────────────────────────────────────────
startTimeBombCron(prisma);
startTrialWarningCron(prisma);
startSyncFailureAlertCron(prisma);
startQuotaAlertCron(prisma);
startScanCleanupCron(prisma);
resetOwnerIfRequested().catch(err => console.error('[Owner Reset] Startup error:', err));
const server = app.listen(PORT, () => {
  console.log(`[Qyra] Server running on http://localhost:${PORT}`);
  console.log(`[Qyra] Environment: ${process.env.NODE_ENV ?? 'development'}`);
});

function gracefulShutdown(signal: string) {
  console.log(`[Qyra] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('[Qyra] HTTP server closed.');
    prisma.$disconnect().then(() => {
      console.log('[Qyra] Database disconnected.');
      process.exit(0);
    });
  });
  setTimeout(() => {
    console.error('[Qyra] Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;

