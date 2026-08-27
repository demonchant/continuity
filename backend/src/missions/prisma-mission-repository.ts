import {
  MissionStatus as PrismaMissionStatus,
  Prisma,
  type Mission as PrismaMission,
  type PrismaClient,
} from '@prisma/client';
import type { CreateMissionInput, JsonObject, Mission, MissionTransitionInput } from './mission.js';
import type { MissionRepository } from './mission-repository.js';

function toDomainMission(record: PrismaMission): Mission {
  if (record.constraints === null || Array.isArray(record.constraints)) {
    throw new Error(`Mission ${record.id} has invalid constraints`);
  }

  return {
    id: record.id,
    objective: record.objective,
    constraints: record.constraints as JsonObject,
    budget: record.budget.toString(),
    status: record.status,
    currentStep: record.currentStep,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.recoveryState ? { recoveryState: record.recoveryState } : {}),
    ...(record.lastHeartbeat ? { lastHeartbeat: record.lastHeartbeat } : {}),
    ...(record.lastReconciliation ? { lastReconciliation: record.lastReconciliation } : {}),
    ...(record.recoveryFailureReason
      ? { recoveryFailureReason: record.recoveryFailureReason }
      : {}),
  };
}

export class PrismaMissionRepository implements MissionRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(input: CreateMissionInput): Promise<Mission> {
    const record = await this.client.$transaction(async (transaction) => {
      const mission = await transaction.mission.create({
        data: {
          objective: input.objective,
          constraints: input.constraints,
          budget: new Prisma.Decimal(input.budget),
          currentStep: 'created',
        },
      });

      await transaction.missionTransition.create({
        data: {
          missionId: mission.id,
          toStatus: PrismaMissionStatus.CREATED,
          reason: 'Mission created',
        },
      });

      return mission;
    });

    return toDomainMission(record);
  }

  async findAll(): Promise<readonly Mission[]> {
    const records = await this.client.mission.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return records.map(toDomainMission);
  }

  async findById(id: string): Promise<Mission | null> {
    const record = await this.client.mission.findUnique({ where: { id } });
    return record ? toDomainMission(record) : null;
  }

  async transition(input: MissionTransitionInput): Promise<Mission | null> {
    const record = await this.client.$transaction(async (transaction) => {
      const result = await transaction.mission.updateMany({
        where: {
          id: input.missionId,
          status: input.expectedStatus,
        },
        data: {
          status: input.targetStatus,
          currentStep: input.currentStep,
        },
      });

      if (result.count !== 1) return null;

      await transaction.missionTransition.create({
        data: {
          missionId: input.missionId,
          fromStatus: input.expectedStatus,
          toStatus: input.targetStatus,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
      });

      return transaction.mission.findUniqueOrThrow({ where: { id: input.missionId } });
    });

    return record ? toDomainMission(record) : null;
  }
}
