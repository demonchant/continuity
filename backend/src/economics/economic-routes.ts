import { timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { serializeBaseTransaction } from '../integrations/base/base-routes.js';
import type { MissionService } from '../missions/mission-service.js';
import { AppError } from '../shared/errors/app-error.js';
import { asyncHandler } from '../shared/http/async-handler.js';
import { validateBody } from '../shared/http/validation.js';
import type { EconomicActionService } from './economic-action-service.js';

const requestSchema = z
  .object({
    missionId: z.string().uuid(),
    capabilities: z.array(z.string().trim().min(1)).min(1).max(20),
    budgetCurrency: z
      .string()
      .trim()
      .min(2)
      .max(10)
      .transform((value) => value.toUpperCase()),
    candidateLimit: z.number().int().min(1).max(20).optional(),
    executeBase: z.boolean().default(false),
    actionId: z.string().trim().min(1).max(200),
    paymentId: z.string().trim().min(1).max(200),
  })
  .strict();

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
          code: 'ECONOMIC_UNAUTHORIZED',
          message: 'A valid operator token is required',
        }),
      );
      return;
    }
    next();
  };
}

function serialized(result: Awaited<ReturnType<EconomicActionService['execute']>>) {
  return result.baseAction.status === 'CONFIRMED'
    ? {
        ...result,
        baseAction: {
          ...result.baseAction,
          transaction: serializeBaseTransaction(result.baseAction.transaction),
        },
      }
    : result;
}

export function createEconomicRouter(
  service: EconomicActionService,
  missions: MissionService,
  operatorToken: string,
): Router {
  const router = Router();
  router.post(
    '/execute',
    authenticated(operatorToken),
    validateBody(requestSchema),
    asyncHandler(async (request, response) => {
      const input = request.body as z.infer<typeof requestSchema>;
      const mission = await missions.get(input.missionId);
      const result = await service.execute({
        mission,
        capabilities: input.capabilities,
        budgetCurrency: input.budgetCurrency,
        executeBase: input.executeBase,
        actionId: input.actionId,
        paymentId: input.paymentId,
        ...(input.candidateLimit ? { candidateLimit: input.candidateLimit } : {}),
      });
      response.json({ success: true, data: serialized(result) });
    }),
  );
  return router;
}

/** Economic preview and approved settlement now live in the coherent mission workspace. */
export function createEconomicDashboardRouter(): Router {
  const router = Router();
  router.get('/economic-decisions', (_request, response) => {
    response.redirect(302, '/dashboard/missions');
  });
  return router;
}
