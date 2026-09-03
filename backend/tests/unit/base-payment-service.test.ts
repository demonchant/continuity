/* eslint-disable @typescript-eslint/unbound-method */
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { OperatorApprovalService } from '../../src/approvals/operator-approval-service.js';
import type { BaseTransactionGateway } from '../../src/integrations/base/base-gateway.js';
import { BasePaymentService } from '../../src/integrations/base/base-payment-service.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import type { Mission } from '../../src/missions/mission.js';
import { RecoveryService } from '../../src/recovery/recovery-service.js';
import { InMemoryBaseTransactionRepository } from '../support/in-memory-base-transaction-repository.js';
import { InMemoryRecoveryRepository } from '../support/in-memory-recovery-repository.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const logger = pino({ level: 'silent' });
const hash = `0x${'b'.repeat(64)}` as const;
const recipient = '0x2222222222222222222222222222222222222222';
const mission: Pick<Mission, 'id' | 'objective' | 'budget' | 'status'> = {
  id: '00000000-0000-4000-8000-000000000010',
  objective: 'Pay the selected research agent',
  budget: '0.001',
  status: 'VERIFYING',
};

function approvalService(granted = true) {
  return {
    authorized: vi.fn().mockImplementation((input) =>
      Promise.resolve(
        granted
          ? {
              ...input,
              id: 'approval',
              status: 'APPROVED',
              approvedAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : null,
      ),
    ),
    consume: vi.fn().mockResolvedValue(undefined),
  } as unknown as OperatorApprovalService;
}

function setup(overrides: Partial<BaseTransactionGateway> = {}, approvalGranted = true) {
  const gateway: BaseTransactionGateway = {
    network: 'base-sepolia',
    chainId: 84532,
    explorerBaseUrl: 'https://sepolia.basescan.org',
    sendNativeTransfer: vi.fn().mockResolvedValue(hash),
    sendTokenTransfer: vi.fn().mockResolvedValue(hash),
    waitForConfirmation: vi
      .fn()
      .mockResolvedValue({ transactionHash: hash, status: 'success', blockNumber: 100n }),
    getConfirmation: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  const provider = new MockMemoryProvider();
  const verificationRecord = {
    schemaVersion: 1,
    id: 'verified-memory-1',
    category: 'experience',
    timestamp: '2026-08-23T11:59:00.000Z',
    missionId: mission.id,
    mission: mission.objective,
    capability: 'research',
    agentId: 'virtuals:84532:agent',
    success: true,
    verification: { status: 'PASS', summary: 'Verified result passed.' },
    tags: ['result-verification', 'verification-base-1'],
  } as const;
  provider.searchResult = [
    {
      record: verificationRecord,
      sibylRecordId: 'sibyl-verified-memory-1',
      sibylTier: 'entity',
    },
  ];
  const memory = new MemoryService(provider, logger);
  const repository = new InMemoryBaseTransactionRepository();
  const recovery = new RecoveryService(new InMemoryRecoveryRepository(), memory, logger);
  const approvals = approvalService(approvalGranted);
  const service = new BasePaymentService(gateway, repository, recovery, memory, logger, approvals, {
    recipient,
    maxPaymentAmount: '0.0005',
    confirmations: 1,
  });
  return { service, gateway, provider, repository };
}

const request = {
  mission,
  actionId: 'base-pay-1',
  paymentId: 'payment-1',
  agentId: 'virtuals:84532:agent',
  amount: '0.0001',
  verificationId: 'verification-base-1',
} as const;

describe('BasePaymentService', () => {
  it('never constructs or broadcasts a transaction without exact operator approval', async () => {
    const { service, gateway, repository } = setup({}, false);
    await expect(service.pay(request)).rejects.toMatchObject({ code: 'BASE_APPROVAL_REQUIRED' });
    expect(gateway.sendNativeTransfer).not.toHaveBeenCalled();
    await expect(
      repository.findByMissionAndAction(mission.id, request.actionId),
    ).resolves.toBeNull();
  });

  it('validates budget before constructing a transaction', async () => {
    const { service, gateway } = setup();
    await expect(service.pay({ ...request, amount: '0.0006' })).rejects.toMatchObject({
      code: 'BASE_BUDGET_EXCEEDED',
    });
    expect(gateway.sendNativeTransfer).not.toHaveBeenCalled();
  });

  it('records submission, confirmation, explorer URL, and Sibyl outcome', async () => {
    const { service, gateway, provider } = setup();
    const transaction = await service.pay(request);
    expect(transaction).toMatchObject({
      transactionHash: hash,
      network: 'base-sepolia',
      chainId: 84532,
      action: 'MISSION_SUCCESS_SETTLEMENT',
      verificationId: 'verification-base-1',
      amount: '0.0001',
      status: 'CONFIRMED',
      blockNumber: 100n,
      explorerUrl: `https://sepolia.basescan.org/tx/${hash}`,
    });
    expect(gateway.waitForConfirmation).toHaveBeenCalledWith(hash, 1);
    expect(
      provider.records.some(
        ({ category, providerReference }) => category === 'outcome' && providerReference === hash,
      ),
    ).toBe(true);
  });

  it('constructs a USDC payment when the economic cost is denominated in USDC', async () => {
    const gateway = setup().gateway;
    const provider = new MockMemoryProvider();
    provider.searchResult = [
      {
        record: {
          schemaVersion: 1,
          id: 'verified-memory-usdc',
          category: 'experience',
          timestamp: '2026-08-23T11:59:00.000Z',
          missionId: mission.id,
          mission: mission.objective,
          capability: 'research',
          success: true,
          verification: { status: 'PASS', summary: 'Verified result passed.' },
          tags: ['verification-base-1'],
        },
        sibylRecordId: 'sibyl-verified-memory-usdc',
        sibylTier: 'entity',
      },
    ];
    const memory = new MemoryService(provider, logger);
    const service = new BasePaymentService(
      gateway,
      new InMemoryBaseTransactionRepository(),
      new RecoveryService(new InMemoryRecoveryRepository(), memory, logger),
      memory,
      logger,
      approvalService(),
      {
        recipient,
        maxPaymentAmount: '1.00',
        confirmations: 1,
        asset: 'USDC',
        tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      },
    );
    const transaction = await service.pay({
      ...request,
      mission: { ...mission, budget: '1.00' },
      actionId: 'usdc-pay',
      paymentId: 'usdc-payment',
      amount: '0.80',
    });
    expect(transaction.asset).toBe('USDC');
    expect(gateway.sendTokenTransfer).toHaveBeenCalledWith({
      recipient,
      tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      amountBaseUnits: 800000n,
    });
    expect(gateway.sendNativeTransfer).not.toHaveBeenCalled();
  });

  it('records reverted transactions as failures', async () => {
    const { service, provider, repository } = setup({
      waitForConfirmation: vi
        .fn()
        .mockResolvedValue({ transactionHash: hash, status: 'reverted', blockNumber: 101n }),
    });
    await expect(
      service.pay({ ...request, actionId: 'base-pay-fail', paymentId: 'payment-fail' }),
    ).rejects.toMatchObject({ code: 'BASE_TRANSACTION_REVERTED' });
    const record = await repository.findByMissionAndAction(mission.id, 'base-pay-fail');
    expect(record).toMatchObject({ status: 'FAILED', errorCode: 'BASE_TRANSACTION_REVERTED' });
    expect(provider.records.some(({ category }) => category === 'failure')).toBe(true);
  });

  it('returns the confirmed receipt on retry without a duplicate transfer', async () => {
    const { service, gateway } = setup();
    const first = await service.pay(request);
    const retry = await service.pay(request);
    expect(retry).toEqual(first);
    expect(gateway.sendNativeTransfer).toHaveBeenCalledOnce();
  });

  it('repairs a confirmed transaction after interruption at the Sibyl outcome boundary', async () => {
    const { service, gateway, provider, repository } = setup();
    vi.spyOn(provider, 'recordEvent').mockRejectedValueOnce(
      new Error('controlled interruption before Sibyl journal acknowledgement'),
    );

    await expect(service.pay(request)).rejects.toThrow(
      'controlled interruption before Sibyl journal acknowledgement',
    );
    const confirmed = await repository.findByMissionAndAction(mission.id, request.actionId);
    expect(confirmed).toMatchObject({
      status: 'CONFIRMED',
      transactionHash: hash,
      errorCode: 'SIBYL_OUTCOME_LINK_PENDING',
    });
    expect(gateway.sendNativeTransfer).toHaveBeenCalledOnce();

    const persistedOutcome = provider.records.find(
      ({ category, providerReference }) => category === 'outcome' && providerReference === hash,
    );
    if (!persistedOutcome) throw new Error('Expected the interrupted Sibyl entity write');
    provider.searchResult = [
      provider.searchResult[0]!,
      {
        record: persistedOutcome,
        sibylRecordId: `sibyl-record-${persistedOutcome.id}`,
        sibylTier: 'entity',
      },
    ];

    await expect(service.pay(request)).resolves.toMatchObject({
      status: 'CONFIRMED',
      transactionHash: hash,
      memoryRecordId: persistedOutcome.id,
      sibylRecordId: `sibyl-record-${persistedOutcome.id}`,
    });
    expect(gateway.sendNativeTransfer).toHaveBeenCalledOnce();
    expect(
      provider.records.filter(({ providerReference }) => providerReference === hash),
    ).toHaveLength(1);
  });

  it('does not broadcast twice under concurrent duplicate payment requests', async () => {
    const { service, gateway } = setup();
    const attempts = await Promise.allSettled([service.pay(request), service.pay(request)]);
    expect(attempts.some(({ status }) => status === 'fulfilled')).toBe(true);
    expect(gateway.sendNativeTransfer).toHaveBeenCalledOnce();
    await expect(service.pay(request)).resolves.toMatchObject({ status: 'CONFIRMED' });
    expect(gateway.sendNativeTransfer).toHaveBeenCalledOnce();
  });

  it('rejects reuse of a paymentId for a different action', async () => {
    const { service, gateway } = setup();
    await service.pay(request);
    await expect(service.pay({ ...request, actionId: 'different-action' })).rejects.toMatchObject({
      code: 'BASE_VALIDATION_ERROR',
    });
    expect(gateway.sendNativeTransfer).toHaveBeenCalledOnce();
  });

  it('marks an ambiguous broadcast uncertain and refuses an automatic retry', async () => {
    const { service, gateway, repository } = setup({
      sendNativeTransfer: vi.fn().mockRejectedValue(new Error('connection closed after send')),
    });
    await expect(
      service.pay({ ...request, actionId: 'base-pay-uncertain', paymentId: 'payment-uncertain' }),
    ).rejects.toMatchObject({ code: 'ACTION_OUTCOME_UNCERTAIN' });
    const record = await repository.findByMissionAndAction(mission.id, 'base-pay-uncertain');
    expect(record?.status).toBe('UNCERTAIN');
    await expect(
      service.pay({ ...request, actionId: 'base-pay-uncertain', paymentId: 'payment-uncertain' }),
    ).rejects.toMatchObject({ code: 'ACTION_RECONCILIATION_REQUIRED' });
    expect(gateway.sendNativeTransfer).toHaveBeenCalledOnce();
  });
});
