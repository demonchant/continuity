import type { Logger } from 'pino';
import { isAddress, parseUnits } from 'viem';
import type { MemoryService } from '../../memory/memory-service.js';
import type { Mission } from '../../missions/mission.js';
import type { RecoveryService } from '../../recovery/recovery-service.js';
import type { BaseTransactionGateway, TransactionHash } from './base-gateway.js';
import { BaseIntegrationError } from './base-errors.js';
import type { BaseTransactionRepository } from './base-transaction-repository.js';
import type { BaseTransaction } from './base-transaction.js';

export interface BasePaymentRequest {
  readonly mission: Pick<Mission, 'id' | 'objective' | 'budget' | 'status'>;
  readonly actionId: string;
  readonly paymentId: string;
  readonly agentId: string;
  readonly amount: string;
  readonly verificationId: string;
}

export interface BasePaymentOptions {
  readonly recipient: `0x${string}`;
  readonly maxPaymentAmount: string;
  readonly confirmations: number;
  readonly asset?: 'ETH' | 'USDC';
  readonly tokenAddress?: `0x${string}`;
}

function amount(value: string, label: string, decimals: number): bigint {
  try {
    const parsed = parseUnits(value, decimals);
    if (parsed <= 0n) throw new Error('not positive');
    return parsed;
  } catch {
    throw new BaseIntegrationError(
      'BASE_VALIDATION_ERROR',
      `${label} must be a positive decimal amount for the configured Base asset`,
      false,
    );
  }
}

export class BasePaymentService {
  private readonly maxWei: bigint;
  readonly supportedAsset: 'ETH' | 'USDC';
  readonly paymentRecipient: `0x${string}`;
  private readonly decimals: number;

  constructor(
    private readonly gateway: BaseTransactionGateway,
    private readonly transactions: BaseTransactionRepository,
    private readonly recovery: RecoveryService,
    private readonly memory: MemoryService,
    private readonly logger: Logger,
    private readonly options: BasePaymentOptions,
  ) {
    if (!isAddress(options.recipient)) {
      throw new BaseIntegrationError(
        'BASE_CONFIGURATION_ERROR',
        'Configured Base payment recipient is invalid',
        false,
      );
    }
    this.supportedAsset = options.asset ?? 'ETH';
    this.paymentRecipient = options.recipient;
    this.decimals = this.supportedAsset === 'USDC' ? 6 : 18;
    if (
      this.supportedAsset === 'USDC' &&
      (!options.tokenAddress || !isAddress(options.tokenAddress))
    ) {
      throw new BaseIntegrationError(
        'BASE_CONFIGURATION_ERROR',
        'A valid Base USDC token address is required for USDC payments',
        false,
      );
    }
    this.maxWei = amount(options.maxPaymentAmount, 'Maximum Base payment', this.decimals);
  }

