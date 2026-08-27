import { Router } from 'express';
import { asyncHandler } from '../shared/http/async-handler.js';
import { validateBody, validateParams } from '../shared/http/validation.js';
import { MissionController } from './mission-controller.js';
import { createMissionRequestSchema, missionIdParamsSchema } from './mission-schemas.js';
import type { MissionService } from './mission-service.js';
import { bearerAuthenticated } from '../shared/http/bearer-auth.js';

export function createMissionRouter(service: MissionService, operatorToken?: string): Router {
  const router = Router();
  const controller = new MissionController(service);
  const operator = operatorToken ? bearerAuthenticated(operatorToken) : undefined;

  router.post(
    '/',
    ...(operator ? [operator] : []),
    validateBody(createMissionRequestSchema),
    asyncHandler(controller.create),
  );
  router.get('/', ...(operator ? [operator] : []), asyncHandler(controller.list));
  router.get(
    '/:id',
    ...(operator ? [operator] : []),
    validateParams(missionIdParamsSchema),
    asyncHandler(controller.get),
  );
  router.post(
    '/:id/cancel',
    ...(operator ? [operator] : []),
    validateParams(missionIdParamsSchema),
    asyncHandler(controller.cancel),
  );

  return router;
}
