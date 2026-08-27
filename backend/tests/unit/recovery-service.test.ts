import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { MemoryService } from '../../src/memory/memory-service.js';
import { RecoveryService } from '../../src/recovery/recovery-service.js';
import { InMemoryRecoveryRepository } from '../support/in-memory-recovery-repository.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const missionId = '00000000-0000-4000-8000-000000000008';
const logger = pino({ level: 'silent' });

function memory(provider: MockMemoryProvider, id: string) {
  return new MemoryService(provider, logger, {
    id: () => id,
    now: () => new Date('2026-08-21T12:00:00.000Z'),
  });
}

function checkpoint(
  service: RecoveryService,
  input: {
    state: 'EXECUTING' | 'VERIFYING' | 'RECOVERING';
    step: string;
    actionStatus: 'NOT_STARTED' | 'COMPLETED' | 'UNCERTAIN';
    paymentStatus?: 'NOT_APPLICABLE' | 'COMPLETED';
    verificationStatus: 'NOT_STARTED' | 'PENDING';
    nextAction: string;
    interrupted?: boolean;
  },
) {
  return service.checkpoint({
    missionId,
    mission: 'Research and verify information about X',
    capability: 'fact-verification',
    missionState: input.state,
    currentStep: input.step,
    selectedAgentId: 'agent-b',
    actionState: { actionId: 'execute-agent-job', status: input.actionStatus },
    paymentState: {
      paymentId: 'payment-mission-8',
      status: input.paymentStatus ?? 'NOT_APPLICABLE',
    },
    verificationState: { status: input.verificationStatus },
    recoveryInfo: {
      interrupted: input.interrupted ?? false,
      ...(input.interrupted
        ? { reason: 'Backend process stopped', resumeFrom: input.nextAction }
        : {}),
    },
    nextAction: input.nextAction,
  });
}

