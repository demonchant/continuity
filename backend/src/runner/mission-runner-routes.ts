import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../shared/http/async-handler.js';
import { bearerAuthenticated } from '../shared/http/bearer-auth.js';
import { validateParams } from '../shared/http/validation.js';
import type { MissionWorker } from './mission-worker.js';

const missionIdSchema = z.object({ id: z.string().uuid() }).strict();

export function createMissionRunnerRouter(worker: MissionWorker, operatorToken: string): Router {
  const router = Router();
  router.use(bearerAuthenticated(operatorToken, 'MISSION_RUNNER_UNAUTHORIZED'));
  router.post(
    '/:id/run',
    validateParams(missionIdSchema),
    asyncHandler(async (request, response) => {
      const mission = await worker.enqueue(String(request.params.id));
      response.status(202).json({
        success: true,
        data: {
          mission,
          workerId: worker.workerId,
          execution: 'QUEUED',
        },
      });
    }),
  );
  return router;
}
