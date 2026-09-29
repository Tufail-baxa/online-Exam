import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export const signAccessToken = (payload: AccessTokenPayload) =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
  } as SignOptions);

export const verifyAccessToken = (token: string): AccessTokenPayload =>
  jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;

/** Refresh tokens are opaque random strings; only their hash is persisted. */
export const generateOpaqueToken = () => crypto.randomBytes(48).toString('base64url');

export const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

export const addDays = (days: number, from = new Date()) =>
  new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

export const addMinutes = (minutes: number, from = new Date()) =>
  new Date(from.getTime() + minutes * 60 * 1000);
