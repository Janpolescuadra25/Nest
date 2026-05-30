import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { AuthPayload } from '../types';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

/**
 * Verifies the Bearer JWT, fetches the full user row from the DB,
 * checks the account is not DISABLED, and attaches req.user.
 */
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        adminId: true,
        canScan: true,
        canMap: true,
        canSync: true,
        canManageLocs: true,
        mustChangePassword: true,
        trialExpiresAt: true,
        maxUsers: true,
      },
    });

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    if (user.status === 'DISABLED') {
      res.status(403).json({ error: 'Account is disabled' });
      return;
    }

    req.user = {
      id: user.id,
      userId: user.id,   // backward-compat alias — existing routes use this
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      adminId: user.adminId,
      canScan: user.canScan,
      canMap: user.canMap,
      canSync: user.canSync,
      canManageLocs: user.canManageLocs,
      mustChangePassword: user.mustChangePassword,
      trialExpiresAt: user.trialExpiresAt,
      maxUsers: user.maxUsers,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Invalid or expired token' });
    } else {
      console.error('[Auth] Middleware error:', err);
      res.status(500).json({ error: 'Authentication service unavailable' });
    }
  }
}

/**
 * Middleware factory — requires the authenticated user to have one of the given roles.
 * Place after `authenticate`.
 */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/**
 * Middleware factory — ensures a sub-user can only act on their own team.
 * OWNER bypasses the check entirely; ADMIN may only target themselves.
 * @param paramField - name of the Express route param holding the target user id
 */
export function requireOwnTeam(paramField: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const user = req.user!;
    if (user.role === 'OWNER') { next(); return; }

    const targetId = req.params[paramField];
    if (user.role === 'ADMIN' && targetId === user.userId) { next(); return; }

    res.status(403).json({ error: 'Access denied' });
  };
}

/**
 * Returns a Prisma `where` fragment that scopes Location queries to the
 * set of locations visible to the current user.
 *
 *   OWNER       → no filter (sees everything)
 *   ADMIN       → adminId = their own userId
 *   sub-users   → adminId = their admin's userId
 *   legacy      → userId = their own userId (no adminId yet assigned)
 */
export function locationFilter(user: AuthPayload): Record<string, unknown> {
  if (user.role === 'OWNER') return {};
  if (user.role === 'ADMIN') return { adminId: user.userId };
  if (user.adminId) return { adminId: user.adminId };
  // Legacy fallback for users who pre-date the hierarchy
  return { userId: user.userId };
}

/**
 * Middleware factory — requires the authenticated user to have a specific
 * boolean permission flag set to true. OWNER always passes.
 * Place after `authenticate`.
 */
export const requirePermission = (field: 'canScan' | 'canMap' | 'canSync' | 'canManageLocs') => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const user = req.user!;
    if (user.role === 'OWNER') { next(); return; }
    if (!user[field]) {
      res.status(403).json({ error: 'Permission denied: ' + field });
      return;
    }
    next();
  };
};
