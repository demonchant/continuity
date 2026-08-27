import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { MissionService } from '../../src/missions/mission-service.js';
import { MissionWorker } from '../../src/runner/mission-worker.js';
import type { MissionWorkerRepository } from '../../src/runner/mission-worker-repository.js';
import type { MissionRunner } from '../../src/runner/mission-runner.js';
import { InMemoryMissionRepository } from '../support/in-memory-mission-repository.js';

class WorkerRepository implements MissionWorkerRepository {
  leaseAvailable = true;
  readonly audits: Parameters<MissionWorkerRepository['audit']>[0][] = [];
  readonly states = new Map<string, string>();
  acquireLease = vi.fn(() => Promise.resolve(this.leaseAvailable));
  heartbeat = vi.fn((missionId: string, state: string) => {
    this.states.set(missionId, state);
    return Promise.resolve();
  });
  reconciled = vi.fn((missionId: string, state: string) => {
    this.states.set(missionId, state);
    return Promise.resolve();
  });
  audit = vi.fn((input: Parameters<MissionWorkerRepository['audit']>[0]) => {
    this.audits.push(input);
    return Promise.resolve(`audit-${this.audits.length}`);
  });
}

const logger = pino({ level: 'silent' });

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  assertion();
}

describe('MissionWorker', () => {
  it('durably queues an HTTP-requested mission and executes it outside the request call', async () => {
    const missions = new MissionService(new InMemoryMissionRepository());
    const mission = await missions.create({
      objective: 'Research X',
      constraints: {},
      budget: '1',
    });
    const run = vi.fn().mockResolvedValue({});
    const repository = new WorkerRepository();
    const worker = new MissionWorker(
      missions,
      { run } as unknown as MissionRunner,
      repository,
      logger,
      { workerId: 'worker-test', pollIntervalMs: 1_000 },
    );
    const queued = await worker.enqueue(mission.id);
    expect(queued.status).toBe('QUEUED');
    await eventually(() => expect(run).toHaveBeenCalledWith(mission.id));
    expect(repository.audits).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'MISSION_ENQUEUED' })]),
    );
    await worker.stop();
  });

  it('reconciles non-terminal startup state before resuming', async () => {
    const missions = new MissionService(new InMemoryMissionRepository());
    let mission = await missions.create({ objective: 'Research X', constraints: {}, budget: '1' });
    mission = await missions.transition(mission.id, 'PLANNING');
    mission = await missions.transition(mission.id, 'SELECTING_AGENT');
    mission = await missions.transition(mission.id, 'EXECUTING');
    const run = vi.fn().mockResolvedValue({});
    const reconcile = vi.fn().mockResolvedValue({ safeToResume: true, details: { jobs: 1 } });
    const repository = new WorkerRepository();
    const worker = new MissionWorker(
      missions,
      { run } as unknown as MissionRunner,
      repository,
      logger,
      { workerId: 'worker-recovery', pollIntervalMs: 1_000, reconcile },
    );
    await worker.start();
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ status: 'RECOVERING' }));
    expect(run).toHaveBeenCalledWith(mission.id);
    expect(repository.audits).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'STARTUP_RECONCILIATION' })]),
    );
    await worker.stop();
  });

  it('does not resume when external reconciliation cannot prove the side effect', async () => {
    const missions = new MissionService(new InMemoryMissionRepository());
    let mission = await missions.create({ objective: 'Research X', constraints: {}, budget: '1' });
    mission = await missions.transition(mission.id, 'PLANNING');
    const run = vi.fn();
    const repository = new WorkerRepository();
    const worker = new MissionWorker(
      missions,
      { run } as unknown as MissionRunner,
      repository,
      logger,
      {
        workerId: 'worker-blocked',
        pollIntervalMs: 1_000,
        reconcile: () =>
          Promise.resolve({ safeToResume: false, failureReason: 'Broadcast outcome unknown' }),
      },
    );
    await worker.start();
    expect(run).not.toHaveBeenCalled();
    expect(repository.states.get(mission.id)).toBe('BLOCKED');
    await worker.stop();
  });

  it('refuses startup when another instance owns the durable lease', async () => {
    const missions = new MissionService(new InMemoryMissionRepository());
    const repository = new WorkerRepository();
    repository.leaseAvailable = false;
    const worker = new MissionWorker(
      missions,
      { run: vi.fn() } as unknown as MissionRunner,
      repository,
      logger,
    );
    await expect(worker.start()).rejects.toThrow('Another deployment instance owns');
  });
});
