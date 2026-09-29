import { QuestionType } from '@prisma/client';

export interface ScorableQuestion {
  type: QuestionType;
  marks: number;
  negativeMarks: number;
  allowPartialMarking: boolean;
  correctOptionIds: string[];
  numericAnswer: number | null;
  numericTolerance: number;
}

export interface SubmittedAnswer {
  selectedOptionIds: string[];
  numericAnswer: number | null;
}

export type Verdict = 'CORRECT' | 'INCORRECT' | 'PARTIAL' | 'UNATTEMPTED';

export interface ScoreLine {
  verdict: Verdict;
  awarded: number;
  penalty: number;
}

const unattempted = (a: SubmittedAnswer, type: QuestionType) =>
  type === QuestionType.NUMERICAL
    ? a.numericAnswer === null || Number.isNaN(a.numericAnswer)
    : a.selectedOptionIds.length === 0;

/**
 * Single source of truth for marking. Runs on the server only — the client
 * never sees correct answers during an attempt, let alone computes a score.
 */
export function scoreQuestion(q: ScorableQuestion, answer: SubmittedAnswer): ScoreLine {
  if (unattempted(answer, q.type)) return { verdict: 'UNATTEMPTED', awarded: 0, penalty: 0 };

  if (q.type === QuestionType.NUMERICAL) {
    const expected = q.numericAnswer;
    const given = answer.numericAnswer as number;
    const isCorrect = expected !== null && Math.abs(given - expected) <= (q.numericTolerance ?? 0);
    return isCorrect
      ? { verdict: 'CORRECT', awarded: q.marks, penalty: 0 }
      : { verdict: 'INCORRECT', awarded: 0, penalty: q.negativeMarks };
  }

  const correct = new Set(q.correctOptionIds);
  const selected = new Set(answer.selectedOptionIds);

  if (q.type === QuestionType.SINGLE_CORRECT || q.type === QuestionType.TRUE_FALSE) {
    const only = answer.selectedOptionIds[0];
    return selected.size === 1 && only !== undefined && correct.has(only)
      ? { verdict: 'CORRECT', awarded: q.marks, penalty: 0 }
      : { verdict: 'INCORRECT', awarded: 0, penalty: q.negativeMarks };
  }

  // MULTIPLE_CORRECT — JEE Advanced style partial marking when enabled.
  const choseWrong = [...selected].some((id) => !correct.has(id));
  if (choseWrong) return { verdict: 'INCORRECT', awarded: 0, penalty: q.negativeMarks };

  const hits = [...selected].filter((id) => correct.has(id)).length;
  if (hits === correct.size) return { verdict: 'CORRECT', awarded: q.marks, penalty: 0 };
  if (q.allowPartialMarking && hits > 0) {
    const perOption = q.marks / correct.size;
    return { verdict: 'PARTIAL', awarded: Number((perOption * hits).toFixed(2)), penalty: 0 };
  }
  return { verdict: 'INCORRECT', awarded: 0, penalty: q.negativeMarks };
}
