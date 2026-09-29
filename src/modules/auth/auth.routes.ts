import { Router } from 'express';
import { authController } from './auth.controller';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimit';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifySchema,
} from './auth.schemas';

export const authRoutes = Router();

authRoutes.post('/register', authLimiter, validate(registerSchema), authController.register);
authRoutes.post('/verify-email', validate(verifySchema), authController.verifyEmail);
authRoutes.post('/login', authLimiter, validate(loginSchema), authController.login);
authRoutes.post('/refresh', validate(refreshSchema), authController.refresh);
authRoutes.post('/logout', authController.logout);
authRoutes.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
authRoutes.post('/reset-password', authLimiter, validate(resetPasswordSchema), authController.resetPassword);

authRoutes.use(authenticate);
authRoutes.get('/me', authController.me);
authRoutes.patch('/me', validate(updateProfileSchema), authController.updateProfile);
authRoutes.post('/change-password', validate(changePasswordSchema), authController.changePassword);
