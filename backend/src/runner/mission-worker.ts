import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { JsonObject, Mission } from '../missions/mission.js';
import type { MissionService } from '../missions/mission-service.js';
import type { MissionRunner } from './mission-runner.js';
import type { MissionWorkerRepository } from './mission-worker-repository.js';

export interface MissionReconciliationResult {
  readonly safeToResume: boolean;
  readonly details?: JsonObject;
  readonly failureReason?: string;
}

export interface MissionWorkerOptions {
  readonly pollIntervalMs?: number;
  readonly leaseMs?: number;
  readonly workerId?: string;
  readonly reconcile?: (mission: Mission) => Promise<MissionReconciliationResult>;
}

export class MissionWorker {
  readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseMs: number;
  private readonly reconcile:
    ((mission: Mission) => Promise<MissionReconciliationResult>) | undefined;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopping = false;
  private startupRecoveryPending = true;
  private attempts = new Map<string, number>();

  constructor(
    private readonly missions: MissionService,
    private readonly runner: MissionRunner,
    private readonly repository: MissionWorkerRepository,
    private readonly logger: Logger,
    options: MissionWorkerOptions = {},
  ) {
    this.workerId = options.workerId ?? `worker-${process.pid}-${randomUUID()}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.leaseMs = options.leaseMs ?? Math.max(10_000, this.pollIntervalMs * 4);
    this.reconcile = options.reconcile;
  }

  async enqueue(missionId: string): Promise<Mission> {
    const mission = await this.missions.get(missionId);
    if (mission.status === 'QUEUED') return mission;
    if (mission.status !== 'CREATED')
      throw new Error(`Mission cannot be queued from ${mission.status}`);
    const queued = await this.missions.transition(
      missionId,
      'QUEUED',
      'Durably queued for the singleton mission worker',
    );
    await this.repository.audit({
      missionId,
      workerId: this.workerId,
      action: 'MISSION_ENQUEUED',
      status: 'QUEUED',
      attempt: 0,
    });
    void this.tick();
    return queued;
  }

  async start(): Promise<void> {
    if (this.timer || this.stopping) throw new Error('Mission worker cannot be started twice');
    const acquired = await this.repository.acquireLease(this.workerId, this.leaseMs);
    if (!acquired) throw new Error('Another deployment instance owns the mission worker lease');
    this.logger.info(
      { event: 'mission.worker.started', workerId: this.workerId },
      'Mission worker started',
    );
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 25));
    this.logger.info(
      { event: 'mission.worker.stopped', workerId: this.workerId },
      'Mission worker stopped',
    );
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      if (!(await this.repository.acquireLease(this.workerId, this.leaseMs))) {
        this.logger.error({ event: 'mission.worker.lease_lost' }, 'Mission worker lease was lost');
        this.stopping = true;
        return;
      }
      const missions = await this.missions.list();
      if (this.startupRecoveryPending) {
        this.startupRecoveryPending = false;
        for (const mission of missions.filter(({ status }) =>
          ['PLANNING', 'SELECTING_AGENT', 'EXECUTING', 'VERIFYING', 'RECOVERING'].includes(status),
        )) {
          await this.recoverMission(mission);
        }
      }
      const queued = (await this.missions.list())
        .filter(({ status }) => status === 'QUEUED')
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
      if (queued) await this.execute(queued);
    } catch (error) {
      this.logger.error(
        { err: error, event: 'mission.worker.tick_failed' },
        'Mission worker tick failed',
      );
    } finally {
      this.running = false;
    }
  }

  private async recoverMission(input: Mission): Promise<void> {
    let mission = input;
    if (mission.status !== 'RECOVERING') {
      mission = await this.missions.transition(
        mission.id,
        'RECOVERING',
        'Backend restarted with a non-terminal durable mission',
      );
    }
    const attempt = (this.attempts.get(mission.id) ?? 0) + 1;
    this.attempts.set(mission.id, attempt);
    await this.repository.heartbeat(mission.id, 'RECONCILING');
    const result = this.reconcile
      ? await this.reconcile(mission)
      : { safeToResume: false, failureReason: 'No production reconciler is configured.' };
    const auditId = await this.repository.audit({
      missionId: mission.id,
      workerId: this.workerId,
      action: 'STARTUP_RECONCILIATION',
      status: result.safeToResume ? 'RESUMABLE' : 'BLOCKED',
      attempt,
      ...(result.details ? { details: result.details } : {}),
    });
    await this.repository.reconciled(
      mission.id,
      result.safeToResume ? 'RESUMING' : 'BLOCKED',
      result.failureReason,
    );
    this.logger.info(
      { event: 'mission.worker.reconciled', missionId: mission.id, auditId, ...result },
      'Startup mission reconciliation completed',
    );
    if (result.safeToResume) await this.execute(mission);
  }

  private async execute(mission: Mission): Promise<void> {
    await this.repository.heartbeat(mission.id, 'RUNNING');
    const attempt = (this.attempts.get(mission.id) ?? 0) + 1;
    this.attempts.set(mission.id, attempt);
    try {
      await this.runner.run(mission.id);
      await this.repository.reconciled(mission.id, 'COMPLETED');
      await this.repository.audit({
        missionId: mission.id,
        workerId: this.workerId,
        action: 'MISSION_EXECUTION',
        status: 'COMPLETED',
        attempt,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown worker execution failure';
      await this.repository.reconciled(mission.id, 'FAILED', reason);
      await this.repository.audit({
        missionId: mission.id,
        workerId: this.workerId,
        action: 'MISSION_EXECUTION',
        status: 'FAILED',
        attempt,
        details: { reason },
      });
      this.logger.error(
        { err: error, event: 'mission.worker.execution_failed', missionId: mission.id },
        'Mission worker execution failed',
      );
    }
  }
}
