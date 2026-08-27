import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { MemoryService } from '../../src/memory/memory-service.js';
import { PrismaMissionRepository } from '../../src/missions/prisma-mission-repository.js';
import { PrismaRecoveryRepository } from '../../src/recovery/prisma-recovery-repository.js';
import { RecoveryService } from '../../src/recovery/recovery-service.js';
import { MockMemoryProvider } from './mock-memory-provider.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');

const session = process.argv[2];
const missionIdArgument = process.argv[3];
const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const service = new RecoveryService(
  new PrismaRecoveryRepository(client),
  new MemoryService(new MockMemoryProvider(), pino({ level: 'silent' })),
  pino({ level: 'silent' }),
);

try {
  if (session === 'session-a') {
    const mission = await new PrismaMissionRepository(client).create({
      objective: 'Persist recovery across a backend restart',
      constraints: {},
      budget: '1.00',
    });
    await service.checkpoint({
      missionId: mission.id,
      mission: mission.objective,
      capability: 'fact-verification',
      missionState: 'EXECUTING',
      currentStep: 'submit-agent-job',
      selectedAgentId: 'agent-b',
      actionState: { actionId: 'agent-job', status: 'NOT_STARTED' },
      paymentState: { status: 'NOT_APPLICABLE' },
      verificationState: { status: 'NOT_STARTED' },
      recoveryInfo: { interrupted: false },
      nextAction: 'agent-job',
    });
    await service.executeCriticalAction(
      { missionId: mission.id, actionId: 'agent-job', kind: 'AGENT_EXECUTION' },
      () =>
        Promise.resolve({
          receipt: { jobId: 'job-db-1', status: 'completed' },
          providerReference: 'job-db-1',
        }),
    );
    await service.checkpoint({
      missionId: mission.id,
      mission: mission.objective,
      capability: 'fact-verification',
      missionState: 'VERIFYING',
      currentStep: 'verify-result',
      selectedAgentId: 'agent-b',
      actionState: { actionId: 'agent-job', status: 'COMPLETED' },
      paymentState: { status: 'NOT_APPLICABLE' },
      verificationState: { status: 'PENDING' },
      recoveryInfo: {
        interrupted: true,
        reason: 'Backend process stopped',
        resumeFrom: 'verify-result',
      },
      nextAction: 'verify-result',
    });
    console.log(JSON.stringify({ session, processId: process.pid, missionId: mission.id }));
  } else if (session === 'session-b' && missionIdArgument) {
    const plan = await service.recover(missionIdArgument);
    let duplicateSideEffectCalled = false;
    const duplicate = await service.executeCriticalAction(
      { missionId: missionIdArgument, actionId: 'agent-job', kind: 'AGENT_EXECUTION' },
      () => {
        duplicateSideEffectCalled = true;
        return Promise.reject(new Error('A completed action must not execute again'));
      },
    );
    let resumeCalled = false;
    await service.resume(missionIdArgument, () => {
      resumeCalled = true;
      return Promise.resolve();
    });
    console.log(
      JSON.stringify({
        session,
        processId: process.pid,
        checkpointState: plan.checkpoint.missionState,
        checkpointVersion: plan.checkpoint.version,
        whatAlreadyHappened: plan.whatAlreadyHappened,
        whatRemains: plan.whatRemains,
        mustNotRepeat: plan.mustNotRepeat,
        canSafelyResume: plan.canSafelyResume,
        duplicateDeduplicated: duplicate.deduplicated,
        duplicateReceipt: duplicate.receipt,
        duplicateSideEffectCalled,
        actionAttempts: duplicate.action.attempts,
        resumeCalled,
      }),
    );
  } else {
    throw new Error('Expected session-a or session-b with a mission id');
  }
} finally {
  await client.$disconnect();
}
