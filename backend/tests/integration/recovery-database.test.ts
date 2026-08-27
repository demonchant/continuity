import { PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const workerPath = new URL('../support/recovery-process-worker.ts', import.meta.url);

interface SessionAResult {
  session: string;
  processId: number;
  missionId: string;
}

interface SessionBResult {
  session: string;
  processId: number;
  checkpointState: string;
  checkpointVersion: number;
  whatAlreadyHappened: string[];
  whatRemains: string[];
  mustNotRepeat: string[];
  canSafelyResume: boolean;
  duplicateDeduplicated: boolean;
  duplicateReceipt: { jobId: string; status: string };
  duplicateSideEffectCalled: boolean;
  actionAttempts: number;
  resumeCalled: boolean;
}

async function runSession<T>(session: string, missionId?: string): Promise<T> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(workerPath), session, ...(missionId ? [missionId] : [])],
    {
      env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
      windowsHide: true,
    },
  );
  return JSON.parse(stdout.trim()) as T;
}

describeWithDatabase('Prisma recovery restart and idempotency', () => {
  const cleanupClient = databaseUrl
    ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    : undefined;

  beforeEach(async () => {
    if (!cleanupClient) throw new Error('TEST_DATABASE_URL is required for this test');
    await cleanupClient.recoveryAction.deleteMany();
    await cleanupClient.missionCheckpoint.deleteMany();
    await cleanupClient.missionTransition.deleteMany();
    await cleanupClient.mission.deleteMany();
  });

  afterAll(async () => {
    await cleanupClient?.$disconnect();
  });

  it('recovers in a new OS process and returns the prior action receipt', async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for this test');
    const sessionA = await runSession<SessionAResult>('session-a');
    const sessionB = await runSession<SessionBResult>('session-b', sessionA.missionId);

    expect(sessionB.processId).not.toBe(sessionA.processId);
    expect(sessionB).toMatchObject({
      checkpointState: 'VERIFYING',
      checkpointVersion: 2,
      whatAlreadyHappened: ['agent-job completed as job-db-1'],
      whatRemains: ['verify-result'],
      mustNotRepeat: ['action:agent-job'],
      canSafelyResume: true,
      duplicateDeduplicated: true,
      duplicateReceipt: { jobId: 'job-db-1', status: 'completed' },
      duplicateSideEffectCalled: false,
      actionAttempts: 1,
      resumeCalled: true,
    });
  });
});
