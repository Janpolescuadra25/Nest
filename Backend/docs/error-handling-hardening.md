# Error Handling Hardening — Completed 2026-08-22

## Problem
Production errors on Render were difficult to debug:
- `POST /api/mappings/suggest` returned 500 with no useful error message when `GEMINI_API_KEY` was missing
- `POST /api/templates/parse-excel-data` returned 400 for invalid file uploads with no client-side prevention
- Render logs showed zero error entries for failed requests (timing/retention issue, not a code bug)

## Root Causes (Verified by Hydra Audit)
1. **500**: `gemini.ts` threw plain `Error` (not `AppError`) for missing `GEMINI_API_KEY`, which worked but was inconsistent with the codebase's error handling pattern
2. **500**: No try/catch around Gemini API call (`model.generateContent()`), so network failures, rate limits, or API errors caused unhandled exceptions
3. **400**: Frontend sent invalid files to the backend without pre-validation, causing unnecessary network round-trips
4. **Logging gap**: No startup check for missing environment variables, so ops couldn't discover config issues from deploy logs

## Files Modified

### Backend/src/lib/gemini.ts
- **L583** (`suggestMappings`): `throw new Error(...)` → `throw new AppError('GEMINI_API_KEY is not configured', 503)`
- **L701** (`parseInvoiceWithGemini`): Same conversion to `AppError(..., 503)` for consistency
- **L652-658**: Added try/catch around `model.generateContent()` and response parsing. Re-throws existing `AppError` instances (malformed JSON), wraps all other errors into `AppError('AI suggestion service is temporarily unavailable. Please try again later.', 503)`

### Backend/src/index.ts
- **L212-215**: Added `logger.warn()` for missing/empty `GEMINI_API_KEY` before `app.listen()`. Non-fatal — server still starts without it.

### Frontend/src/popup/lib/api.ts
- **L551-564**: Added pre-send validation in `parseExcelData()`: file existence check, `.xlsx`/`.xls` extension check (case-insensitive), file size <10MB check. Mirrors backend multer validation.

## Error Handling Pipeline (For Reference)
- `AppError` (`Backend/src/lib/errors.ts:L6-L15`): extends Error with `status` and `fields`
- `asyncHandler` (`Backend/src/lib/errors.ts:L32-L41`): catches ALL errors, calls `next(err)`
- `createErrorHandler()` (`Backend/src/lib/errors.ts:L52-L81`): global middleware, logs ALL errors via Pino, sends generic message for 5xx in production

## Verification
- Backend tests: 20 passed, 117 total — no regressions
- Commit: `hardening: improve error handling for AI suggest and excel parse endpoints`

## Status
DONE — All changes committed and pushed.
