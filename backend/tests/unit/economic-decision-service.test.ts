/* eslint-disable @typescript-eslint/unbound-method */
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { ExternalVirtualsAgent } from '../../src/agents/agent.js';
import { EconomicActionService } from '../../src/economics/economic-action-service.js';
import { EconomicDecisionService } from '../../src/economics/economic-decision-service.js';
import type { BaseTransactionGateway } from '../../src/integrations/base/base-gateway.js';
import { BasePaymentService } from '../../src/integrations/base/base-payment-service.js';
import type { VirtualsAgentSource } from '../../src/integrations/virtuals/virtuals-agent-source.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import type { MemoryRecord, RecalledMemory } from '../../src/memory/memory-record.js';
import type { Mission } from '../../src/missions/mission.js';
import { RecoveryService } from '../../src/recovery/recovery-service.js';
import { InMemoryBaseTransactionRepository } from '../support/in-memory-base-transaction-repository.js';
import { InMemoryRecoveryRepository } from '../support/in-memory-recovery-repository.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const logger = pino({ level: 'silent' });
const now = new Date('2026-08-23T12:00:00.000Z');
const mission: Pick<Mission, 'id' | 'objective' | 'budget'> = {
  id: '00000000-0000-4000-8000-000000000011',
  objective: 'Research and verify economic information about X',
  budget: '1.00',
};

function agent(id: 'agent-a' | 'agent-b', amount: string): ExternalVirtualsAgent {
  return {
    id,
    externalId:
      id === 'agent-a'
        ? '0x1111111111111111111111111111111111111111'
        : '0x2222222222222222222222222222222222222222',
    name: id === 'agent-a' ? 'Agent A' : 'Agent B',
    source: 'EXTERNAL_VIRTUALS',
    provider: 'virtuals',
    capabilities: ['research', 'fact-verification'],
    status: 'AVAILABLE',
    cost: { model: 'FIXED', amount, currency: 'USDC' },
    metadata: {},
  };
}

function memory(id: string, agentId: 'agent-a' | 'agent-b', passed: boolean): RecalledMemory {
  const record: MemoryRecord = {
    schemaVersion: 1,
    id,
    category: passed ? 'outcome' : 'failure',
    timestamp: '2026-08-22T12:00:00.000Z',
    missionId: `prior-${id}`,
    mission: mission.objective,
    capability: 'fact-verification',
    agentId,
    agentProvider: 'virtuals',
    result: passed ? 'Verified result completed' : 'Comparable result failed verification',
    success: passed,
    verification: { status: passed ? 'PASS' : 'FAIL', summary: passed ? 'Passed' : 'Failed' },
    ...(passed ? {} : { failureReason: 'Failed fact verification' }),
    recommendation: passed ? `Prefer ${agentId}` : `Avoid ${agentId}`,
  };
  return { record, sibylRecordId: `sibyl-${id}`, sibylTier: 'entity' };
}

function decisionSetup(memories: readonly RecalledMemory[]) {
  const provider = new MockMemoryProvider();
  provider.searchResult = memories;
  const memoryService = new MemoryService(provider, logger, { now: () => now });
  return {
    provider,
    memoryService,
    service: new EconomicDecisionService(memoryService, logger, () => now),
  };
}

describe('memory-driven economic decisions', () => {
  it('selects by cost without history, then changes to the more reliable agent when Sibyl changes', async () => {
    const candidates = [agent('agent-a', '0.50'), agent('agent-b', '0.80')];
    const baseline = await decisionSetup([]).service.decide({
      mission,
      candidates,
      capabilities: ['research', 'fact-verification'],
      budgetCurrency: 'USDC',
    });
    expect(baseline).toMatchObject({
      selectedAgent: { id: 'agent-a' },
      estimatedCost: { amount: '0.50', currency: 'USDC' },
      historicalExperience: 'available',
    });
    expect(baseline.memoryReferences).toEqual([]);

    const learned = await decisionSetup([
      memory('failure-a', 'agent-a', false),
      memory('success-b', 'agent-b', true),
    ]).service.decide({
      mission,
      candidates,
      capabilities: ['research', 'fact-verification'],
      budgetCurrency: 'USDC',
    });
    expect(learned).toMatchObject({
      selectedAgent: { id: 'agent-b' },
      estimatedCost: { amount: '0.80', currency: 'USDC' },
    });
    expect(learned.expectedOutcome.verifiedSuccessProbability).toBeGreaterThan(
      baseline.expectedOutcome.verifiedSuccessProbability,
    );
    expect(learned.memoryReferences).toEqual(['sibyl-failure-a', 'sibyl-success-b']);
    expect(learned.reason).toContain('within the 1.00 USDC budget');
    expect(learned.historicalEvidence.find(({ agentId }) => agentId === 'agent-b')).toMatchObject({
      metrics: { successRate: 1, verificationSuccessRate: 1 },
      memoryReferences: ['sibyl-success-b'],
    });
  });

  it('excludes agents whose cost is outside the mission budget', async () => {
    const { service } = decisionSetup([memory('success-b', 'agent-b', true)]);
    const result = await service.decide({
      mission: { ...mission, budget: '0.60' },
      candidates: [agent('agent-a', '0.50'), agent('agent-b', '0.80')],
      capabilities: ['research'],
      budgetCurrency: 'USDC',
    });
    expect(result.selectedAgent.id).toBe('agent-a');
    expect(result.alternatives).toEqual([]);
  });

  it('blocks the decision-only endpoint from duplicating ACP payment on Base', async () => {
    const { memoryService, service: decisions } = decisionSetup([
      memory('failure-a', 'agent-a', false),
      memory('success-b', 'agent-b', true),
    ]);
    const candidates = [agent('agent-a', '0.50'), agent('agent-b', '0.80')];
    const source = {
      provider: 'virtuals',
      discoverCandidates: vi.fn().mockResolvedValue(
        candidates.map((item) => ({
          agent: item,
          chainId: 84532,
          providerAddress: item.externalId,
          offeringName: 'research',
          offeringRequirements: {},
        })),
      ),
    } as unknown as VirtualsAgentSource;
    const hash = `0x${'e'.repeat(64)}` as const;
    const gateway: BaseTransactionGateway = {
      network: 'base-sepolia',
      chainId: 84532,
      explorerBaseUrl: 'https://sepolia.basescan.org',
      sendNativeTransfer: vi.fn().mockResolvedValue(hash),
      sendTokenTransfer: vi.fn().mockResolvedValue(hash),
      waitForConfirmation: vi
        .fn()
        .mockResolvedValue({ transactionHash: hash, status: 'success', blockNumber: 900n }),
      getConfirmation: vi.fn().mockResolvedValue(null),
    };
    const payments = new BasePaymentService(
      gateway,
      new InMemoryBaseTransactionRepository(),
      new RecoveryService(new InMemoryRecoveryRepository(), memoryService, logger),
      memoryService,
      logger,
      {
        recipient: '0x2222222222222222222222222222222222222222',
        maxPaymentAmount: '1.00',
        confirmations: 1,
        asset: 'USDC',
        tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      },
    );
    await expect(
      new EconomicActionService(source, decisions, payments, logger).execute({
        mission,
        capabilities: ['research', 'fact-verification'],
        budgetCurrency: 'USDC',
        executeBase: true,
        actionId: 'economic-pay',
        paymentId: 'economic-payment',
      }),
    ).rejects.toMatchObject({ code: 'BASE_REQUIRES_VERIFIED_MISSION' });
    expect(gateway.sendTokenTransfer).not.toHaveBeenCalled();
  });
});
