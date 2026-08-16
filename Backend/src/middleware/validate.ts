import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export function validate(schema: z.ZodSchema, location: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const input = location === 'body' ? req.body : location === 'query' ? req.query : req.params;
    const result = schema.safeParse(input);
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.') || location;
        fields[path] = issue.message;
      }
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          requestId: (req as any).id || '',
          fields,
        },
      });
    }
    if (location === 'body') req.body = result.data;
    else if (location === 'query') (req as any).query = result.data;
    else (req as any).params = result.data;
    return next();
  };
}
