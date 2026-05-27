import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth';
import locationRoutes from './routes/locations';
import mappingRoutes from './routes/mappings';
import ruleRoutes from './routes/rules';
import scanRoutes from './routes/scans';
import quickbooksRoutes from './routes/quickbooks';
import adminRoutes from './routes/admin';
import adminRequestRoutes from './routes/adminRequests';
import ownerRoutes from './routes/owner';

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: true,  // allow all origins (Chrome extension uses chrome-extension:// scheme)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'nest-backend', timestamp: new Date().toISOString() });
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/mappings', mappingRoutes);
app.use('/api/rules', ruleRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/quickbooks', quickbooksRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin-requests', adminRequestRoutes);
app.use('/api/owner', ownerRoutes);

// ── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global Error Handler ────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Nest] Server running on http://localhost:${PORT}`);
  console.log(`[Nest] Environment: ${process.env.NODE_ENV ?? 'development'}`);
});

export default app;
