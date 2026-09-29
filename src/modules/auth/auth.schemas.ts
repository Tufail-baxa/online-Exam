import { z } from 'zod';

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/\d/, 'Must contain a number');

export const registerSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  mobile: z.string().regex(/^\+?[0-9]{10,15}$/).optional(),
  password,
  dateOfBirth: z.coerce.date().optional(),
  course: z.string().max(80).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(10).optional() });
export const verifySchema = z.object({ token: z.string().min(10) });
export const forgotPasswordSchema = z.object({ email: z.string().email().toLowerCase() });
export const resetPasswordSchema = z.object({ token: z.string().min(10), password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

export const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  mobile: z.string().regex(/^\+?[0-9]{10,15}$/).optional(),
  dateOfBirth: z.coerce.date().optional(),
  photoUrl: z.string().url().optional(),
  course: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  preferences: z.record(z.unknown()).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
