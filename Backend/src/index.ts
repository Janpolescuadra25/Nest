import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth';
import locationRoutes from './routes/locations';
import mappingRoutes from './routes/mappings';
import ruleRoutes from './routes/rules';
import scanRoutes from './routes/scans';
import quickbooksRoutes from './routes/quickbooks';
import adminRoutes from './routes/admin';
import adminRequestRoutes from './routes/adminRequests';
import ownerRoutes from './routes/owner';
import inviteRoutes from './routes/invite';
import passwordResetRoutes from './routes/password-reset';
import { prisma } from './lib/prisma';
import { startTimeBombCron } from './cron/timebomb';
import { startTrialWarningCron } from './cron/trial-warnings';

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the first proxy hop so req.ip reflects the real client IP (needed for
// accurate rate limiting behind Render's load balancer).
app.set('trust proxy', 1);

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    const allowedExtensionId = process.env.ALLOWED_EXTENSION_ID;
    if (!origin || origin === 'undefined') {
      return callback(null, true);
    }
    if (allowedExtensionId && origin === `chrome-extension://${allowedExtensionId}`) {
      return callback(null, true);
    }
    if (!allowedExtensionId && origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }
    const appUrl = process.env.APP_URL;
    if (appUrl && origin === appUrl) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(helmet({
  contentSecurityPolicy: false,
}));

// ── Health Check — before globalLimiter so Render's poller is never 429'd ──
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'nest-backend', timestamp: new Date().toISOString() });
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
  console.log(`[${req.method}] ${req.path}`);
  next();
});


// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/mappings', mappingRoutes);
app.use('/api/rules', ruleRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/quickbooks', quickbooksRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/invite', inviteRoutes);
app.use('/api/admin-requests', adminRequestRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/password-reset', passwordResetRoutes);

// ── Web Pages ───────────────────────────────────────────────────────────────
app.get('/reset-password', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/reset-password/index.html'));
});

// ── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global Error Handler ────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Express Error]', err.message);
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Start ────────────────────────────────────────────────────────────────────
startTimeBombCron(prisma);
startTrialWarningCron(prisma);
app.listen(PORT, () => {
  console.log(`[Nest] Server running on http://localhost:${PORT}`);
  console.log(`[Nest] Environment: ${process.env.NODE_ENV ?? 'development'}`);
});

export default app;
