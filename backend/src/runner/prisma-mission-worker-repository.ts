import { Prisma, type PrismaClient } from '@prisma/client';
import type { MissionWorkerRepository } from './mission-worker-repository.js';

const leaseId = 'continuity-mission-worker';

export class PrismaMissionWorkerRepository implements MissionWorkerRepository {
  constructor(private readonly client: PrismaClient) {}

  async acquireLease(workerId: string, leaseMs: number): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + leaseMs);
    try {
      await this.client.missionWorkerLease.create({
        data: { id: leaseId, ownerId: workerId, expiresAt },
      });
      return true;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
    }
    const claimed = await this.client.missionWorkerLease.updateMany({
      where: {
        id: leaseId,
        OR: [{ ownerId: workerId }, { expiresAt: { lte: now } }],
      },
      data: { ownerId: workerId, expiresAt },
    });
    return claimed.count === 1;
  }

  async heartbeat(missionId: string, recoveryState: string): Promise<void> {
    await this.client.mission.update({
      where: { id: missionId },
      data: { lastHeartbeat: new Date(), recoveryState },
    });
  }

  async reconciled(
    missionId: string,
    recoveryState: string,
    failureReason?: string,
  ): Promise<void> {
    await this.client.mission.update({
      where: { id: missionId },
      data: {
        lastReconciliation: new Date(),
        recoveryState,
        recoveryFailureReason: failureReason ?? null,
      },
    });
  }

  async audit(input: Parameters<MissionWorkerRepository['audit']>[0]): Promise<string> {
    const record = await this.client.missionRecoveryAudit.create({
      data: {
        missionId: input.missionId,
        workerId: input.workerId,
        action: input.action,
        status: input.status,
        attempt: input.attempt,
        details: input.details ?? {},
      },
    });
    return record.id;
  }
}
