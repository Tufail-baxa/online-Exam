import type { NextFunction, Request, Response } from 'express';

/** Every successful response has the same envelope. */
export const ok = <T>(res: Response, data: T, meta?: unknown) =>
  res.json({ success: true, data, ...(meta ? { meta } : {}) });

export const created = <T>(res: Response, data: T) =>
  res.status(201).json({ success: true, data });

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler =
  (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);
