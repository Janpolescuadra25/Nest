import { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';

export class AppError extends Error {
  public readonly status: number;
  public readonly fields?: Record<string, string>;

  constructor(message: string, status = 500, fields?: Record<string, string>) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.fields = fields;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(error: ZodError) {
    const flattened = error.flatten();
    const fields = Object.fromEntries(
      Object.entries(flattened.fieldErrors).map(([key, issues]) => [
        key,
        Array.isArray(issues) ? issues.filter(Boolean).join(', ') : issues ?? '',
      ])
    ) as Record<string, string>;
    super(error.message || 'Validation failed', 400, fields);
    this.name = 'ValidationError';
  }
}

export function asyncHandler<T extends RequestHandler>(fn: T): T {
  return (async (req, res, next) => {
    try {
      return await (fn as any)(req, res, next);
    } catch (err) {
      next(err);
    }
  }) as T;
}

export function createErrorHandler(): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const error = err as { message?: string; status?: number; statusCode?: number; fields?: Record<string, string>; category?: string };

    // QB auth failures return 401 internally but should be 403 to the client
    // to avoid triggering the frontend Qyra JWT auto-logout interceptor
    if (error.category === 'AUTH') {
      const qbMessage = error.message ?? 'QuickBooks connection expired';
      res.status(403).json({ error: qbMessage, errorType: 'AUTH' });
      return;
    }

    const status = error.status ?? error.statusCode ?? 500;
    const message = process.env.NODE_ENV === 'production'
      ? (status < 500 ? error.message ?? 'An error occurred' : 'Internal server error')
      : error.message ?? 'Internal server error';

    const payload: Record<string, unknown> = { error: message };
    if (error.fields) {
      payload.fields = error.fields;
    }

    if (err instanceof Error && err.stack && process.env.NODE_ENV !== 'production') {
      payload.stack = err.stack;
    }

    logger.error(
      {
        err,
        requestId: (req as any)?.id,
        statusCode: status,
        path: req?.originalUrl,
      },
      error.message || 'Unhandled error'
    );

    res.status(status).json(payload);
  };
}

