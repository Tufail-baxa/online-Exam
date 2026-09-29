import { AnswerStatus, AttemptStatus, ExamStatus, QuestionType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { badRequest, conflict, forbidden, gone, notFound } from '../../lib/errors';
import { scoreQuestion, type ScorableQuestion, type ScoreLine } from '../scoring/scoring.service';
import { recomputeRankings } from '../scoring/ranking.service';

const num = (v: unknown) => Number(v ?? 0);
const shuffle = <T>(items: T[]): T[] => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
};

/**
 * Loads the exam paper. Correct answers and explanations are deliberately not
 * selected here — this shape is what reaches the student's browser.
 */
async function loadPaper(examId: string) {
  return prisma.examQuestion.findMany({
    where: { examId },
    orderBy: [{ section: { order: 'asc' } }, { order: 'asc' }],
    select: {
      id: true,
      order: true,
      marks: true,
      negativeMarks: true,
      section: { select: { id: true, name: true, order: true, marksPerCorrect: true, negativeMarks: true } },
      question: {
        select: {
          id: true,
          type: true,
          text: true,
          imageUrl: true,
          difficulty: true,
          subject: { select: { id: true, name: true } },
          options: { select: { id: true, label: true, text: true, imageUrl: true, order: true }, orderBy: { order: 'asc' } },
        },
      },
    },
  });
}

const marksFor = (eq: { marks: unknown; section: { marksPerCorrect: unknown } }) =>
  eq.marks === null ? num(eq.section.marksPerCorrect) : num(eq.marks);

const penaltyFor = (eq: { negativeMarks: unknown; section: { negativeMarks: unknown } }) =>
  eq.negativeMarks === null ? num(eq.section.negativeMarks) : num(eq.negativeMarks);

