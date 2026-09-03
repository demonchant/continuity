import { randomUUID } from 'node:crypto';
import type { OperatorApprovalRepository } from '../../src/approvals/operator-approval-repository.js';
import type {
  CreateOperatorApprovalInput,
  OperatorApproval,
} from '../../src/approvals/operator-approval.js';

export class InMemoryOperatorApprovalRepository implements OperatorApprovalRepository {
  readonly approvals: OperatorApproval[] = [];

  createOrGet(input: CreateOperatorApprovalInput): Promise<OperatorApproval> {
    const existing = this.approvals.find(
      (item) =>
        item.missionId === input.missionId &&
        item.kind === input.kind &&
        item.actionId === input.actionId,
    );
    if (existing) return Promise.resolve(existing);
    const now = new Date();
    const approval: OperatorApproval = {
      ...input,
      id: randomUUID(),
      status: 'APPROVED',
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.approvals.push(approval);
    return Promise.resolve(approval);
  }

  findByAction(
    missionId: string,
    kind: OperatorApproval['kind'],
    actionId: string,
  ): Promise<OperatorApproval | null> {
    return Promise.resolve(
      this.approvals.find(
        (item) => item.missionId === missionId && item.kind === kind && item.actionId === actionId,
      ) ?? null,
    );
  }

  findByMissionId(missionId: string): Promise<readonly OperatorApproval[]> {
    return Promise.resolve(this.approvals.filter((item) => item.missionId === missionId));
  }

  consume(id: string): Promise<OperatorApproval> {
    const index = this.approvals.findIndex((item) => item.id === id);
    const existing = this.approvals[index];
    if (!existing) return Promise.reject(new Error('Approval not found'));
    if (existing.status === 'CONSUMED') return Promise.resolve(existing);
    const consumed: OperatorApproval = {
      ...existing,
      status: 'CONSUMED',
      consumedAt: new Date(),
      updatedAt: new Date(),
    };
    this.approvals[index] = consumed;
    return Promise.resolve(consumed);
  }
}
