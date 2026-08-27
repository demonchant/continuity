import { timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { MissionService } from '../../missions/mission-service.js';
import { AppError } from '../../shared/errors/app-error.js';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { validateBody, validateParams } from '../../shared/http/validation.js';
import { BaseIntegrationError } from './base-errors.js';
import type { BasePaymentService } from './base-payment-service.js';
import type { BaseTransactionRepository } from './base-transaction-repository.js';
import type { BaseTransaction } from './base-transaction.js';

const paymentSchema = z
  .object({
    missionId: z.string().uuid(),
    actionId: z.string().trim().min(1).max(200),
    paymentId: z.string().trim().min(1).max(200),
    agentId: z.string().trim().min(1).max(300),
    amount: z.string().regex(/^\d+(?:\.\d{1,18})?$/),
    verificationId: z.string().trim().min(1).max(200),
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
          code: 'BASE_UNAUTHORIZED',
          message: 'A valid Base operator token is required',
        }),
      );
      return;
    }
    next();
  };
}

function publicError(error: unknown): never {
  if (!(error instanceof BaseIntegrationError)) throw error;
  const statusCode =
    error.code === 'BASE_BUDGET_EXCEEDED' || error.code === 'BASE_VALIDATION_ERROR' ? 422 : 502;
  throw new AppError({ statusCode, code: error.code, message: error.message, cause: error });
}

export function serializeBaseTransaction(transaction: BaseTransaction) {
  return {
    ...transaction,
    ...(transaction.blockNumber !== undefined
      ? { blockNumber: transaction.blockNumber.toString() }
      : {}),
  };
}

export function createBaseRouter(
  payments: BasePaymentService,
  transactions: BaseTransactionRepository,
  missions: MissionService,
  operatorToken: string,
): Router {
  const router = Router();
  router.use(authenticated(operatorToken));
  router.post(
    '/payments',
    validateBody(paymentSchema),
    asyncHandler(async (request, response) => {
      try {
        const input = request.body as z.infer<typeof paymentSchema>;
        const mission = await missions.get(input.missionId);
        const transaction = await payments.pay({ mission, ...input });
        response.status(200).json({ success: true, data: serializeBaseTransaction(transaction) });
      } catch (error) {
        publicError(error);
      }
    }),
  );
  router.get(
    '/transactions/:id',
    validateParams(idSchema),
    asyncHandler(async (request, response) => {
      const id = String(request.params.id);
      const transaction = await transactions.findById(id);
      if (!transaction) {
        throw new AppError({
          statusCode: 404,
          code: 'BASE_TRANSACTION_NOT_FOUND',
          message: `Base transaction not found: ${id}`,
        });
      }
      response.json({ success: true, data: serializeBaseTransaction(transaction) });
    }),
  );
  return router;
}
