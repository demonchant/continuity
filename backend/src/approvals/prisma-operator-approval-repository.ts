import {
  Prisma,
  type OperatorApproval as PrismaOperatorApproval,
  type PrismaClient,
} from '@prisma/client';
import type { OperatorApprovalRepository } from './operator-approval-repository.js';
import type { CreateOperatorApprovalInput, OperatorApproval } from './operator-approval.js';

function toDomain(record: PrismaOperatorApproval): OperatorApproval {
  return {
    id: record.id,
    missionId: record.missionId,
    kind: record.kind,
    actionId: record.actionId,
    referenceId: record.referenceId,
    amount: record.amount.toString(),
    currency: record.currency,
    status: record.status,
    approvedAt: record.approvedAt,
    ...(record.consumedAt ? { consumedAt: record.consumedAt } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class PrismaOperatorApprovalRepository implements OperatorApprovalRepository {
  constructor(private readonly client: PrismaClient) {}

  async createOrGet(input: CreateOperatorApprovalInput): Promise<OperatorApproval> {
    const key = {
      missionId_kind_actionId: {
        missionId: input.missionId,
        kind: input.kind,
        actionId: input.actionId,
      },
    } as const;
    const existing = await this.client.operatorApproval.findUnique({ where: key });
    if (existing) return toDomain(existing);
    try {
      return toDomain(
        await this.client.operatorApproval.create({
          data: { ...input, amount: new Prisma.Decimal(input.amount) },
        }),
      );
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const raced = await this.client.operatorApproval.findUnique({ where: key });
      if (!raced) throw error;
      return toDomain(raced);
    }
  }

  findByAction(
    missionId: string,
    kind: OperatorApproval['kind'],
    actionId: string,
  ): Promise<OperatorApproval | null> {
    return this.client.operatorApproval
      .findUnique({ where: { missionId_kind_actionId: { missionId, kind, actionId } } })
      .then((record) => (record ? toDomain(record) : null));
  }

  findByMissionId(missionId: string): Promise<readonly OperatorApproval[]> {
    return this.client.operatorApproval
      .findMany({ where: { missionId }, orderBy: { createdAt: 'asc' } })
      .then((records) => records.map(toDomain));
  }

  async consume(id: string): Promise<OperatorApproval> {
    const updated = await this.client.operatorApproval.updateMany({
      where: { id, status: 'APPROVED' },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    });
    const record = await this.client.operatorApproval.findUniqueOrThrow({ where: { id } });
    if (updated.count === 0 && record.status !== 'CONSUMED') {
      throw new Error('Operator approval is not consumable');
    }
    return toDomain(record);
  }
}
