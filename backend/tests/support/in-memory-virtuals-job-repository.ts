import { randomUUID } from 'node:crypto';
import type { VirtualsJobRepository } from '../../src/integrations/virtuals/virtuals-job-repository.js';
import type {
  CreateVirtualsJobInput,
  UpdateVirtualsJobInput,
  VirtualsJob,
} from '../../src/integrations/virtuals/virtuals-job.js';

export class InMemoryVirtualsJobRepository implements VirtualsJobRepository {
  private readonly records = new Map<string, VirtualsJob>();

  createOrGet(input: CreateVirtualsJobInput): Promise<VirtualsJob> {
    const existing = [...this.records.values()].find(
      (job) => job.missionId === input.missionId && job.actionId === input.actionId,
    );
    if (existing) return Promise.resolve(existing);
    const now = new Date('2026-08-22T12:00:00.000Z');
    const job: VirtualsJob = {
      id: randomUUID(),
      ...input,
      state: 'CREATED',
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(job.id, job);
    return Promise.resolve(job);
  }

  findById(id: string): Promise<VirtualsJob | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }

  findByMissionId(missionId: string): Promise<readonly VirtualsJob[]> {
    return Promise.resolve([...this.records.values()].filter((job) => job.missionId === missionId));
  }

  findByMissionAndAction(missionId: string, actionId: string): Promise<VirtualsJob | null> {
    return Promise.resolve(
      [...this.records.values()].find(
        (job) => job.missionId === missionId && job.actionId === actionId,
      ) ?? null,
    );
  }

  update(input: UpdateVirtualsJobInput): Promise<VirtualsJob> {
    const current = this.records.get(input.id);
    if (!current) return Promise.reject(new Error(`Virtuals job not found: ${input.id}`));
    const terminal = ['COMPLETED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(input.state);
    const updated: VirtualsJob = {
      ...current,
      ...input,
      updatedAt: new Date('2026-08-22T12:01:00.000Z'),
      ...(terminal ? { completedAt: new Date('2026-08-22T12:01:00.000Z') } : {}),
    };
    this.records.set(input.id, updated);
    return Promise.resolve(updated);
  }
}
