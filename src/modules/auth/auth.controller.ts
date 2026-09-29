import type { Request, Response } from 'express';
import { asyncHandler, created, ok } from '../../lib/http';
import { badRequest } from '../../lib/errors';
import { authService } from './auth.service';
import { isProd } from '../../config/env';

const device = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

const REFRESH_COOKIE = 'refresh_token';
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
};

export const authController = {
  register: asyncHandler(async (req, res) => created(res, await authService.register(req.body))),

  verifyEmail: asyncHandler(async (req, res) => ok(res, await authService.verifyEmail(req.body.token))),

  login: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.login(req.body.email, req.body.password, device(req));
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
    return ok(res, result);
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const token = req.body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
    if (!token) throw badRequest('Refresh token missing');
    const result = await authService.refresh(token, device(req));
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
    return ok(res, result);
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    const token = req.body?.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    return ok(res, await authService.logout(token, req.user?.id));
  }),

  forgotPassword: asyncHandler(async (req, res) => ok(res, await authService.forgotPassword(req.body.email))),

  resetPassword: asyncHandler(async (req, res) =>
    ok(res, await authService.resetPassword(req.body.token, req.body.password)),
  ),

  changePassword: asyncHandler(async (req, res) =>
    ok(res, await authService.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword)),
  ),

  me: asyncHandler(async (req, res) => ok(res, await authService.me(req.user!.id))),

  updateProfile: asyncHandler(async (req, res) => ok(res, await authService.updateProfile(req.user!.id, req.body))),
};
