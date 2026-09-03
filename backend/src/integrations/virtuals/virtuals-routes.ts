import { timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { MissionService } from '../../missions/mission-service.js';
import type { JsonObject } from '../../missions/mission.js';
import { AppError } from '../../shared/errors/app-error.js';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { validateBody, validateParams } from '../../shared/http/validation.js';
import type { VirtualsExecutionService } from './virtuals-execution-service.js';
import type { VirtualsJobRepository } from './virtuals-job-repository.js';
import { VirtualsProtocolError } from './virtuals-errors.js';

const executeSchema = z
  .object({
    missionId: z.string().uuid(),
    actionId: z.string().trim().min(1).max(200),
    capabilities: z.array(z.string().trim().min(1)).min(1).max(20),
    requirements: z.record(z.unknown()).default({}),
    candidateLimit: z.number().int().min(1).max(20).optional(),
  })
  .strict();
const discoverySchema = z
  .object({
    objective: z.string().trim().min(1).max(2_000),
    missionId: z.string().uuid().optional(),
    capabilities: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    candidateLimit: z.number().int().min(1).max(20).default(10),
  })
  .strict();
const idSchema = z.object({ id: z.string().uuid() }).strict();

function authenticated(expected: string): RequestHandler {
  return (request, _response, next) => {
    const authorization = request.header('authorization');
    const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      next(
        new AppError({
          statusCode: 401,
          code: 'VIRTUALS_UNAUTHORIZED',
          message: 'A valid Virtuals operator token is required',
        }),
      );
      return;
    }
    next();
  };
}

function publicError(error: unknown): never {
  if (!(error instanceof VirtualsProtocolError)) throw error;
  const statusCode =
    error.code === 'VIRTUALS_JOB_TIMEOUT'
      ? 504
      : error.code === 'VIRTUALS_BUDGET_EXCEEDED' || error.code === 'VIRTUALS_NO_OFFERING'
        ? 422
        : 502;
  throw new AppError({ statusCode, code: error.code, message: error.message, cause: error });
}

export function createVirtualsRouter(
  execution: VirtualsExecutionService,
  jobs: VirtualsJobRepository,
  missions: MissionService,
  operatorToken: string,
): Router {
  const router = Router();
  router.use(authenticated(operatorToken));
  router.post(
    '/discovery',
    validateBody(discoverySchema),
    asyncHandler(async (request, response) => {
      try {
        const input = request.body as z.infer<typeof discoverySchema>;
        if (input.missionId) {
          const mission = await missions.get(input.missionId);
          if (mission.objective !== input.objective) {
            throw new AppError({
              statusCode: 409,
              code: 'DISCOVERY_MISSION_MISMATCH',
              message: 'Discovery objective does not match the persisted mission',
            });
          }
          response.json({
            success: true,
            data: await execution.preview(mission, input.capabilities, input.candidateLimit),
          });
          return;
        }
        const candidates = await execution.discover({
          missionObjective: input.objective,
          capabilities: input.capabilities,
          limit: input.candidateLimit,
        });
        response.json({ success: true, data: { candidates, decision: null } });
      } catch (error) {
        publicError(error);
      }
    }),
  );
  router.post(
    '/execute',
    validateBody(executeSchema),
    asyncHandler(async (request, response) => {
      try {
        const input = request.body as z.infer<typeof executeSchema>;
        const mission = await missions.get(input.missionId);
        const result = await execution.execute({
          mission,
          actionId: input.actionId,
          capabilities: input.capabilities,
          requirements: input.requirements as JsonObject,
          ...(input.candidateLimit ? { candidateLimit: input.candidateLimit } : {}),
        });
        response.status(200).json({ success: true, data: result });
      } catch (error) {
        publicError(error);
      }
    }),
  );
  router.get(
    '/jobs/:id',
    validateParams(idSchema),
    asyncHandler(async (request, response) => {
      const id = String(request.params.id);
      const job = await jobs.findById(id);
      if (!job)
        throw new AppError({
          statusCode: 404,
          code: 'VIRTUALS_JOB_NOT_FOUND',
          message: `Virtuals job not found: ${id}`,
        });
      response.json({ success: true, data: job });
    }),
  );
  return router;
}
