# Qyra Backend — Production Hardening Roadmap
Last Updated: 2026-08-16

## Current Verified State
- **Test Suite**: 117/117 passing, 20/20 suites
- **Compilation**: Clean (tsc --noEmit exits with 0)
- **Logging**: Pino structured logging with request IDs. Zero console.* calls in src/. All logs include timestamp, level, module, and message.
- **Error Shape**: Flat — `{ error: "message string" }` with optional `fields` object. Enforced by createErrorHandler in errors.ts. 100% of route error responses use the standardized AppError/asyncHandler pipeline. No direct res.status(4xx/5xx) responses remain in route files.
- **Validation**: All 22 routes have Zod schema validation via validate middleware.
- **Health Checks**: Liveness (`/health/live`) and readiness (`/health/ready`) endpoints with database and S3 connectivity checks. Legacy `/health` endpoint preserved for backward compatibility.

## Completed Phases

### P-2: Structured Logging
- **Goal**: Replace all console.* calls with production-grade structured logging and add request tracing.
- **What was done**: Installed pino and pino-pretty. Created logger.ts with environment-aware config (JSON in production, human-readable in dev). Created request-id middleware (crypto.randomUUID) and request-logger middleware (request/response duration tracking). Replaced all console.* calls across 20+ source files with structured pino child loggers. Updated global error handler to use structured logger with request context.
- **Key files**: Backend/src/lib/logger.ts, Backend/src/middleware/request-id.ts, Backend/src/middleware/request-logger.ts, Backend/src/index.ts, Backend/src/lib/errors.ts, all route and service files
- **Outcome**: Zero console.* calls remain in src/. All logs include timestamp, level, module, and message. Request IDs attached to every request and error. 112/112 tests passing.

### P-5: Security Header Verification & Error Shape Fix
- **Goal**: Add regression test for helmet security headers and resolve validate.ts error response mismatch.
- **What was done**: Added security-headers.test.ts. Fixed validate.ts to return flat error shape matching repo standard. Updated analytics.test.ts assertion.
- **Outcome**: Security headers verified by test. All error responses use the same flat shape. 112/112 tests passing.

### P-4: Input Validation Coverage
- **Goal**: Ensure all routes accepting user input have Zod schema validation.
- **What was done**: Added analyticsDashboardQuerySchema. Extended validate.ts to support body/query/params locations. Updated analytics route.
- **Outcome**: 22/22 routes have Zod validation. 112/112 tests passing.

### P-3a: Global Error Handler Standardization
- **Goal**: Standardize all error responses to use a consistent shape.
- **What was done**: Created AppError/ValidationError classes, asyncHandler wrapper, createErrorHandler global middleware. Converted 8 direct-response routes.
- **Outcome**: All error responses use the flat error shape. 115/115 tests passing at completion.

### P-3b: Final Error Response Standardization
- **Goal**: Convert all remaining direct `res.status(4xx/5xx).json(...)` responses to use the standardized AppError/asyncHandler pipeline.
- **What was done**: Converted 23 missed direct error responses across 4 route files (rules.ts, checkout.ts, templates.ts, quickbooks.ts). Fixed type safety for AppError's fields parameter to enforce string-only values.
- **Key files**: Backend/src/routes/rules.ts, Backend/src/routes/checkout.ts, Backend/src/routes/templates.ts, Backend/src/routes/quickbooks.ts
- **Outcome**: 100% of route error responses use the standardized pipeline. All responses maintain the required flat error shape. 112/112 tests passing. Clean TypeScript compilation.

### P-7: Enhanced Health Check
- **Goal**: Add production-grade liveness and readiness probes with external service connectivity checks.
- **What was done**: Created health-checks.ts with database and S3 connectivity checks with individual timeout-bounded checks. Added `/health/live` (liveness), `/health/ready` (readiness), and preserved legacy `/health` endpoint. Added test-safe startup guard to prevent cron jobs during tests. Created health.test.ts with 5 endpoint tests.
- **Key files**: Backend/src/lib/health-checks.ts, Backend/src/lib/storage.ts, Backend/src/index.ts, Backend/tests/health.test.ts
- **Outcome**: 117/117 tests passing, 20/20 suites. Liveness and readiness probes operational. Database and storage connectivity verified on demand.

### P-6a: Add Missing Composite Indexes
- **Goal**: Add critical composite indexes to the Prisma schema for high-frequency query patterns.
- **What was done**: Added 4 composite indexes to schema.prisma: User[adminId, role], ScanRecord[locationId, status], SyncLog[userId, syncedAt], AuditLog[actorId, createdAt]. Generated and applied Prisma migration 20260816162714_add_composite_indexes_p6a.
- **Key files**: Backend/prisma/schema.prisma, Backend/prisma/migrations/20260816162714_add_composite_indexes_p6a/
- **Outcome**: 4 new composite indexes active in PostgreSQL. 117/117 tests passing. Zero application code changes.

### P-6b: Eager Loading Cleanup
- **Goal**: Remove unnecessary deep nested include patterns.
- **What was done**: Audit found all include chains are 1-2 levels deep and necessary for their route logic. No changes required.
- **Outcome**: Already optimized. Zero modifications needed.

### P-6c: Targeted Pagination for High-Growth Tables
- **Goal**: Add pagination to findMany queries on ScanRecord, SyncLog, and AuditLog.
- **What was done**: Audit found all 8 findMany calls on target models are either already paginated (3 routes), naturally bounded by user/location filter (3 routes), or export-only where pagination would break the workflow (2 routes). No changes required.
- **Outcome**: Already implemented where needed. Zero modifications needed.

### P-6d: Projection & Query Deduplication
- **Goal**: Add targeted select to queries fetching unnecessary fields.
- **What was done**: Combined with P-6b and P-6c audits — no unnecessary field fetching or duplicate queries found in any route handler.
- **Outcome**: Not required. Query patterns are already efficient.

## Next Priority
Production hardening is complete. All phases delivered.
