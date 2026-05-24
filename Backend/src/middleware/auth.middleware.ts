import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types';

const JWT_SECRET = process.env.JWT_SECRET ?? 'fallback-secret-not-for-production';

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; email: string; role?: string; name?: string | null };
    req.user = { userId: decoded.sub, email: decoded.email, role: decoded.role, name: decoded.name };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