  async pay(request: BasePaymentRequest): Promise<BaseTransaction> {
    const existing = await this.transactions.findByMissionAndAction(
      request.mission.id,
      request.actionId,
    );
    if (existing) {
      this.assertSameIntent(existing, request);
      if (existing.status === 'CONFIRMED' && existing.sibylRecordId && existing.memoryRecordId)
        return existing;
    }
    if (request.mission.status !== 'VERIFYING') {
      throw new BaseIntegrationError(
        'BASE_VALIDATION_ERROR',
        'Base mission settlement is allowed only after agent verification and before mission completion',
        false,
      );
    }
    const verificationEvidence = await this.memory.recall({
      mission: request.mission.objective,
      capabilities: [],
      categories: ['experience'],
      limit: 50,
    });
    const verified = verificationEvidence.records.find(
      ({ record }) =>
        record.missionId === request.mission.id &&
        record.success === true &&
        record.verification?.status === 'PASS' &&
        record.tags?.includes(request.verificationId),
    );
    if (!verified) {
      throw new BaseIntegrationError(
        'BASE_VALIDATION_ERROR',
        'No persisted Sibyl PASS evidence matches this mission and verification ID',
        false,
      );
    }
    const paymentWei = amount(request.amount, 'Payment amount', this.decimals);
    const missionBudgetWei = amount(request.mission.budget, 'Mission budget', this.decimals);
    if (paymentWei > missionBudgetWei || paymentWei > this.maxWei) {
      throw new BaseIntegrationError(
        'BASE_BUDGET_EXCEEDED',
        'Base payment exceeds the mission budget or configured transaction limit',
        false,
      );
    }
    let transaction =
      existing ??
      (await this.transactions.createOrGet({
        missionId: request.mission.id,
        actionId: request.actionId,
        paymentId: request.paymentId,
        agentId: request.agentId,
        network: this.gateway.network,
        chainId: this.gateway.chainId,
        action: 'MISSION_SUCCESS_SETTLEMENT',
        verificationId: request.verificationId,
        recipient: this.options.recipient,
        amount: request.amount,
        asset: this.supportedAsset,
      }));
    this.assertSameIntent(transaction, request);

    try {
      if (transaction.status === 'CONFIRMED') {
        return await this.ensureConfirmedOutcomeMemory(
          transaction,
          request,
          verified.sibylRecordId,
        );
      }
      const broadcast = await this.recovery.executeCriticalAction(
        {
          missionId: request.mission.id,
          actionId: request.actionId,
          paymentId: request.paymentId,
          kind: 'BASE_MISSION_SUCCESS_SETTLEMENT',
        },
        async () => {
          const transactionHash =
            this.supportedAsset === 'USDC'
              ? await this.gateway.sendTokenTransfer({
                  recipient: this.options.recipient,
                  tokenAddress: this.options.tokenAddress!,
                  amountBaseUnits: paymentWei,
                })
              : await this.gateway.sendNativeTransfer({
                  recipient: this.options.recipient,
                  amountWei: paymentWei,
                });
          return {
            receipt: {
              transactionHash,
              network: this.gateway.network,
              chainId: this.gateway.chainId,
              amount: request.amount,
              asset: this.supportedAsset,
            },
            providerReference: transactionHash,
          };
        },
      );
      const hash = broadcast.receipt.transactionHash;
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        throw new BaseIntegrationError(
          'BASE_TRANSACTION_FAILED',
          'Base returned an invalid transaction hash',
          false,
        );
      }
      const transactionHash = hash as TransactionHash;
      transaction = await this.transactions.update({
        id: transaction.id,
        status: 'SUBMITTED',
        transactionHash,
        explorerUrl: `${this.gateway.explorerBaseUrl}/tx/${transactionHash}`,
      });
      const receipt = await this.gateway.waitForConfirmation(
        transactionHash,
        this.options.confirmations,
      );
      if (receipt.status !== 'success') {
        throw new BaseIntegrationError(
          'BASE_TRANSACTION_REVERTED',
          'Base transaction reverted onchain',
          false,
        );
      }
      transaction = await this.transactions.update({
        id: transaction.id,
        status: 'CONFIRMED',
        transactionHash,
        blockNumber: receipt.blockNumber,
        confirmations: this.options.confirmations,
        explorerUrl: `${this.gateway.explorerBaseUrl}/tx/${transactionHash}`,
      });
      transaction = await this.ensureConfirmedOutcomeMemory(
        transaction,
        request,
        verified.sibylRecordId,
      );
      this.logger.info(
        {
          event: 'base.transaction.confirmed',
          missionId: request.mission.id,
          paymentId: request.paymentId,
          transactionHash,
          network: this.gateway.network,
          amount: request.amount,
          asset: this.supportedAsset,
        },
        'Distinct Base mission success settlement confirmed',
      );
      return transaction;
    } catch (error) {
      const uncertain =
        error instanceof Error && 'code' in error && error.code === 'ACTION_OUTCOME_UNCERTAIN';
      const integrationError = error instanceof BaseIntegrationError ? error : undefined;
      const confirmedOnchain = transaction.status === 'CONFIRMED';
      await this.transactions.update({
        id: transaction.id,
        status: confirmedOnchain ? 'CONFIRMED' : uncertain ? 'UNCERTAIN' : 'FAILED',
        errorCode: confirmedOnchain
          ? 'SIBYL_OUTCOME_LINK_PENDING'
          : (integrationError?.code ??
            (uncertain ? 'ACTION_OUTCOME_UNCERTAIN' : 'BASE_TRANSACTION_FAILED')),
        errorMessage: error instanceof Error ? error.message : 'Unknown Base payment failure',
      });
      if (!uncertain && !confirmedOnchain) {
        await this.memory.recordFailure({
          missionId: request.mission.id,
          mission: request.mission.objective,
          agentId: request.agentId,
          agentProvider: 'virtuals',
          capability: 'mission-success-settlement',
          result: 'Base mission success settlement did not confirm successfully.',
          failureReason: error instanceof Error ? error.message : 'Unknown Base payment failure',
          recommendation: `Inspect payment ${request.paymentId}; never issue a replacement without reconciling its onchain state.`,
          tags: ['base', 'payment-failure'],
        });
      }
      throw error;
    }
  }

  private async ensureConfirmedOutcomeMemory(
    transaction: BaseTransaction,
    request: BasePaymentRequest,
    verificationSibylRecordId: string,
  ): Promise<BaseTransaction> {
    if (!transaction.transactionHash) {
      throw new BaseIntegrationError(
        'BASE_TRANSACTION_FAILED',
        'Confirmed Base transaction is missing its transaction hash',
        false,
      );
    }
    if (transaction.sibylRecordId && transaction.memoryRecordId) return transaction;

    const priorOutcome = await this.memory.recall({
      mission: request.mission.objective,
      capabilities: ['mission-success-settlement'],
      categories: ['outcome'],
      limit: 50,
    });
    const existingOutcome = priorOutcome.records.find(
      ({ record }) =>
        record.missionId === request.mission.id &&
        record.providerReference?.toLowerCase() === transaction.transactionHash?.toLowerCase(),
    );
    if (existingOutcome) {
      return this.transactions.update({
        id: transaction.id,
        status: 'CONFIRMED',
        memoryRecordId: existingOutcome.record.id,
        sibylRecordId: existingOutcome.sibylRecordId,
      });
    }

    const memoryWrite = await this.memory.recordOutcomeWithReceipt({
      missionId: request.mission.id,
      mission: request.mission.objective,
      agentId: request.agentId,
      agentProvider: 'virtuals',
      capability: 'mission-success-settlement',
      result: `Confirmed distinct post-verification mission settlement of ${request.amount} ${this.supportedAsset} on ${this.gateway.network}; Virtuals ACP funding paid for provider execution separately.`,
      success: true,
      cost: { amount: request.amount, currency: this.supportedAsset },
      providerReference: transaction.transactionHash,
      recommendation:
        'Treat this mission settlement as complete; do not submit the same paymentId again.',
      memoryReferences: [verificationSibylRecordId],
      tags: [
        'base',
        'mission-success-settlement',
        `verification:${request.verificationId}`,
        `network:${this.gateway.network}`,
      ],
    });
    return this.transactions.update({
      id: transaction.id,
      status: 'CONFIRMED',
      memoryRecordId: memoryWrite.record.id,
      sibylRecordId: memoryWrite.sibylRecordId,
      ...(memoryWrite.sibylEventId ? { sibylEventId: memoryWrite.sibylEventId } : {}),
    });
  }

  private assertSameIntent(transaction: BaseTransaction, request: BasePaymentRequest): void {
    if (
      transaction.missionId !== request.mission.id ||
      transaction.actionId !== request.actionId ||
      transaction.paymentId !== request.paymentId ||
      transaction.agentId !== request.agentId ||
      transaction.amount !== request.amount ||
      transaction.asset !== this.supportedAsset ||
      transaction.action !== 'MISSION_SUCCESS_SETTLEMENT' ||
      transaction.verificationId !== request.verificationId ||
      transaction.recipient.toLowerCase() !== this.options.recipient.toLowerCase()
    ) {
      throw new BaseIntegrationError(
        'BASE_VALIDATION_ERROR',
        'The mission action is already bound to a different Base payment intent',
        false,
      );
    }
  }
}
