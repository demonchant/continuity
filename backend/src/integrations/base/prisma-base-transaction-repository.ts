import {
  Prisma,
  type BaseTransaction as PrismaBaseTransaction,
  type PrismaClient,
} from '@prisma/client';
import type { BaseTransactionRepository } from './base-transaction-repository.js';
import type {
  BaseTransaction,
  CreateBaseTransactionInput,
  UpdateBaseTransactionInput,
} from './base-transaction.js';

function toDomain(record: PrismaBaseTransaction): BaseTransaction {
  return {
    id: record.id,
    missionId: record.missionId,
    actionId: record.actionId,
    paymentId: record.paymentId,
    agentId: record.agentId,
    ...(record.transactionHash ? { transactionHash: record.transactionHash as `0x${string}` } : {}),
    network: record.network as BaseTransaction['network'],
    chainId: record.chainId,
    action: record.action as BaseTransaction['action'],
    ...(record.verificationId ? { verificationId: record.verificationId } : {}),
    recipient: record.recipient as `0x${string}`,
    amount: record.amount.toFixed(),
    asset: record.asset as BaseTransaction['asset'],
    status: record.status,
    ...(record.blockNumber !== null ? { blockNumber: record.blockNumber } : {}),
    ...(record.confirmations !== null ? { confirmations: record.confirmations } : {}),
    ...(record.explorerUrl ? { explorerUrl: record.explorerUrl } : {}),
    ...(record.memoryRecordId ? { memoryRecordId: record.memoryRecordId } : {}),
    ...(record.sibylRecordId ? { sibylRecordId: record.sibylRecordId } : {}),
    ...(record.sibylEventId ? { sibylEventId: record.sibylEventId } : {}),
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.confirmedAt ? { confirmedAt: record.confirmedAt } : {}),
  };
}

export class PrismaBaseTransactionRepository implements BaseTransactionRepository {
  constructor(private readonly client: PrismaClient) {}

  async createOrGet(input: CreateBaseTransactionInput): Promise<BaseTransaction> {
    const existing = await this.client.baseTransaction.findUnique({
      where: { missionId_actionId: { missionId: input.missionId, actionId: input.actionId } },
    });
    if (existing) return toDomain(existing);
    const payment = await this.client.baseTransaction.findUnique({
      where: { paymentId: input.paymentId },
    });
    if (payment) return toDomain(payment);
    try {
      return toDomain(await this.client.baseTransaction.create({ data: input }));
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const raced =
        (await this.client.baseTransaction.findUnique({
          where: { missionId_actionId: { missionId: input.missionId, actionId: input.actionId } },
        })) ??
        (await this.client.baseTransaction.findUnique({ where: { paymentId: input.paymentId } }));
      if (!raced) throw error;
      return toDomain(raced);
    }
  }

  findById(id: string): Promise<BaseTransaction | null> {
    return this.client.baseTransaction
      .findUnique({ where: { id } })
      .then((record) => (record ? toDomain(record) : null));
  }

  findByMissionId(missionId: string): Promise<readonly BaseTransaction[]> {
    return this.client.baseTransaction
      .findMany({ where: { missionId }, orderBy: { createdAt: 'asc' } })
      .then((records) => records.map(toDomain));
  }

  findByMissionAndAction(missionId: string, actionId: string): Promise<BaseTransaction | null> {
    return this.client.baseTransaction
      .findUnique({ where: { missionId_actionId: { missionId, actionId } } })
      .then((record) => (record ? toDomain(record) : null));
  }

  async update(input: UpdateBaseTransactionInput): Promise<BaseTransaction> {
    return toDomain(
      await this.client.baseTransaction.update({
        where: { id: input.id },
        data: {
          status: input.status,
          ...(input.transactionHash ? { transactionHash: input.transactionHash } : {}),
          ...(input.blockNumber !== undefined ? { blockNumber: input.blockNumber } : {}),
          ...(input.confirmations !== undefined ? { confirmations: input.confirmations } : {}),
          ...(input.explorerUrl ? { explorerUrl: input.explorerUrl } : {}),
          ...(input.memoryRecordId ? { memoryRecordId: input.memoryRecordId } : {}),
          ...(input.sibylRecordId ? { sibylRecordId: input.sibylRecordId } : {}),
          ...(input.sibylEventId ? { sibylEventId: input.sibylEventId } : {}),
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
          ...(input.status === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
        },
      }),
    );
  }
}
