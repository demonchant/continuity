import { Router } from 'express';
import { z } from 'zod';
import type { OperatorApprovalService } from '../approvals/operator-approval-service.js';
import type { DashboardService } from '../dashboard/dashboard-service.js';
import type { VirtualsExecutionService } from '../integrations/virtuals/virtuals-execution-service.js';
import type { VirtualsJobRepository } from '../integrations/virtuals/virtuals-job-repository.js';
import type { BasePaymentService } from '../integrations/base/base-payment-service.js';
import type { MissionService } from '../missions/mission-service.js';
import { createMissionRequestSchema, missionIdParamsSchema } from '../missions/mission-schemas.js';
import type { MissionWorker } from '../runner/mission-worker.js';
import { parseMissionPlan, type MissionPlanCaps } from '../runner/mission-plan.js';
import { AppError } from '../shared/errors/app-error.js';
import { asyncHandler } from '../shared/http/async-handler.js';
import { validateBody, validateParams } from '../shared/http/validation.js';
import { accessAuthenticated, accessPrincipal } from './access-http.js';
import type { AccessService } from './access-service.js';

const discoverySchema = z
  .object({ candidateLimit: z.number().int().min(1).max(20).default(5) })
  .strict();
const approvalSchema = z.object({ approved: z.literal(true) }).strict();
const memberInvitationSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(320)
      .transform((value) => value.toLowerCase()),
    role: z.enum(['OPERATOR', 'FINANCE_APPROVER', 'VIEWER']),
  })
  .strict();

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function createPortalRouter(dependencies: {
  readonly access: AccessService;
  readonly missions: MissionService;
  readonly dashboard: DashboardService;
  readonly virtuals?: VirtualsExecutionService;
  readonly jobs?: VirtualsJobRepository;
  readonly worker?: MissionWorker;
  readonly approvals?: OperatorApprovalService;
  readonly basePayments?: BasePaymentService;
  readonly runnerCaps?: MissionPlanCaps;
}): Router {
  const router = Router();
  router.use(accessAuthenticated(dependencies.access));

  router.get(
    '/overview',
    asyncHandler(async (_request, response) => {
      const principal = accessPrincipal(response);
      response.json({
        success: true,
        data: {
          principal,
          missions: await dependencies.missions.listForOrganization(principal.organizationId),
        },
      });
    }),
  );

  router.get(
    '/members',
    accessAuthenticated(dependencies.access, ['OWNER']),
    asyncHandler(async (_request, response) => {
      const principal = accessPrincipal(response);
      response.json({
        success: true,
        data: { members: await dependencies.access.listMembers(principal.organizationId) },
      });
    }),
  );

  router.post(
    '/members/invite',
    accessAuthenticated(dependencies.access, ['OWNER']),
    validateBody(memberInvitationSchema),
    asyncHandler(async (request, response) => {
      const principal = accessPrincipal(response);
      const body = request.body as z.infer<typeof memberInvitationSchema>;
      response.status(201).json({
        success: true,
        data: await dependencies.access.inviteMember({
          organizationId: principal.organizationId,
          email: body.email,
          role: body.role,
        }),
      });
    }),
  );

  router.post(
    '/missions',
    accessAuthenticated(dependencies.access, ['OWNER', 'OPERATOR', 'JUDGE']),
    validateBody(createMissionRequestSchema),
    asyncHandler(async (request, response) => {
      const principal = accessPrincipal(response);
      const body = request.body as z.infer<typeof createMissionRequestSchema>;
      const budget = Number(body.budget);
      if (budget > Number(principal.maximumMissionBudget)) {
        throw new AppError({
          statusCode: 422,
          code: 'WORKSPACE_BUDGET_EXCEEDED',
          message: 'Mission budget exceeds this workspace policy',
        });
      }
      const mission = await dependencies.missions.create({
        ...body,
        organizationId: principal.organizationId,
      });
      response.status(201).json({ success: true, data: { mission } });
    }),
  );

  router.get(
    '/missions/:id',
    validateParams(missionIdParamsSchema),
    asyncHandler(async (request, response) => {
      const principal = accessPrincipal(response);
      await dependencies.missions.getForOrganization(
        String(request.params.id),
        principal.organizationId,
      );
      response.json({
        success: true,
        data: await dependencies.dashboard.missionDetail(String(request.params.id)),
      });
    }),
  );

  router.post(
    '/missions/:id/discover',
    accessAuthenticated(dependencies.access, ['OWNER', 'OPERATOR', 'VIEWER', 'JUDGE']),
    validateParams(missionIdParamsSchema),
    validateBody(discoverySchema),
    asyncHandler(async (request, response) => {
      if (!dependencies.virtuals)
        throw new AppError({
          statusCode: 503,
          code: 'VIRTUALS_UNAVAILABLE',
          message: 'Virtuals discovery is unavailable',
        });
      const principal = accessPrincipal(response);
      const mission = await dependencies.missions.getForOrganization(
        String(request.params.id),
        principal.organizationId,
      );
      const capabilities = Array.isArray(mission.constraints.capabilities)
        ? mission.constraints.capabilities.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const body = request.body as z.infer<typeof discoverySchema>;
      response.json({
        success: true,
        data: await dependencies.virtuals.preview(mission, capabilities, body.candidateLimit),
      });
    }),
  );

  router.post(
    '/missions/:id/run',
    accessAuthenticated(dependencies.access, ['OWNER', 'OPERATOR']),
    validateParams(missionIdParamsSchema),
    asyncHandler(async (request, response) => {
      const principal = accessPrincipal(response);
      if (principal.organizationMode === 'JUDGE' || !principal.spendingEnabled) {
        throw new AppError({
          statusCode: 403,
          code: 'WORKSPACE_SPENDING_DISABLED',
          message: 'Paid execution is disabled for this workspace',
        });
      }
      if (!dependencies.worker)
        throw new AppError({
          statusCode: 503,
          code: 'RUNNER_UNAVAILABLE',
          message: 'Mission execution is unavailable',
        });
      const mission = await dependencies.missions.getForOrganization(
        String(request.params.id),
        principal.organizationId,
      );
      response
        .status(202)
        .json({ success: true, data: { mission: await dependencies.worker.enqueue(mission.id) } });
    }),
  );

  router.post(
    '/missions/:id/approve-acp-spend',
    accessAuthenticated(dependencies.access, ['OWNER', 'FINANCE_APPROVER']),
    validateParams(missionIdParamsSchema),
    validateBody(approvalSchema),
    asyncHandler(async (request, response) => {
      const principal = accessPrincipal(response);
      if (
        !principal.spendingEnabled ||
        !dependencies.jobs ||
        !dependencies.approvals ||
        !dependencies.worker
      ) {
        throw new AppError({
          statusCode: 403,
          code: 'WORKSPACE_SPENDING_DISABLED',
          message: 'Financial approval is unavailable for this workspace',
        });
      }
      const mission = await dependencies.missions.getForOrganization(
        String(request.params.id),
        principal.organizationId,
      );
      if (mission.status !== 'AWAITING_FUNDING_APPROVAL')
        throw new AppError({
          statusCode: 409,
          code: 'MISSION_NOT_AWAITING_FUNDING_APPROVAL',
          message: 'Mission is not awaiting ACP funding approval',
        });
      const jobs = await dependencies.jobs.findByMissionId(mission.id);
      const job = [...jobs]
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .find(({ state }) => state === 'AWAITING_FUNDING_APPROVAL');
      const proposed = object(object(job?.lifecycle)?.proposedBudget);
      const amount = typeof proposed?.amount === 'string' ? proposed.amount : undefined;
      const currency = typeof proposed?.currency === 'string' ? proposed.currency : undefined;
      if (!job || !amount || !currency)
        throw new AppError({
          statusCode: 409,
          code: 'ACP_APPROVAL_INTENT_UNAVAILABLE',
          message: 'No durable ACP proposal is available',
        });
      if (
        currency.toUpperCase() !== 'USDC' ||
        Number(amount) > Number(principal.maximumAcpJobUsdc)
      ) {
        throw new AppError({
          statusCode: 422,
          code: 'WORKSPACE_ACP_LIMIT_EXCEEDED',
          message: 'ACP proposal exceeds this workspace policy',
        });
      }
      const approval = await dependencies.approvals.approve({
        missionId: mission.id,
        kind: 'ACP_FUNDING',
        actionId: `${job.actionId}:fund`,
        referenceId: job.externalJobId,
        amount,
        currency,
      });
      await dependencies.worker.resumeApproved(mission.id, 'AWAITING_FUNDING_APPROVAL');
      response.status(202).json({
        success: true,
        data: { approval: { ...approval, authorization: 'ONE_TIME', recurring: false } },
      });
    }),
  );

  router.post(
    '/missions/:id/approve-base-settlement',
    accessAuthenticated(dependencies.access, ['OWNER', 'FINANCE_APPROVER']),
    validateParams(missionIdParamsSchema),
    validateBody(approvalSchema),
    asyncHandler(async (request, response) => {
      const principal = accessPrincipal(response);
      const base = dependencies.basePayments;
      if (
        !principal.spendingEnabled ||
        !base ||
        !dependencies.jobs ||
        !dependencies.approvals ||
        !dependencies.worker ||
        !dependencies.runnerCaps
      ) {
        throw new AppError({
          statusCode: 403,
          code: 'WORKSPACE_SPENDING_DISABLED',
          message: 'Base approval is unavailable for this workspace',
        });
      }
      const mission = await dependencies.missions.getForOrganization(
        String(request.params.id),
        principal.organizationId,
      );
      if (mission.status !== 'AWAITING_BASE_APPROVAL')
        throw new AppError({
          statusCode: 409,
          code: 'MISSION_NOT_AWAITING_BASE_APPROVAL',
          message: 'Mission is not awaiting Base approval',
        });
      const plan = parseMissionPlan(mission, dependencies.runnerCaps);
      const jobs = await dependencies.jobs.findByMissionId(mission.id);
      const verifiedJob = [...jobs]
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .find((job) => object(job.verification)?.passed === true);
      const verificationId = object(verifiedJob?.verification)?.id;
      if (!plan.baseAction || !verifiedJob || typeof verificationId !== 'string')
        throw new AppError({
          statusCode: 409,
          code: 'BASE_APPROVAL_INTENT_UNAVAILABLE',
          message: 'No verified Base settlement intent is available',
        });
      const approval = await dependencies.approvals.approve({
        missionId: mission.id,
        kind: 'BASE_SETTLEMENT',
        actionId: `mission:${mission.id}:base-success-settlement`,
        referenceId: verificationId,
        amount: plan.baseAction.amount,
        currency: base.supportedAsset,
      });
      await dependencies.worker.resumeApproved(mission.id, 'AWAITING_BASE_APPROVAL');
      response.status(202).json({
        success: true,
        data: {
          approval: {
            ...approval,
            authorization: 'ONE_TIME',
            recurring: false,
            network: base.network,
            recipient: base.paymentRecipient,
          },
        },
      });
    }),
  );
  return router;
}
