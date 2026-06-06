import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fields = result.error.issues.reduce<Record<string, string>>((acc, issue) => {
        const path = issue.path.join('.') || 'body';
        acc[path] = issue.message;
        return acc;
      }, {});

      return res.status(400).json({
        error: 'Validation failed',
        fields,
      });
    }
    req.body = result.data;
    return next();
  };
}
