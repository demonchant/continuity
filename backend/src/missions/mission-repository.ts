import type { CreateMissionInput, Mission, MissionTransitionInput } from './mission.js';

export interface MissionRepository {
  create(input: CreateMissionInput): Promise<Mission>;
  findAll(): Promise<readonly Mission[]>;
  findAllByOrganizationId(organizationId: string): Promise<readonly Mission[]>;
  findById(id: string): Promise<Mission | null>;
  transition(input: MissionTransitionInput): Promise<Mission | null>;
}
