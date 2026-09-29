import type { Request } from 'express';
import { asyncHandler, created, ok } from '../../lib/http';
import { attemptService } from './attempt.service';

const device = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

export const attemptController = {
  start: asyncHandler(async (req, res) =>
    created(res, await attemptService.start(req.params.examId!, req.user!.id, device(req))),
  ),

  state: asyncHandler(async (req, res) => ok(res, await attemptService.getState(req.params.id!, req.user!.id))),

  saveAnswer: asyncHandler(async (req, res) =>
    ok(res, await attemptService.saveAnswer(req.params.id!, req.user!.id, req.body)),
  ),

  heartbeat: asyncHandler(async (req, res) => ok(res, await attemptService.heartbeat(req.params.id!, req.user!.id))),

  submit: asyncHandler(async (req, res) => ok(res, await attemptService.submit(req.params.id!, req.user!.id))),
};
