import { randomUUID } from 'node:crypto';
import type {
  CreateMissionInput,
  Mission,
  MissionTransitionInput,
} from '../../src/missions/mission.js';
import type { MissionRepository } from '../../src/missions/mission-repository.js';

export class InMemoryMissionRepository implements MissionRepository {
  private readonly missions = new Map<string, Mission>();

  create(input: CreateMissionInput): Promise<Mission> {
    const now = new Date();
    const mission: Mission = {
      id: randomUUID(),
      objective: input.objective,
      constraints: input.constraints,
      budget: input.budget,
      status: 'CREATED',
      currentStep: 'created',
      createdAt: now,
      updatedAt: now,
    };
    this.missions.set(mission.id, mission);
    return Promise.resolve(mission);
  }

  findAll(): Promise<readonly Mission[]> {
    return Promise.resolve(
      [...this.missions.values()].sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      ),
    );
  }

  findById(id: string): Promise<Mission | null> {
    return Promise.resolve(this.missions.get(id) ?? null);
  }

  transition(input: MissionTransitionInput): Promise<Mission | null> {
    const mission = this.missions.get(input.missionId);
    if (!mission || mission.status !== input.expectedStatus) return Promise.resolve(null);

    const updated: Mission = {
      ...mission,
      status: input.targetStatus,
      currentStep: input.currentStep,
      updatedAt: new Date(mission.updatedAt.getTime() + 1),
    };
    this.missions.set(updated.id, updated);
    return Promise.resolve(updated);
  }
}
