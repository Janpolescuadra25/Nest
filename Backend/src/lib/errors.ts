import { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express';

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
  return (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = err as { message?: string; status?: number; statusCode?: number; fields?: Record<string, string> };
    const status = error.status ?? error.statusCode ?? 500;
    const message = process.env.NODE_ENV === 'production'
      ? (status < 500 ? error.message ?? 'An error occurred' : 'Internal server error')
      : error.message ?? 'Internal server error';

    const payload: Record<string, unknown> = { error: message };
    if (error.fields) {
      payload.fields = error.fields;
    }

    console.error('[Express Error]', error.message ?? err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
      if (process.env.NODE_ENV !== 'production') {
        payload.stack = err.stack;
      }
    }

    res.status(status).json(payload);
  };
}
