import bcrypt from 'bcryptjs';
import { Role, TokenType, UserStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import {
  addDays,
  addMinutes,
  generateOpaqueToken,
  hashToken,
  signAccessToken,
} from '../../lib/tokens';
import { badRequest, conflict, forbidden, unauthorized } from '../../lib/errors';
import type { RegisterInput } from './auth.schemas';

const SALT_ROUNDS = 12;

interface DeviceInfo {
  ip?: string;
  userAgent?: string;
}

async function issueSession(userId: string, role: Role, device: DeviceInfo) {
  const refreshToken = generateOpaqueToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: addDays(env.REFRESH_TOKEN_TTL_DAYS),
      ip: device.ip ?? null,
      userAgent: device.userAgent ?? null,
    },
  });
  return { accessToken: signAccessToken({ sub: userId, role }), refreshToken };
}

async function issueVerificationToken(userId: string, type: TokenType, ttlMinutes: number) {
  const token = generateOpaqueToken();
  await prisma.verificationToken.create({
    data: { userId, type, tokenHash: hashToken(token), expiresAt: addMinutes(ttlMinutes) },
  });
  // TODO(delivery): hand `token` to the mail/SMS provider instead of returning it.
  return token;
}

export const authService = {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: input.email }, ...(input.mobile ? [{ mobile: input.mobile }] : [])] },
      select: { id: true },
    });
    if (existing) throw conflict('An account with these details already exists');

    const user = await prisma.user.create({
      data: {
        email: input.email,
        mobile: input.mobile ?? null,
        passwordHash: await bcrypt.hash(input.password, SALT_ROUNDS),
        role: Role.STUDENT,
        status: UserStatus.PENDING_VERIFICATION,
        studentProfile: {
          create: {
            fullName: input.fullName,
            dateOfBirth: input.dateOfBirth ?? null,
            course: input.course ?? null,
          },
        },
      },
      select: { id: true, email: true },
    });

    const verificationToken = await issueVerificationToken(user.id, TokenType.EMAIL_VERIFY, 60 * 24);
    return { userId: user.id, email: user.email, verificationToken };
  },

  async verifyEmail(rawToken: string) {
    const record = await prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!record || record.type !== TokenType.EMAIL_VERIFY) throw badRequest('Invalid verification link');
    if (record.consumedAt || record.expiresAt < new Date()) throw badRequest('This link has expired');

    await prisma.$transaction([
      prisma.verificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
      prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date(), status: UserStatus.ACTIVE },
      }),
    ]);
    return { verified: true };
  },

  async login(email: string, password: string, device: DeviceInfo) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, role: true, status: true },
    });

    // Same error either way so the endpoint does not leak which emails exist.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw unauthorized('Incorrect email or password');
    }
    if (user.status === UserStatus.BLOCKED) throw forbidden('Your account has been blocked');
    if (user.status === UserStatus.PENDING_VERIFICATION) throw forbidden('Please verify your email first');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tokens = await issueSession(user.id, user.role, device);
    return { ...tokens, role: user.role };
  },

  /** Rotating refresh: the presented token is revoked and replaced on every use. */
  async refresh(refreshToken: string, device: DeviceInfo) {
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: { select: { id: true, role: true, status: true } } },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw unauthorized('Session expired, please sign in again');
    }
    if (session.user.status !== UserStatus.ACTIVE) throw forbidden('Account is not active');

    const next = await issueSession(session.user.id, session.user.role, device);
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedById: hashToken(next.refreshToken) },
    });
    return next;
  },

  async logout(refreshToken?: string, userId?: string) {
    if (refreshToken) {
      await prisma.session.updateMany({
        where: { tokenHash: hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else if (userId) {
      await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return { loggedOut: true };
  },

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    // Always report success — never confirm whether an address is registered.
    if (!user) return { sent: true };
    const token = await issueVerificationToken(user.id, TokenType.PASSWORD_RESET, env.RESET_TOKEN_TTL_MINUTES);
    return { sent: true, token };
  },

  async resetPassword(rawToken: string, password: string) {
    const record = await prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!record || record.type !== TokenType.PASSWORD_RESET) throw badRequest('Invalid reset link');
    if (record.consumedAt || record.expiresAt < new Date()) throw badRequest('This reset link has expired');

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await bcrypt.hash(password, SALT_ROUNDS) },
      }),
      prisma.verificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
      // Password change kills every existing session.
      prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { reset: true };
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) },
      }),
      prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { changed: true };
  },

  async me(userId: string) {
    return prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        mobile: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        studentProfile: true,
        adminProfile: true,
      },
    });
  },

  async updateProfile(userId: string, data: Record<string, unknown>) {
    const { mobile, ...profile } = data as { mobile?: string };
    if (mobile) await prisma.user.update({ where: { id: userId }, data: { mobile, mobileVerifiedAt: null } });
    return prisma.studentProfile.update({ where: { userId }, data: profile });
  },
};
