import { AppError } from '../lib/errors';
import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => next(new AppError('Too many attempts. Please try again in 15 minutes.', 429)),
});

export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => next(new AppError('Too many attempts. Please try again in 15 minutes.', 429)),
});

export const emailVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => next(new AppError('Too many attempts. Please try again in 15 minutes.', 429)),
});
