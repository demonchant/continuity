import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { LocalTestAgent } from '../../src/agents/agent.js';
import { InMemoryAgentRegistry } from '../../src/agents/agent-registry.js';
import { DecisionEngine } from '../../src/decisions/decision-engine.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import type { Mission } from '../../src/missions/mission.js';
import {
  VerificationService,
  verifierVersion,
} from '../../src/verification/verification-service.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const logger = pino({ level: 'silent' });
const mission: Pick<Mission, 'id' | 'objective' | 'constraints'> = {
  id: '00000000-0000-4000-8000-000000000007',
  objective: 'Research and verify information about X',
  constraints: {
    output: { format: 'object', requiredFields: ['summary', 'facts'] },
    requiredSources: 2,
    requireEvidence: true,
    requiredTerms: ['verified'],
    prohibitedTerms: ['unverified'],
  },
};

function setup(id = 'report-1') {
  const provider = new MockMemoryProvider();
  const memory = new MemoryService(provider, logger, {
    id: () => `memory-${id}`,
    now: () => new Date('2026-08-21T12:00:00.000Z'),
  });
  const service = new VerificationService(memory, logger, { id: () => id });
  return { provider, memory, service };
}

describe('VerificationService', () => {
  it('accepts a complete result and records verified experience in Sibyl', async () => {
    const { provider, service } = setup('passing');

    const report = await service.verify({
      mission,
      agent: { id: 'agent-a', provider: 'local-test' },
      capability: 'fact-verification',
      result: {
        claimedSuccess: false,
        output: {
          summary: 'Verified findings about X',
          facts: ['Fact one', 'Fact two'],
          status: 'completed',
          success: true,
        },
        sources: ['https://example.com/a', { url: 'https://example.com/b' }],
        evidence: [{ claim: 'Fact one is supported' }],
        providerReference: 'local-job-1',
        cost: { amount: '0.25', currency: 'USD' },
        latencyMs: 1200,
      },
    });

    expect(report).toMatchObject({
      id: 'verification-passing',
      verifierVersion,
      passed: true,
      score: 1,
      failedRequirements: [],
      memoryRecordId: 'continuity-memory-passing',
    });
    expect(report.reasons[0]).toContain('verification requirements passed');
    expect(provider.records).toHaveLength(1);
    expect(provider.records[0]).toMatchObject({
      category: 'experience',
      missionId: mission.id,
      agentId: 'agent-a',
      capability: 'fact-verification',
      success: true,
      verification: { status: 'PASS', verifierVersion },
      providerReference: 'local-job-1',
      cost: { amount: '0.25', currency: 'USD' },
      latencyMs: 1200,
      tags: ['result-verification', 'verification-passing'],
    });
    expect(provider.events).toHaveLength(1);
  });

  it('rejects an incomplete self-reported success and records an explained failure', async () => {
    const { provider, service } = setup('failing');

    const report = await service.verify({
      mission,
      agent: { id: 'agent-a', provider: 'local-test' },
      capability: 'fact-verification',
      result: {
        claimedSuccess: true,
        output: {
          details: 'This is an unsupported and unverified result.',
          status: 'failed',
          success: true,
        },
        sources: ['https://example.com/only-one'],
      },
    });

    expect(report.passed).toBe(false);
    expect(report.score).toBeLessThan(1);
    expect(report.failedRequirements).toEqual(
      expect.arrayContaining([
        'requiredField:summary',
        'requiredField:facts',
        'basicConsistency',
        'requiredSources',
        'evidencePresence',
        'requiredTerm:verified',
        'prohibitedTerm:unverified',
      ]),
    );
    expect(report.reasons).toEqual(
      expect.arrayContaining([
        'Required field "summary" is missing or empty.',
        'Only 1 distinct valid sources were supplied; 2 are required.',
        'Supporting evidence is required but missing.',
      ]),
    );
    expect(provider.records).toHaveLength(1);
    expect(provider.records[0]).toMatchObject({
      category: 'failure',
      agentId: 'agent-a',
      success: false,
      verification: { status: 'FAIL', verifierVersion },
      failureReason: expect.stringContaining('Required field "summary"'),
      recommendation: expect.stringContaining('Penalize agent-a'),
    });
    expect(provider.records[0]?.result).not.toContain('unsupported and unverified result');
    expect(provider.events).toHaveLength(1);
  });

  it('does not let a duplicated source satisfy a multi-source requirement', async () => {
    const provider = new MockMemoryProvider();
    const report = await new VerificationService(
      new MemoryService(provider, logger),
      logger,
    ).verify({
      mission,
      agent: { id: 'agent-a', provider: 'local-test' },
      capability: 'fact-verification',
      result: {
        output: {
          summary: 'A superficially complete answer',
          sources: ['https://example.com/source', 'https://example.com/source'],
          evidence: ['Claim supported'],
        },
        claimedSuccess: true,
      },
    });

    expect(report).toMatchObject({
      passed: false,
      failedRequirements: expect.arrayContaining(['requiredSources']),
    });
    expect(provider.records.at(-1)).toMatchObject({
      category: 'failure',
      failureReason: expect.stringContaining('1 distinct valid sources'),
    });
  });

  it('makes a verification failure available to future memory-driven selection', async () => {
    const { provider, memory, service } = setup('future-decision');
    await service.verify({
      mission: { ...mission, constraints: { requiredFields: ['summary'] } },
      agent: { id: 'agent-a', provider: 'local-test' },
      capability: 'fact-verification',
      result: { claimedSuccess: true, output: {} },
    });
    const failure = provider.records[0]!;
    provider.searchResult = [
      {
        record: failure,
        sibylRecordId: 'sibyl-verification-failure',
        sibylTier: 'entity',
      },
    ];

    const registry = new InMemoryAgentRegistry();
    registry.register(agent('agent-a', '0.10'));
    registry.register(agent('agent-b', '0.50'));
    const decision = await new DecisionEngine(registry, memory, {
      now: () => new Date('2026-08-21T13:00:00.000Z'),
    }).decide(mission, ['fact-verification']);

    expect(decision.selectedAgent.id).toBe('agent-b');
    expect(decision.reason).toContain('Sibyl evidence penalized');
    expect(decision.memoryReferences).toEqual(['sibyl-verification-failure']);
  });
});

function agent(id: 'agent-a' | 'agent-b', amount: string): LocalTestAgent {
  return {
    id,
    name: `[LOCAL TEST] ${id}`,
    source: 'LOCAL_TEST',
    provider: 'local-test',
    capabilities: ['fact-verification'],
    status: 'AVAILABLE',
    cost: { model: 'FIXED', amount, currency: 'USD' },
    metadata: { synthetic: true },
  };
}
