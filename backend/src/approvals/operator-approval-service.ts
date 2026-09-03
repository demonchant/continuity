import { AppError } from '../shared/errors/app-error.js';
import type { OperatorApprovalRepository } from './operator-approval-repository.js';
import type { CreateOperatorApprovalInput, OperatorApproval } from './operator-approval.js';

function normalizedAmount(value: string): string {
  if (!/^\d+(?:\.\d{1,18})?$/.test(value)) throw new Error('Invalid approval amount');
  const [whole, fraction = ''] = value.split('.');
  const normalizedWhole = whole!.replace(/^0+(?=\d)/, '');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function matches(approval: OperatorApproval, input: CreateOperatorApprovalInput): boolean {
  return (
    approval.referenceId === input.referenceId &&
    normalizedAmount(approval.amount) === normalizedAmount(input.amount) &&
    approval.currency.toUpperCase() === input.currency.toUpperCase()
  );
}

export class OperatorApprovalService {
  constructor(private readonly repository: OperatorApprovalRepository) {}

  async approve(input: CreateOperatorApprovalInput): Promise<OperatorApproval> {
    const canonical = {
      ...input,
      amount: normalizedAmount(input.amount),
      currency: input.currency.toUpperCase(),
    };
    const approval = await this.repository.createOrGet(canonical);
    if (!matches(approval, canonical) || approval.status === 'CANCELLED') {
      throw new AppError({
        statusCode: 409,
        code: 'APPROVAL_CONFLICT',
        message: 'A different approval already exists for this financial action',
      });
    }
    return approval;
  }

  async authorized(input: CreateOperatorApprovalInput): Promise<OperatorApproval | null> {
    const approval = await this.repository.findByAction(
      input.missionId,
      input.kind,
      input.actionId,
    );
    if (!approval || approval.status === 'CANCELLED') return null;
    if (!matches(approval, input)) {
      throw new AppError({
        statusCode: 409,
        code: 'APPROVAL_MISMATCH',
        message: 'The persisted approval does not match the current financial action',
      });
    }
    return approval;
  }

  consume(id: string): Promise<OperatorApproval> {
    return this.repository.consume(id);
  }

  list(missionId: string): Promise<readonly OperatorApproval[]> {
    return this.repository.findByMissionId(missionId);
  }
}
