import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { OperatorApprovalService } from '../../src/approvals/operator-approval-service.js';
import type { BasePaymentService } from '../../src/integrations/base/base-payment-service.js';
import type { VirtualsExecutionService } from '../../src/integrations/virtuals/virtuals-execution-service.js';
import type { VirtualsJobRepository } from '../../src/integrations/virtuals/virtuals-job-repository.js';
import type { MissionService } from '../../src/missions/mission-service.js';
import type { MissionWorker } from '../../src/runner/mission-worker.js';
import { createMissionRunnerRouter } from '../../src/runner/mission-runner-routes.js';
import { createErrorHandler } from '../../src/api/middleware/error-handler.js';
import { InMemoryOperatorApprovalRepository } from '../support/in-memory-operator-approval-repository.js';

const logger = pino({ level: 'silent' });
const missionId = '00000000-0000-4000-8000-000000000077';

function application(baseApproval = false) {
  const repository = new InMemoryOperatorApprovalRepository();
  const approvals = new OperatorApprovalService(repository);
  const resumeApproved = vi.fn().mockResolvedValue({ id: missionId, status: 'QUEUED' });
  const worker = { workerId: 'test-worker', resumeApproved } as unknown as MissionWorker;
  const missions = {
    get: vi.fn().mockResolvedValue({
      id: missionId,
      objective: 'Research a real question',
      constraints: baseApproval
        ? {
            capabilities: ['research'],
            requireBaseAction: true,
            baseAction: {
              required: true,
              purpose: 'MISSION_SUCCESS_SETTLEMENT',
              amount: '0.0001',
              asset: 'ETH',
            },
          }
        : { capabilities: ['research'] },
      budget: '1.00',
      status: baseApproval ? 'AWAITING_BASE_APPROVAL' : 'AWAITING_FUNDING_APPROVAL',
    }),
  } as unknown as MissionService;
  const jobs = {
    findByMissionId: vi.fn().mockResolvedValue([
      {
        id: 'continuity-job',
        missionId,
        actionId: `mission:${missionId}:agent-attempt:1`,
        externalJobId: 'real-acp-job',
        state: baseApproval ? 'COMPLETED' : 'AWAITING_FUNDING_APPROVAL',
        verification: baseApproval ? { id: 'verification-77', passed: true } : undefined,
        lifecycle: baseApproval
          ? { observedStates: ['CREATED', 'SUBMITTED', 'COMPLETED'] }
          : { proposedBudget: { amount: '0.25', currency: 'USDC' } },
        updatedAt: new Date(),
      },
    ]),
  } as unknown as VirtualsJobRepository;
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/missions',
    createMissionRunnerRouter({
      worker,
      missions,
      jobs,
      virtuals: { maximumJobUsdc: 1 } as unknown as VirtualsExecutionService,
      approvals,
      ...(baseApproval
        ? {
            basePayments: {
              supportedAsset: 'ETH',
              network: 'base',
              chainId: 8453,
              paymentRecipient: '0x2222222222222222222222222222222222222222',
              maximumPaymentAmount: '0.001',
            } as unknown as BasePaymentService,
          }
        : {}),
      runnerCaps: {
        maximumRetries: 0,
        timeoutMs: 900_000,
        failureThreshold: 1,
        candidateLimit: 10,
      },
      operatorToken: 'central-operator-token',
    }),
  );
  app.use(createErrorHandler(logger));
  return { app, repository, resumeApproved };
}

describe('mission financial approval API', () => {
  it('requires the central operator token and an explicit true approval', async () => {
    const { app } = application();
    await request(app)
      .post(`/api/v1/missions/${missionId}/approve-acp-spend`)
      .send({ approved: true })
      .expect(401);
    await request(app)
      .post(`/api/v1/missions/${missionId}/approve-acp-spend`)
      .set('authorization', 'Bearer central-operator-token')
      .send({ approved: false })
      .expect(400);
  });

  it('persists the exact ACP proposal before resuming the mission', async () => {
    const { app, repository, resumeApproved } = application();
    await request(app)
      .post(`/api/v1/missions/${missionId}/approve-acp-spend`)
      .set('authorization', 'Bearer central-operator-token')
      .send({ approved: true })
      .expect(202);
    expect(repository.approvals).toEqual([
      expect.objectContaining({
        missionId,
        kind: 'ACP_FUNDING',
        referenceId: 'real-acp-job',
        amount: '0.25',
        currency: 'USDC',
        status: 'APPROVED',
      }),
    ]);
    expect(resumeApproved).toHaveBeenCalledWith(missionId, 'AWAITING_FUNDING_APPROVAL');
  });

  it('persists a distinct exact Base intent only after verified ACP success', async () => {
    const { app, repository, resumeApproved } = application(true);
    const response = await request(app)
      .post(`/api/v1/missions/${missionId}/approve-base-settlement`)
      .set('authorization', 'Bearer central-operator-token')
      .send({ approved: true })
      .expect(202);
    expect(response.body.data.approval).toMatchObject({
      kind: 'BASE_SETTLEMENT',
      referenceId: 'verification-77',
      amount: '0.0001',
      currency: 'ETH',
      network: 'base',
      chainId: 8453,
      maximumAmount: '0.001',
    });
    expect(repository.approvals).toEqual([
      expect.objectContaining({ kind: 'BASE_SETTLEMENT', status: 'APPROVED' }),
    ]);
    expect(resumeApproved).toHaveBeenCalledWith(missionId, 'AWAITING_BASE_APPROVAL');
  });
});
