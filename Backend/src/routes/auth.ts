import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'fallback-secret';

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    if (!user.password) return res.status(401).json({ error: 'This account has not been set up yet. Please contact the admin.' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });
    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/auth/request-access
router.post('/request-access', async (req: Request, res: Response) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const normalizedEmail = email.toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) return res.status(409).json({ error: 'An account with this email already exists. Use Forgot Password instead.' });
    const pendingRequest = await prisma.accessRequest.findFirst({
      where: { email: normalizedEmail, type: 'SIGNUP', status: 'PENDING' },
    });
    if (pendingRequest) return res.status(409).json({ error: 'A request for this email is still pending approval.' });
    await prisma.accessRequest.create({
      data: { email: normalizedEmail, name: name || null, type: 'SIGNUP', status: 'PENDING' },
    });
    return res.json({ message: "Your request has been submitted. You'll receive an email once approved." });
  } catch (err) {
    console.error('[Auth] Request access error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const normalizedEmail = email.toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!existingUser) return res.status(404).json({ error: 'No account found with this email. You may need to request access first.' });
    const pendingRequest = await prisma.accessRequest.findFirst({
      where: { email: normalizedEmail, type: 'RESET', status: 'PENDING' },
    });
    if (pendingRequest) return res.status(403).json({ error: 'A reset request for this email is already pending.' });
    await prisma.accessRequest.create({
      data: { email: normalizedEmail, name: existingUser.name, type: 'RESET', status: 'PENDING' },
    });
    return res.json({ message: "Your reset request has been submitted. You'll receive an email once approved by the admin." });
  } catch (err) {
    console.error('[Auth] Forgot password error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/auth/session
router.get('/session', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated.' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; email: string; role?: string; name?: string | null };
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, role: true, name: true },
    });
    if (!user) return res.status(401).json({ error: 'User not found.' });
    return res.json({ user });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
});

export default router;
