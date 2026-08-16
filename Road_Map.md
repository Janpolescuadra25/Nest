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

## Next Priority
### P-6: Database Query Optimization (4 sub-phases)

**P-6a: Add Missing Composite Indexes**
- **Goal**: Add critical composite indexes to the Prisma schema for high-frequency query patterns.
- **What needs to be achieved**: Add composite indexes on `[userId, createdAt]` for ScanRecord, SyncLog, and AuditLog. Add composite index on `[locationId, status]` for ScanRecord. Add composite index on `[adminId, role]` for User. Generate and run Prisma migration.
- **Risk**: Medium (requires Prisma migration, but zero application code changes)
- **Success criteria**: Migration runs cleanly. 117/117 tests pass. No application code modifications.

**P-6b: Eager Loading Cleanup**
- **Goal**: Remove unnecessary deep nested `include` patterns in dashboard and analytics routes.
- **What needs to be achieved**: Audit all `include` chains deeper than 2 levels. Simplify or replace with targeted `select` where full nested objects aren't needed by the frontend.
- **Risk**: Low (only affects dashboard/analytics routes)
- **Success criteria**: All nested includes reduced to necessary depth. 117/117 tests pass.

**P-6c: Targeted Pagination for High-Growth Tables**
- **Goal**: Add `take`/`skip` pagination to findMany queries on tables that grow unbounded (scan history, sync logs, audit logs).
- **What needs to be achieved**: Identify routes querying ScanRecord, SyncLog, and AuditLog without pagination. Add pagination with sensible defaults and optional page/limit query parameters. Routes querying bounded data (user's locations, team members) are excluded.
- **Risk**: Medium (changes API response for paginated routes — consumers must handle pagination metadata)
- **Success criteria**: All high-growth table queries have pagination. Existing tests updated for paginated responses. 117/117 tests pass.

**P-6d: Projection & Query Deduplication**
- **Goal**: Add targeted `select` to findMany calls fetching unnecessary fields. Remove redundant duplicate queries within single request handlers.
- **What needs to be achieved**: Replace `include` with `select` for queries where only specific fields are consumed. Deduplicate queries that fetch the same data twice in one request.
- **Risk**: High (removing fetched fields can break frontend consumers that access them)
- **Success criteria**: All queries fetch only required fields. No duplicate queries per request. Requires frontend compatibility verification. 117/117 tests pass.
