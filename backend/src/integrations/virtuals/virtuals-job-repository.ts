import type {
  CreateVirtualsJobInput,
  UpdateVirtualsJobInput,
  VirtualsJob,
} from './virtuals-job.js';

export interface VirtualsJobRepository {
  createOrGet(input: CreateVirtualsJobInput): Promise<VirtualsJob>;
  findById(id: string): Promise<VirtualsJob | null>;
  findByMissionId(missionId: string): Promise<readonly VirtualsJob[]>;
  findByMissionAndAction(missionId: string, actionId: string): Promise<VirtualsJob | null>;
  update(input: UpdateVirtualsJobInput): Promise<VirtualsJob>;
}
