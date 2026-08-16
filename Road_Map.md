# Qyra Backend — Production Hardening Roadmap
Last Updated: 2026-08-16

## Current Verified State
- **Test Suite**: 112/112 passing, 19/19 suites
- **Compilation**: Clean (tsc --noEmit exits with 0)
- **HEAD**: e17906f (3 commits ahead of origin/main)
- **Error Shape Standard**: Flat — `{ error: "message string" }` with optional `fields` object at top level. Enforced by createErrorHandler in errors.ts.
- **Unpushed Commits**: e17906f, 4fc2968, 00a1b48

## Completed Phases

### P-5: Security Header Verification & Error Shape Fix
- **Goal**: Add a regression test for helmet security headers and resolve the validate.ts error response mismatch.
- **What was done**: Added security-headers.test.ts to verify helmet headers (X-Frame-Options, X-Content-Type-Options, CSP) are present in responses. Discovered that validate.ts returned a non-standard nested error shape that differed from the repo's flat standard. Fixed validate.ts to return the flat shape. Updated analytics.test.ts assertion to match.
- **Key files**: Backend/tests/security-headers.test.ts, Backend/src/middleware/validate.ts, Backend/tests/analytics.test.ts
- **Outcome**: Security headers verified by test. All error responses in the repo now use the same flat shape. 112/112 tests passing.
- **Commit**: 00a1b48 (security test), e17906f (error shape fix)

### P-4: Input Validation Coverage
- **Goal**: Ensure all routes that accept user input have Zod schema validation.
- **What was done**: Audit found 21/22 routes already validated. Added analyticsDashboardQuerySchema to validators.ts for the one unvalidated endpoint. Extended validate.ts middleware to support body/query/params locations. Updated analytics route to use validate(schema, 'query').
- **Key files**: Backend/src/middleware/validate.ts, Backend/src/lib/validators.ts, Backend/src/routes/analytics.ts, Backend/tests/analytics.test.ts
- **Outcome**: 22/22 routes now have Zod validation. 112/112 tests passing.
- **Commit**: 37d7a92 (implementation), 4fc2968 (validate.ts commit fix)

### P-3a: Global Error Handler Standardization
- **Goal**: Convert routes that sent direct non-standard error responses to use a centralized error handler with a consistent shape.
- **What was done**: Created AppError and ValidationError classes in errors.ts. Added asyncHandler wrapper and createErrorHandler global middleware. Converted 8 route handlers that bypassed the global handler. Updated all affected tests to match the new shape.
- **Key files**: Backend/src/lib/errors.ts, Backend/src/routes/*, Backend/tests/*
- **Outcome**: All error responses use the flat error shape. 115/115 tests passing at completion.
- **Commit**: 37d7a92

## Next Priority

### P-2: Structured Logging
- **Goal**: Replace console.log/console.error calls with a production-grade structured logging library.
- **Pre-implementation audit required**:
  1. Catalog all console.log, console.error, console.warn usage across Backend/src/
  2. Categorize each instance (info, error, debug, warning)
  3. Identify which routes and middleware need request-scoped logging
  4. Verify no logging library is currently installed (confirmed: no pino/winston in package.json)
- **Implementation scope** (pending audit):
  - Install pino and pino-pretty (dev)
  - Create Backend/src/lib/logger.ts with environment-aware configuration
  - Replace all console calls with structured logger
  - Add logging middleware for request/response tracking
  - Create Backend/tests/logging.test.ts
- **Success criteria**: Zero console.* calls remain in src/. All logs include timestamp, level, and message. Full test suite passes. New logging tests pass.

## Future Phases (Unscoped)
The following phases are planned but have not been audited or scoped. They will be detailed after P-2 is complete.

- **P-3b**: Convert any remaining routes with non-standard responses to use the global error handler
- **P-6**: Database query performance audit and optimization
- **P-7**: Enhanced health check endpoint