export const attemptService = {
  /**
   * Starts a new attempt, or transparently resumes an in-progress one so that a
   * refresh, crash or dropped connection never costs the student their paper.
   */
  async start(examId: string, userId: string, device: { ip?: string; userAgent?: string }) {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) throw notFound('Exam not found');
    if (exam.status !== ExamStatus.PUBLISHED) throw forbidden('This exam is not open');

    const now = new Date();
    if (now < exam.startAt) throw forbidden('This exam has not started yet');
    if (now > exam.endAt) throw gone('This exam window has closed');

    if (exam.isPaid) {
      const enrolled = await prisma.examEnrollment.findUnique({
        where: { examId_userId: { examId, userId } },
        select: { id: true },
      });
      if (!enrolled) throw forbidden('Complete the payment to access this exam');
    }

    const existing = await prisma.examAttempt.findFirst({
      where: { examId, userId, status: AttemptStatus.IN_PROGRESS },
      orderBy: { attemptNo: 'desc' },
    });
    if (existing) {
      if (existing.expiresAt <= now) return this.finalize(existing.id, AttemptStatus.AUTO_SUBMITTED);
      return this.getState(existing.id, userId);
    }

    const used = await prisma.examAttempt.count({ where: { examId, userId } });
    if (used >= exam.maxAttempts) throw conflict('You have used all attempts for this exam');

    const paper = await loadPaper(examId);
    if (paper.length === 0) throw badRequest('This exam has no questions assigned yet');

    // Freeze the ordering now so it is stable across reconnects.
    const grouped = new Map<string, string[]>();
    for (const eq of paper) {
      const list = grouped.get(eq.section.id) ?? [];
      list.push(eq.id);
      grouped.set(eq.section.id, list);
    }
    const questionOrder = [...grouped.values()].flatMap((ids) => (exam.randomizeQuestions ? shuffle(ids) : ids));

    // End of the attempt is whichever comes first: personal timer or exam window.
    const personalEnd = new Date(now.getTime() + exam.durationMinutes * 60_000);
    const expiresAt = personalEnd < exam.endAt ? personalEnd : exam.endAt;

    const attempt = await prisma.examAttempt.create({
      data: {
        examId,
        userId,
        attemptNo: used + 1,
        startedAt: now,
        expiresAt,
        questionOrder,
        ipAddress: device.ip ?? null,
        userAgent: device.userAgent ?? null,
        answers: {
          createMany: {
            data: questionOrder.map((examQuestionId) => ({ examQuestionId, status: AnswerStatus.NOT_VISITED })),
          },
        },
      },
    });

    return this.getState(attempt.id, userId);
  },

  /** Full resumable state: paper, saved answers, and remaining seconds from the server clock. */
  async getState(attemptId: string, userId: string) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: { select: { id: true, title: true, instructions: true, durationMinutes: true, allowSectionSwitching: true, randomizeOptions: true } },
        answers: true,
      },
    });
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.userId !== userId) throw forbidden();

    const now = new Date();
    if (attempt.status === AttemptStatus.IN_PROGRESS && attempt.expiresAt <= now) {
      return this.finalize(attempt.id, AttemptStatus.AUTO_SUBMITTED);
    }

    const paper = await loadPaper(attempt.examId);
    const byId = new Map(paper.map((eq) => [eq.id, eq]));
    const order = attempt.questionOrder as string[];
    const answers = new Map(attempt.answers.map((a) => [a.examQuestionId, a]));

    const questions = order.flatMap((eqId, index) => {
      const eq = byId.get(eqId);
      if (!eq) return [];
      const saved = answers.get(eqId);
      const options = attempt.exam.randomizeOptions ? shuffle(eq.question.options) : eq.question.options;
      return [
        {
          examQuestionId: eq.id,
          index: index + 1,
          sectionId: eq.section.id,
          sectionName: eq.section.name,
          subject: eq.question.subject,
          type: eq.question.type,
          text: eq.question.text,
          imageUrl: eq.question.imageUrl,
          marks: marksFor(eq),
          negativeMarks: penaltyFor(eq),
          options: eq.question.type === QuestionType.NUMERICAL ? [] : options,
          answer: {
            status: saved?.status ?? AnswerStatus.NOT_VISITED,
            selectedOptionIds: saved?.selectedOptionIds ?? [],
            numericAnswer: saved?.numericAnswer ? num(saved.numericAnswer) : null,
            timeSpentSeconds: saved?.timeSpentSeconds ?? 0,
          },
        },
      ];
    });

    const sections = [...new Map(paper.map((eq) => [eq.section.id, eq.section])).values()].sort(
      (a, b) => a.order - b.order,
    );

    return {
      attempt: {
        id: attempt.id,
        status: attempt.status,
        startedAt: attempt.startedAt,
        expiresAt: attempt.expiresAt,
        serverTime: now,
        remainingSeconds: Math.max(0, Math.floor((attempt.expiresAt.getTime() - now.getTime()) / 1000)),
      },
      exam: attempt.exam,
      sections: sections.map((s) => ({ id: s.id, name: s.name, order: s.order })),
      questions,
    };
  },

  /** Autosave. Idempotent, cheap, and safe to call on every interaction. */
  async saveAnswer(
    attemptId: string,
    userId: string,
    input: {
      examQuestionId: string;
      selectedOptionIds?: string[];
      numericAnswer?: number | null;
      markedForReview?: boolean;
      clear?: boolean;
      timeSpentSeconds?: number;
    },
  ) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      select: { id: true, userId: true, status: true, expiresAt: true },
    });
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.userId !== userId) throw forbidden();
    if (attempt.status !== AttemptStatus.IN_PROGRESS) throw gone('This attempt has already been submitted');

    // Small grace window absorbs network latency on the last answer.
    const deadline = attempt.expiresAt.getTime() + env.SUBMIT_GRACE_SECONDS * 1000;
    if (Date.now() > deadline) {
      await this.finalize(attempt.id, AttemptStatus.AUTO_SUBMITTED);
      throw gone('Time is up — your attempt was submitted automatically');
    }

    const existing = await prisma.studentAnswer.findUnique({
      where: { attemptId_examQuestionId: { attemptId, examQuestionId: input.examQuestionId } },
    });
    if (!existing) throw badRequest('That question is not part of this attempt');

    const selected = input.clear ? [] : input.selectedOptionIds ?? existing.selectedOptionIds;
    const numeric = input.clear ? null : input.numericAnswer ?? (existing.numericAnswer ? num(existing.numericAnswer) : null);
    const hasAnswer = selected.length > 0 || numeric !== null;
    const marked = input.markedForReview ?? [AnswerStatus.MARKED_FOR_REVIEW, AnswerStatus.ANSWERED_AND_MARKED].includes(existing.status);

    const status = marked
      ? hasAnswer
        ? AnswerStatus.ANSWERED_AND_MARKED
        : AnswerStatus.MARKED_FOR_REVIEW
      : hasAnswer
        ? AnswerStatus.ANSWERED
        : AnswerStatus.NOT_ANSWERED;

    const saved = await prisma.studentAnswer.update({
      where: { id: existing.id },
      data: {
        selectedOptionIds: selected,
        numericAnswer: numeric,
        status,
        visitCount: { increment: 1 },
        timeSpentSeconds: input.timeSpentSeconds
          ? existing.timeSpentSeconds + Math.min(input.timeSpentSeconds, 3600)
          : existing.timeSpentSeconds,
      },
      select: { examQuestionId: true, status: true, selectedOptionIds: true, numericAnswer: true },
    });

    await prisma.examAttempt.update({ where: { id: attemptId }, data: { lastActivityAt: new Date() } });
    return saved;
  },

  async heartbeat(attemptId: string, userId: string) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      select: { userId: true, status: true, expiresAt: true },
    });
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.userId !== userId) throw forbidden();

    if (attempt.status === AttemptStatus.IN_PROGRESS && attempt.expiresAt <= new Date()) {
      await this.finalize(attemptId, AttemptStatus.AUTO_SUBMITTED);
      return { status: AttemptStatus.AUTO_SUBMITTED, remainingSeconds: 0 };
    }

    await prisma.examAttempt.update({ where: { id: attemptId }, data: { lastActivityAt: new Date() } });
    return {
      status: attempt.status,
      serverTime: new Date(),
      remainingSeconds: Math.max(0, Math.floor((attempt.expiresAt.getTime() - Date.now()) / 1000)),
    };
  },

  async submit(attemptId: string, userId: string) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      select: { id: true, userId: true, status: true },
    });
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.userId !== userId) throw forbidden();
    if (attempt.status !== AttemptStatus.IN_PROGRESS) throw conflict('This attempt is already submitted');
    return this.finalize(attemptId, AttemptStatus.SUBMITTED);
  },

  /**
   * Marks the attempt closed and computes the result server-side.
   * Used by manual submit, the expiry sweeper, and late-answer detection alike.
   */
  async finalize(attemptId: string, status: AttemptStatus) {
    const attempt = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { exam: true, answers: true },
    });

    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      return { attemptId, status: attempt.status, alreadyFinalized: true };
    }

    const paper = await prisma.examQuestion.findMany({
      where: { examId: attempt.examId },
      select: {
        id: true,
        marks: true,
        negativeMarks: true,
        section: { select: { id: true, name: true, marksPerCorrect: true, negativeMarks: true } },
        question: {
          select: {
            type: true,
            allowPartialMarking: true,
            numericAnswer: true,
            numericTolerance: true,
            subject: { select: { id: true, name: true } },
            options: { where: { isCorrect: true }, select: { id: true } },
          },
        },
      },
    });

    const answers = new Map(attempt.answers.map((a) => [a.examQuestionId, a]));
    const submittedAt = new Date();

    let marksObtained = 0;
    let totalMarks = 0;
    let negativeMarks = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let unattemptedCount = 0;
    let timeSpentSeconds = 0;

    type Bucket = { id: string; name: string; total: number; obtained: number; correct: number; incorrect: number; unattempted: number };
    const sections = new Map<string, Bucket>();
    const subjects = new Map<string, Bucket>();

    const bucket = (map: Map<string, Bucket>, id: string, name: string) => {
      const found = map.get(id) ?? { id, name, total: 0, obtained: 0, correct: 0, incorrect: 0, unattempted: 0 };
      map.set(id, found);
      return found;
    };

    for (const eq of paper) {
      const marks = marksFor(eq);
      const scorable: ScorableQuestion = {
        type: eq.question.type,
        marks,
        negativeMarks: attempt.exam.negativeMarkingEnabled ? penaltyFor(eq) : 0,
        allowPartialMarking: eq.question.allowPartialMarking,
        correctOptionIds: eq.question.options.map((o) => o.id),
        numericAnswer: eq.question.numericAnswer ? num(eq.question.numericAnswer) : null,
        numericTolerance: num(eq.question.numericTolerance),
      };

      const saved = answers.get(eq.id);
      const line: ScoreLine = scoreQuestion(scorable, {
        selectedOptionIds: saved?.selectedOptionIds ?? [],
        numericAnswer: saved?.numericAnswer ? num(saved.numericAnswer) : null,
      });

      const net = line.awarded - line.penalty;
      totalMarks += marks;
      marksObtained += net;
      negativeMarks += line.penalty;
      timeSpentSeconds += saved?.timeSpentSeconds ?? 0;

      if (line.verdict === 'CORRECT' || line.verdict === 'PARTIAL') correctCount += 1;
      else if (line.verdict === 'INCORRECT') incorrectCount += 1;
      else unattemptedCount += 1;

      for (const b of [
        bucket(sections, eq.section.id, eq.section.name),
        bucket(subjects, eq.question.subject.id, eq.question.subject.name),
      ]) {
        b.total += marks;
        b.obtained += net;
        if (line.verdict === 'CORRECT' || line.verdict === 'PARTIAL') b.correct += 1;
        else if (line.verdict === 'INCORRECT') b.incorrect += 1;
        else b.unattempted += 1;
      }
    }

    const round = (n: number) => Number(n.toFixed(2));
    const percentage = totalMarks > 0 ? round((marksObtained / totalMarks) * 100) : 0;

    const [, result] = await prisma.$transaction([
      prisma.examAttempt.update({ where: { id: attemptId }, data: { status, submittedAt } }),
      prisma.result.create({
        data: {
          attemptId,
          examId: attempt.examId,
          userId: attempt.userId,
          totalMarks: round(totalMarks),
          marksObtained: round(marksObtained),
          percentage,
          correctCount,
          incorrectCount,
          unattemptedCount,
          negativeMarks: round(negativeMarks),
          timeSpentSeconds: timeSpentSeconds || Math.floor((submittedAt.getTime() - attempt.startedAt.getTime()) / 1000),
          passed: marksObtained >= num(attempt.exam.passingMarks),
          published: attempt.exam.resultsPublished,
          sectionBreakdown: [...sections.values()].map((b) => ({ ...b, obtained: round(b.obtained), total: round(b.total) })),
          subjectBreakdown: [...subjects.values()].map((b) => ({ ...b, obtained: round(b.obtained), total: round(b.total) })),
        },
      }),
    ]);

    if (attempt.exam.rankingEnabled) await recomputeRankings(attempt.examId);

    return {
      attemptId,
      status,
      resultId: result.id,
      // Scores stay hidden until the admin publishes results for the exam.
      result: attempt.exam.resultsPublished ? result : { published: false },
    };
  },
};
