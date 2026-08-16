import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const reqLogger = logger.child({
    method: req.method,
    path: req.path,
    requestId: (req as any).id,
  });

  res.on('finish', () => {
    reqLogger.info(
      {
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      },
      `${req.method} ${req.originalUrl} ${res.statusCode}`
    );
  });

  next();
}
