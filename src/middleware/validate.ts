import type { NextFunction, Request, Response } from 'express';
import { ZodError, type AnyZodObject } from 'zod';
import { badRequest } from '../lib/errors';

type Source = 'body' | 'query' | 'params';

/** Validates and *replaces* the request part with the parsed, typed value. */
export const validate =
  (schema: AnyZodObject, source: Source = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req[source]);
      Object.assign(req[source] as object, parsed);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(badRequest('Validation failed', err.flatten().fieldErrors));
      }
      next(err);
    }
  };
