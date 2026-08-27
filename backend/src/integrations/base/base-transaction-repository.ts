import type {
  BaseTransaction,
  CreateBaseTransactionInput,
  UpdateBaseTransactionInput,
} from './base-transaction.js';

export interface BaseTransactionRepository {
  createOrGet(input: CreateBaseTransactionInput): Promise<BaseTransaction>;
  findById(id: string): Promise<BaseTransaction | null>;
  findByMissionId(missionId: string): Promise<readonly BaseTransaction[]>;
  findByMissionAndAction(missionId: string, actionId: string): Promise<BaseTransaction | null>;
  update(input: UpdateBaseTransactionInput): Promise<BaseTransaction>;
}
