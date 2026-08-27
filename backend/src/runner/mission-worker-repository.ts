import type { JsonObject } from '../missions/mission.js';

export interface MissionWorkerRepository {
  acquireLease(workerId: string, leaseMs: number): Promise<boolean>;
  heartbeat(missionId: string, recoveryState: string): Promise<void>;
  reconciled(missionId: string, recoveryState: string, failureReason?: string): Promise<void>;
  audit(input: {
    readonly missionId: string;
    readonly workerId: string;
    readonly action: string;
    readonly status: string;
    readonly attempt: number;
    readonly details?: JsonObject;
  }): Promise<string>;
}
