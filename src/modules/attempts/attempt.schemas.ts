import { z } from 'zod';

export const startAttemptSchema = z.object({ examId: z.string().cuid() });

export const saveAnswerSchema = z
  .object({
    examQuestionId: z.string().cuid(),
    selectedOptionIds: z.array(z.string().cuid()).max(10).optional(),
    numericAnswer: z.number().finite().nullable().optional(),
    markedForReview: z.boolean().optional(),
    clear: z.boolean().optional(),
    timeSpentSeconds: z.number().int().min(0).max(3600).optional(),
  })
  .refine(
    (v) => v.clear || v.selectedOptionIds !== undefined || v.numericAnswer !== undefined || v.markedForReview !== undefined,
    { message: 'Nothing to save' },
  );

export const attemptIdSchema = z.object({ id: z.string().cuid() });
