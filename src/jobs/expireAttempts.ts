import cron from 'node-cron';
import { AttemptStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { attemptService } from '../modules/attempts/attempt.service';
import { logger } from '../lib/logger';

/**
 * Safety net for students who close the tab or lose connectivity: any attempt
 * past its server-side deadline is submitted and scored without them.
 */
export async function sweepExpiredAttempts() {
  const stale = await prisma.examAttempt.findMany({
    where: { status: AttemptStatus.IN_PROGRESS, expiresAt: { lte: new Date() } },
    select: { id: true },
    take: 200,
  });

  for (const attempt of stale) {
    try {
      await attemptService.finalize(attempt.id, AttemptStatus.AUTO_SUBMITTED);
    } catch (err) {
      logger.error({ err, attemptId: attempt.id }, 'Failed to auto-submit expired attempt');
    }
  }
  return stale.length;
}

export const startAttemptSweeper = () =>
  cron.schedule('* * * * *', async () => {
    const count = await sweepExpiredAttempts();
    if (count) logger.info({ count }, 'Auto-submitted expired attempts');
  });