describe('RecoveryService', () => {
  it('recovers an interrupted mission after restart without repeating its completed action', async () => {
    const repository = new InMemoryRecoveryRepository();
    const provider = new MockMemoryProvider();
    const firstProcess = new RecoveryService(
      repository,
      memory(provider, 'checkpoint-process-1'),
      logger,
    );
    const sideEffect = vi.fn().mockResolvedValue({
      receipt: { jobId: 'virtual-job-8', status: 'completed' },
      providerReference: 'virtual-job-8',
    });

    await checkpoint(firstProcess, {
      state: 'EXECUTING',
      step: 'submit-agent-job',
      actionStatus: 'NOT_STARTED',
      verificationStatus: 'NOT_STARTED',
      nextAction: 'execute-agent-job',
    });
    const execution = await firstProcess.executeCriticalAction(
      {
        missionId,
        actionId: 'execute-agent-job',
        kind: 'AGENT_EXECUTION',
      },
      sideEffect,
    );
    expect(execution.deduplicated).toBe(false);
    await checkpoint(firstProcess, {
      state: 'VERIFYING',
      step: 'verify-agent-result',
      actionStatus: 'COMPLETED',
      verificationStatus: 'PENDING',
      nextAction: 'verify-agent-result',
      interrupted: true,
    });

    // A new service instance represents a backend restart. Only the durable
    // repository and Sibyl provider survive from the first process.
    const restarted = new RecoveryService(
      repository,
      memory(provider, 'checkpoint-process-2'),
      logger,
    );
    const plan = await restarted.recover(missionId);

    expect(plan).toMatchObject({
      checkpoint: {
        missionState: 'VERIFYING',
        currentStep: 'verify-agent-result',
        selectedAgentId: 'agent-b',
        actionState: { actionId: 'execute-agent-job', status: 'COMPLETED' },
        paymentState: { paymentId: 'payment-mission-8', status: 'NOT_APPLICABLE' },
        verificationState: { status: 'PENDING' },
        recoveryInfo: { interrupted: true, resumeFrom: 'verify-agent-result' },
        version: 2,
      },
      whatAlreadyHappened: ['execute-agent-job completed as virtual-job-8'],
      whatRemains: ['verify-agent-result'],
      mustNotRepeat: ['action:execute-agent-job'],
      canSafelyResume: true,
      nextAction: 'verify-agent-result',
    });

    const duplicate = await restarted.executeCriticalAction(
      {
        missionId,
        actionId: 'execute-agent-job',
        kind: 'AGENT_EXECUTION',
      },
      sideEffect,
    );
    expect(duplicate).toMatchObject({
      deduplicated: true,
      receipt: { jobId: 'virtual-job-8', status: 'completed' },
    });
    const resumed = vi.fn().mockResolvedValue('verification-resumed');
    await expect(restarted.resume(missionId, resumed)).resolves.toBe('verification-resumed');
    expect(resumed).toHaveBeenCalledWith(
      expect.objectContaining({ nextAction: 'verify-agent-result' }),
    );
    expect(sideEffect).toHaveBeenCalledTimes(1);
    expect(provider.checkpoints).toHaveLength(2);
    expect(provider.checkpoints[1]).toMatchObject({
      state: expect.stringContaining('"missionState":"VERIFYING"'),
      nextAction: 'verify-agent-result',
    });
  });

  it('deduplicates payment requests by paymentId even when the retry actionId changes', async () => {
    const repository = new InMemoryRecoveryRepository();
    const provider = new MockMemoryProvider();
    const service = new RecoveryService(repository, memory(provider, 'payment'), logger);
    const payment = vi.fn().mockResolvedValue({
      receipt: { transactionHash: '0xabc', status: 'confirmed' },
      providerReference: '0xabc',
    });

    const first = await service.executeCriticalAction(
      {
        missionId,
        actionId: 'pay-agent-attempt-1',
        paymentId: 'payment-mission-8',
        kind: 'BASE_PAYMENT',
      },
      payment,
    );
    const duplicate = await service.executeCriticalAction(
      {
        missionId,
        actionId: 'pay-agent-retry-with-new-action-id',
        paymentId: 'payment-mission-8',
        kind: 'BASE_PAYMENT',
      },
      payment,
    );

    expect(first.deduplicated).toBe(false);
    expect(duplicate).toMatchObject({
      deduplicated: true,
      action: { actionId: 'pay-agent-attempt-1', paymentId: 'payment-mission-8' },
      receipt: { transactionHash: '0xabc' },
    });
    expect(payment).toHaveBeenCalledTimes(1);
  });

  it('blocks unsafe resume until an uncertain action is reconciled', async () => {
    const repository = new InMemoryRecoveryRepository();
    const provider = new MockMemoryProvider();
    const service = new RecoveryService(repository, memory(provider, 'uncertain'), logger);
    await checkpoint(service, {
      state: 'RECOVERING',
      step: 'reconcile-agent-job',
      actionStatus: 'UNCERTAIN',
      verificationStatus: 'NOT_STARTED',
      nextAction: 'reconcile-agent-job',
      interrupted: true,
    });
    const possiblyExecuted = vi.fn().mockRejectedValue(new Error('connection closed after submit'));

    await expect(
      service.executeCriticalAction(
        { missionId, actionId: 'execute-agent-job', kind: 'AGENT_EXECUTION' },
        possiblyExecuted,
      ),
    ).rejects.toMatchObject({ code: 'ACTION_OUTCOME_UNCERTAIN' });
    const blocked = await service.recover(missionId);
    expect(blocked).toMatchObject({
      canSafelyResume: false,
      mustNotRepeat: ['action:execute-agent-job'],
      blockingReason: expect.stringContaining('Reconcile ambiguous actions'),
    });
    await expect(service.resume(missionId, vi.fn())).rejects.toMatchObject({
      code: 'MISSION_RESUME_BLOCKED',
    });

    const reconciled = await service.reconcileAction(missionId, 'execute-agent-job', () =>
      Promise.resolve({
        status: 'COMPLETED',
        receipt: { jobId: 'virtual-job-after-query', status: 'completed' },
        providerReference: 'virtual-job-after-query',
      }),
    );
    expect(reconciled.status).toBe('COMPLETED');
    expect((await service.recover(missionId)).canSafelyResume).toBe(true);
    expect(possiblyExecuted).toHaveBeenCalledTimes(1);
  });
});
