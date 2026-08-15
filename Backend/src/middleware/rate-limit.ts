import { AppError } from '../lib/errors';
import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    const resetTime = (req as any).rateLimit?.resetTime;
    const retryAfter = Math.ceil(resetTime ? (resetTime.getTime() - Date.now()) / 1000 : 900);
    res.setHeader('Retry-After', String(retryAfter));
    next(new AppError('Too many attempts. Please try again in 15 minutes.', 429));
  },
});

export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    const resetTime = (req as any).rateLimit?.resetTime;
    const retryAfter = Math.ceil(resetTime ? (resetTime.getTime() - Date.now()) / 1000 : 900);
    res.setHeader('Retry-After', String(retryAfter));
    next(new AppError('Too many attempts. Please try again in 15 minutes.', 429));
  },
});

export const emailVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    const resetTime = (req as any).rateLimit?.resetTime;
    const retryAfter = Math.ceil(resetTime ? (resetTime.getTime() - Date.now()) / 1000 : 900);
    res.setHeader('Retry-After', String(retryAfter));
    next(new AppError('Too many attempts. Please try again in 15 minutes.', 429));
  },
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    const resetTime = (req as any).rateLimit?.resetTime;
    const retryAfter = Math.ceil(resetTime ? (resetTime.getTime() - Date.now()) / 1000 : 60);
    res.setHeader('Retry-After', String(retryAfter));
    next(new AppError('Too many requests. Please try again later.', 429));
  },
});
