export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError(400, 'BAD_REQUEST', m, d);
export const unauthorized = (m = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', m);
export const forbidden = (m = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Resource not found') => new AppError(404, 'NOT_FOUND', m);
export const conflict = (m: string) => new AppError(409, 'CONFLICT', m);
export const gone = (m: string) => new AppError(410, 'GONE', m);
