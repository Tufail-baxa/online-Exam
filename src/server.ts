import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { startAttemptSweeper } from './jobs/expireAttempts';

const app = createApp();
const server = app.listen(env.PORT, () => logger.info(`API listening on :${env.PORT}`));
const sweeper = startAttemptSweeper();

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  sweeper.stop();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
