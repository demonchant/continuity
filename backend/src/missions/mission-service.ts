import { AppError } from '../shared/errors/app-error.js';
import {
  isMissionStatus,
  type CreateMissionInput,
  type Mission,
  type MissionStatus,
} from './mission.js';
import type { MissionRepository } from './mission-repository.js';
import { defaultStepForStatus, isMissionTransitionAllowed } from './mission-transition-policy.js';

export class MissionService {
  constructor(private readonly repository: MissionRepository) {}

  async create(input: CreateMissionInput): Promise<Mission> {
    return this.assertIntegrity(await this.repository.create(input));
  }

  async list(): Promise<readonly Mission[]> {
    return (await this.repository.findAll()).map((mission) => this.assertIntegrity(mission));
  }

  async get(id: string): Promise<Mission> {
    const mission = await this.repository.findById(id);
    if (!mission) throw this.notFound(id);
    return this.assertIntegrity(mission);
  }

  async cancel(id: string): Promise<Mission> {
    return this.transition(id, 'CANCELLED', 'Cancelled by operator');
  }

  async transition(id: string, targetStatus: MissionStatus, reason?: string): Promise<Mission> {
    const mission = await this.get(id);

    if (!isMissionTransitionAllowed(mission.status, targetStatus)) {
      throw new AppError({
        statusCode: 409,
        code: 'INVALID_MISSION_TRANSITION',
        message: `Mission cannot transition from ${mission.status} to ${targetStatus}`,
        details: { missionId: id, currentStatus: mission.status, targetStatus },
      });
    }

    const updated = await this.repository.transition({
      missionId: id,
      expectedStatus: mission.status,
      targetStatus,
      currentStep: defaultStepForStatus(targetStatus),
      ...(reason === undefined ? {} : { reason }),
    });

    if (updated) return updated;

    const latest = await this.repository.findById(id);
    if (!latest) throw this.notFound(id);

    throw new AppError({
      statusCode: 409,
      code: 'MISSION_STATE_CONFLICT',
      message: 'Mission state changed before the transition could be applied',
      details: {
        missionId: id,
        expectedStatus: mission.status,
        currentStatus: latest.status,
        targetStatus,
      },
    });
  }

  private notFound(id: string): AppError {
    return new AppError({
      statusCode: 404,
      code: 'MISSION_NOT_FOUND',
      message: `Mission not found: ${id}`,
    });
  }

  private assertIntegrity(mission: Mission): Mission {
    if (
      !isMissionStatus(mission.status) ||
      typeof mission.currentStep !== 'string' ||
      mission.currentStep.trim().length === 0 ||
      !(mission.createdAt instanceof Date) ||
      !Number.isFinite(mission.createdAt.getTime()) ||
      !(mission.updatedAt instanceof Date) ||
      !Number.isFinite(mission.updatedAt.getTime())
    ) {
      throw new AppError({
        statusCode: 500,
        code: 'MISSION_STATE_CORRUPT',
        message: 'Persisted mission state failed integrity validation',
        details: { missionId: mission.id },
      });
    }
    return mission;
  }
}
