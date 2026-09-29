import type { NextFunction, Request, Response } from 'express';
import { Role, UserStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../lib/tokens';
import { forbidden, unauthorized } from '../lib/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: Role };
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();

    const payload = verifyAccessToken(header.slice(7));
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true },
    });

    if (!user) throw unauthorized('Account no longer exists');
    if (user.status === UserStatus.BLOCKED) throw forbidden('Your account has been blocked');
    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw forbidden('Please verify your account before continuing');
    }

    req.user = { id: user.id, role: user.role };
    next();
  } catch (err) {
    next(err instanceof Error && err.name === 'JsonWebTokenError' ? unauthorized('Invalid token') : err);
  }
}

/** Role gate. `requireRole(Role.ADMIN)` protects the whole admin surface. */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
