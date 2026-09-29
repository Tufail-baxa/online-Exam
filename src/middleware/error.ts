import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { isProd } from '../config/env';
import { logger } from '../lib/logger';

export const notFoundHandler = (_req: Request, res: Response) =>
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'That value is already in use' },
    });
  }

  if (err instanceof Error && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
  }

  logger.error({ err }, 'Unhandled error');
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
      ...(isProd ? {} : { details: err instanceof Error ? err.stack : String(err) }),
    },
  });
}
