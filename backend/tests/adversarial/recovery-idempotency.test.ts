import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { MemoryService } from '../../src/memory/memory-service.js';
import type { RecoveryRepository } from '../../src/recovery/recovery-repository.js';
import { RecoveryService } from '../../src/recovery/recovery-service.js';
import { InMemoryRecoveryRepository } from '../support/in-memory-recovery-repository.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const logger = pino({ level: 'silent' });
const missionId = '00000000-0000-4000-8000-000000001702';

function service(repository: RecoveryRepository): RecoveryService {
  return new RecoveryService(
    repository,
    new MemoryService(new MockMemoryProvider(), logger),
    logger,
  );
}

describe('Phase 17 hostile recovery and idempotency', () => {
  it('allows only one concurrent mission action side effect', async () => {
    const recovery = service(new InMemoryRecoveryRepository());
    let release!: (value: { receipt: { jobId: string }; providerReference: string }) => void;
    const effect = vi.fn(
      () =>
        new Promise<{ receipt: { jobId: string }; providerReference: string }>((resolve) => {
          release = resolve;
        }),
    );
    const input = { missionId, actionId: 'execute-agent', kind: 'VIRTUALS_CREATE_JOB' } as const;
    const first = recovery.executeCriticalAction(input, effect);
    await vi.waitFor(() => expect(effect).toHaveBeenCalledOnce());

    await expect(recovery.executeCriticalAction(input, effect)).rejects.toMatchObject({
      code: 'ACTION_RECONCILIATION_REQUIRED',
    });
    release({ receipt: { jobId: 'job-17' }, providerReference: 'job-17' });
    await expect(first).resolves.toMatchObject({ deduplicated: false });
    await expect(recovery.executeCriticalAction(input, effect)).resolves.toMatchObject({
      deduplicated: true,
      receipt: { jobId: 'job-17' },
    });
    expect(effect).toHaveBeenCalledOnce();
  });

  it('rejects conflicting reuse of action and payment idempotency keys', async () => {
    const recovery = service(new InMemoryRecoveryRepository());
    const effect = vi.fn().mockResolvedValue({
      receipt: { transactionHash: '0xabc' },
      providerReference: '0xabc',
    });
    await recovery.executeCriticalAction(
      { missionId, actionId: 'pay-agent', paymentId: 'payment-17', kind: 'BASE_PAYMENT' },
      effect,
    );

    await expect(
      recovery.executeCriticalAction(
        { missionId, actionId: 'pay-agent', paymentId: 'payment-other', kind: 'BASE_PAYMENT' },
        effect,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
    await expect(
      recovery.executeCriticalAction(
        {
          missionId: '00000000-0000-4000-8000-000000001799',
          actionId: 'different-action',
          paymentId: 'payment-17',
          kind: 'BASE_PAYMENT',
        },
        effect,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
    expect(effect).toHaveBeenCalledOnce();
  });

  it('blocks a restarted process while an earlier action remains in progress', async () => {
    const repository = new InMemoryRecoveryRepository();
    const firstProcess = service(repository);
    await firstProcess.checkpoint({
      missionId,
      mission: 'Research and verify X',
      capability: 'fact-verification',
      missionState: 'RECOVERING',
      currentStep: 'reconcile-agent-job',
      actionState: { actionId: 'execute-agent', status: 'IN_PROGRESS' },
      paymentState: { status: 'NOT_APPLICABLE' },
      verificationState: { status: 'NOT_STARTED' },
      recoveryInfo: { interrupted: true, reason: 'server restart' },
      nextAction: 'reconcile-agent-job',
    });
    const claim = await repository.claimAction({
      missionId,
      actionId: 'execute-agent',
      kind: 'VIRTUALS_CREATE_JOB',
    });
    await repository.beginAction(claim.action.id);

    const restarted = service(repository);
    await expect(restarted.recover(missionId)).resolves.toMatchObject({
      canSafelyResume: false,
      mustNotRepeat: ['action:execute-agent'],
      blockingReason: expect.stringContaining('Reconcile ambiguous actions'),
    });
    await expect(restarted.resume(missionId, vi.fn())).rejects.toMatchObject({
      code: 'MISSION_RESUME_BLOCKED',
    });
  });

  it('rejects corrupted checkpoint and completed-action records', async () => {
    const corruptCheckpointRepository = {
      findCheckpoint: () =>
        Promise.resolve({
          missionId,
          missionState: 'EXECUTED_TWICE',
          currentStep: '',
          actionState: { status: 'BROKEN' },
          paymentState: { status: 'BROKEN' },
          verificationState: { status: 'BROKEN' },
          recoveryInfo: { interrupted: 'yes' },
          nextAction: '',
          version: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      listActions: () => Promise.resolve([]),
    } as unknown as RecoveryRepository;
    await expect(service(corruptCheckpointRepository).recover(missionId)).rejects.toMatchObject({
      code: 'RECOVERY_STATE_CORRUPT',
    });

    const repository = new InMemoryRecoveryRepository();
    await service(repository).checkpoint({
      missionId,
      mission: 'Mission',
      capability: 'research',
      missionState: 'RECOVERING',
      currentStep: 'recovering',
      actionState: { status: 'COMPLETED' },
      paymentState: { status: 'NOT_APPLICABLE' },
      verificationState: { status: 'NOT_STARTED' },
      recoveryInfo: { interrupted: true },
      nextAction: 'verify',
    });
    const corruptActionRepository = {
      ...repository,
      findCheckpoint: repository.findCheckpoint.bind(repository),
      listActions: () =>
        Promise.resolve([
          {
            id: 'corrupt-action',
            missionId,
            actionId: 'completed-without-receipt',
            kind: 'BASE_PAYMENT',
            status: 'COMPLETED',
            attempts: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
    } as unknown as RecoveryRepository;
    await expect(service(corruptActionRepository).recover(missionId)).rejects.toMatchObject({
      code: 'RECOVERY_STATE_CORRUPT',
    });
  });
});
