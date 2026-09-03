export const operatorApprovalKinds = ['ACP_FUNDING', 'BASE_SETTLEMENT'] as const;
export type OperatorApprovalKind = (typeof operatorApprovalKinds)[number];

export const operatorApprovalStatuses = ['APPROVED', 'CONSUMED', 'CANCELLED'] as const;
export type OperatorApprovalStatus = (typeof operatorApprovalStatuses)[number];

export interface OperatorApproval {
  readonly id: string;
  readonly missionId: string;
  readonly kind: OperatorApprovalKind;
  readonly actionId: string;
  readonly referenceId: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: OperatorApprovalStatus;
  readonly approvedAt: Date;
  readonly consumedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type CreateOperatorApprovalInput = Pick<
  OperatorApproval,
  'missionId' | 'kind' | 'actionId' | 'referenceId' | 'amount' | 'currency'
>;
