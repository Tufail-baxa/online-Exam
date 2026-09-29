import { prisma } from '../../lib/prisma';

/**
 * Recomputes the full leaderboard for an exam.
 * Tie-break order: score desc, then total time taken asc, then earliest submission.
 * Equal score *and* equal time share a rank; the next rank skips accordingly.
 */
export async function recomputeRankings(examId: string) {
  const results = await prisma.result.findMany({
    where: { examId },
    select: { id: true, userId: true, marksObtained: true, timeSpentSeconds: true, createdAt: true },
    orderBy: [{ marksObtained: 'desc' }, { timeSpentSeconds: 'asc' }, { createdAt: 'asc' }],
  });

  const total = results.length;
  if (total === 0) return { ranked: 0 };

  let lastKey = '';
  let lastRank = 0;

  const rows = results.map((r, index) => {
    const key = `${r.marksObtained.toString()}|${r.timeSpentSeconds}`;
    const rank = key === lastKey ? lastRank : index + 1;
    lastKey = key;
    lastRank = rank;

    const below = total - rank; // candidates strictly worse off
    const percentile = total > 1 ? Number(((below / (total - 1)) * 100).toFixed(3)) : 100;

    return {
      examId,
      userId: r.userId,
      resultId: r.id,
      rank,
      percentile,
      score: r.marksObtained,
      tieBreakValue: r.timeSpentSeconds,
    };
  });

  await prisma.$transaction([
    prisma.ranking.deleteMany({ where: { examId } }),
    prisma.ranking.createMany({ data: rows }),
  ]);

  return { ranked: rows.length };
}
