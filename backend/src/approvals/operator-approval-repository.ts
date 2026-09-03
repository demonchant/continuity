import type { CreateOperatorApprovalInput, OperatorApproval } from './operator-approval.js';

export interface OperatorApprovalRepository {
  createOrGet(input: CreateOperatorApprovalInput): Promise<OperatorApproval>;
  findByAction(
    missionId: string,
    kind: OperatorApproval['kind'],
    actionId: string,
  ): Promise<OperatorApproval | null>;
  findByMissionId(missionId: string): Promise<readonly OperatorApproval[]>;
  consume(id: string): Promise<OperatorApproval>;
}
