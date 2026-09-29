import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { answerLimiter } from '../../middleware/rateLimit';
import { attemptController } from './attempt.controller';
import { saveAnswerSchema } from './attempt.schemas';

export const attemptRoutes = Router();

attemptRoutes.use(authenticate, requireRole(Role.STUDENT));

attemptRoutes.post('/exams/:examId/start', attemptController.start);
attemptRoutes.get('/attempts/:id', attemptController.state);
attemptRoutes.post('/attempts/:id/answer', answerLimiter, validate(saveAnswerSchema), attemptController.saveAnswer);
attemptRoutes.post('/attempts/:id/heartbeat', answerLimiter, attemptController.heartbeat);
attemptRoutes.post('/attempts/:id/submit', attemptController.submit);
