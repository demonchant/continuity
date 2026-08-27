import type { BaseNetwork, TransactionHash } from './base-gateway.js';

export type BaseTransactionStatus = 'INTENDED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'UNCERTAIN';

export interface BaseTransaction {
  readonly id: string;
  readonly missionId: string;
  readonly actionId: string;
  readonly paymentId: string;
  readonly agentId: string;
  readonly transactionHash?: TransactionHash;
  readonly network: BaseNetwork;
  readonly chainId: number;
  readonly action: 'AGENT_PAYMENT' | 'MISSION_SUCCESS_SETTLEMENT';
  readonly verificationId?: string;
  readonly recipient: `0x${string}`;
  readonly amount: string;
  readonly asset: 'ETH' | 'USDC';
  readonly status: BaseTransactionStatus;
  readonly blockNumber?: bigint;
  readonly confirmations?: number;
  readonly explorerUrl?: string;
  readonly memoryRecordId?: string;
  readonly sibylRecordId?: string;
  readonly sibylEventId?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly confirmedAt?: Date;
}

export type CreateBaseTransactionInput = Pick<
  BaseTransaction,
  | 'missionId'
  | 'actionId'
  | 'paymentId'
  | 'agentId'
  | 'network'
  | 'chainId'
  | 'action'
  | 'verificationId'
  | 'recipient'
  | 'amount'
  | 'asset'
>;

export interface UpdateBaseTransactionInput {
  readonly id: string;
  readonly status: BaseTransactionStatus;
  readonly transactionHash?: TransactionHash;
  readonly blockNumber?: bigint;
  readonly confirmations?: number;
  readonly explorerUrl?: string;
  readonly memoryRecordId?: string;
  readonly sibylRecordId?: string;
  readonly sibylEventId?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}
