import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

/** Tight limit on credential endpoints to blunt brute-force attempts. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
});

/** Answer autosave is chatty by design, so it gets its own generous bucket. */
export const answerLimiter = rateLimit({ windowMs: 60_000, limit: 240 });
