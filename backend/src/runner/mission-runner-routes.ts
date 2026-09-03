import { Router } from 'express';
import { z } from 'zod';
import type { OperatorApprovalService } from '../approvals/operator-approval-service.js';
import type { BasePaymentService } from '../integrations/base/base-payment-service.js';
import type { VirtualsExecutionService } from '../integrations/virtuals/virtuals-execution-service.js';
import type { VirtualsJobRepository } from '../integrations/virtuals/virtuals-job-repository.js';
import type { MissionService } from '../missions/mission-service.js';
import { AppError } from '../shared/errors/app-error.js';
import { asyncHandler } from '../shared/http/async-handler.js';
import { bearerAuthenticated } from '../shared/http/bearer-auth.js';
import { validateBody, validateParams } from '../shared/http/validation.js';
import type { MissionWorker } from './mission-worker.js';
import { parseMissionPlan, type MissionPlanCaps } from './mission-plan.js';

const missionIdSchema = z.object({ id: z.string().uuid() }).strict();
const approvalSchema = z.object({ approved: z.literal(true) }).strict();

export interface MissionRunnerRouteDependencies {
  readonly worker: MissionWorker;
  readonly missions: MissionService;
  readonly jobs: VirtualsJobRepository;
  readonly virtuals: VirtualsExecutionService;
  readonly approvals: OperatorApprovalService;
  readonly basePayments?: BasePaymentService;
  readonly runnerCaps: MissionPlanCaps;
  readonly operatorToken: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function createMissionRunnerRouter(dependencies: MissionRunnerRouteDependencies): Router {
  const router = Router();
  router.use(bearerAuthenticated(dependencies.operatorToken, 'MISSION_RUNNER_UNAUTHORIZED'));
  router.post(
    '/:id/run',
    validateParams(missionIdSchema),
    asyncHandler(async (request, response) => {
      const mission = await dependencies.worker.enqueue(String(request.params.id));
      response.status(202).json({
        success: true,
        data: { mission, workerId: dependencies.worker.workerId, execution: 'QUEUED' },
      });
    }),
  );
  router.post(
    '/:id/approve-acp-spend',
    validateParams(missionIdSchema),
    validateBody(approvalSchema),
    asyncHandler(async (request, response) => {
      const missionId = String(request.params.id);
      const mission = await dependencies.missions.get(missionId);
      if (mission.status !== 'AWAITING_FUNDING_APPROVAL') {
        throw new AppError({
          statusCode: 409,
          code: 'MISSION_NOT_AWAITING_FUNDING_APPROVAL',
          message: `Mission is not awaiting ACP funding approval; found ${mission.status}`,
        });
      }
      const jobs = await dependencies.jobs.findByMissionId(missionId);
      const job = [...jobs]
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .find(({ state }) => state === 'AWAITING_FUNDING_APPROVAL');
      const proposed = object(object(job?.lifecycle)?.proposedBudget);
      const amount = typeof proposed?.amount === 'string' ? proposed.amount : undefined;
      const currency = typeof proposed?.currency === 'string' ? proposed.currency : undefined;
      if (!job || !amount || !currency) {
        throw new AppError({
          statusCode: 409,
          code: 'ACP_APPROVAL_INTENT_UNAVAILABLE',
          message: 'No durable ACP budget proposal is available for approval',
        });
      }
      const approval = await dependencies.approvals.approve({
        missionId,
        kind: 'ACP_FUNDING',
        actionId: `${job.actionId}:fund`,
        referenceId: job.externalJobId,
        amount,
        currency,
      });
      const resumed = await dependencies.worker.resumeApproved(
        missionId,
        'AWAITING_FUNDING_APPROVAL',
      );
      response.status(202).json({
        success: true,
        data: {
          approval: { ...approval, maximumJobUsdc: dependencies.virtuals.maximumJobUsdc },
          mission: resumed,
          execution: 'QUEUED',
        },
      });
    }),
  );
  router.post(
    '/:id/reconcile',
    validateParams(missionIdSchema),
    asyncHandler(async (request, response) => {
      const mission = await dependencies.worker.reconcileNow(String(request.params.id));
      response.status(202).json({
        success: true,
        data: { mission, workerId: dependencies.worker.workerId, reconciliation: 'STARTED' },
      });
    }),
  );
  router.post(
    '/:id/approve-base-settlement',
    validateParams(missionIdSchema),
    validateBody(approvalSchema),
    asyncHandler(async (request, response) => {
      const missionId = String(request.params.id);
      const mission = await dependencies.missions.get(missionId);
      if (mission.status !== 'AWAITING_BASE_APPROVAL') {
        throw new AppError({
          statusCode: 409,
          code: 'MISSION_NOT_AWAITING_BASE_APPROVAL',
          message: `Mission is not awaiting Base approval; found ${mission.status}`,
        });
      }
      const base = dependencies.basePayments;
      if (!base) {
        throw new AppError({
          statusCode: 503,
          code: 'BASE_INTEGRATION_UNAVAILABLE',
          message: 'Base settlement is not enabled',
        });
      }
      const plan = parseMissionPlan(mission, dependencies.runnerCaps);
      const action = plan.baseAction;
      const jobs = await dependencies.jobs.findByMissionId(missionId);
      const verifiedJob = [...jobs]
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .find((job) => object(job.verification)?.passed === true);
      const verificationId = object(verifiedJob?.verification)?.id;
      if (!action || !verifiedJob || typeof verificationId !== 'string') {
        throw new AppError({
          statusCode: 409,
          code: 'BASE_APPROVAL_INTENT_UNAVAILABLE',
          message: 'No verified durable Base settlement intent is available for approval',
        });
      }
      const approval = await dependencies.approvals.approve({
        missionId,
        kind: 'BASE_SETTLEMENT',
        actionId: `mission:${missionId}:base-success-settlement`,
        referenceId: verificationId,
        amount: action.amount,
        currency: base.supportedAsset,
      });
      const resumed = await dependencies.worker.resumeApproved(missionId, 'AWAITING_BASE_APPROVAL');
      response.status(202).json({
        success: true,
        data: {
          approval: {
            ...approval,
            network: base.network,
            chainId: base.chainId,
            recipient: base.paymentRecipient,
            maximumAmount: base.maximumPaymentAmount,
          },
          mission: resumed,
          execution: 'QUEUED',
        },
      });
    }),
  );
  return router;
}
