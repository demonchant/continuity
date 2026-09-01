import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { HealthService } from '../../src/api/health/health-service.js';
import type { ApplicationConfig } from '../../src/config/index.js';
import { DashboardService } from '../../src/dashboard/dashboard-service.js';
import type { MemoryRecord, RecalledMemory } from '../../src/memory/memory-record.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import { MissionService } from '../../src/missions/mission-service.js';
import { InMemoryBaseTransactionRepository } from '../support/in-memory-base-transaction-repository.js';
import { InMemoryMissionRepository } from '../support/in-memory-mission-repository.js';
import { InMemoryVirtualsJobRepository } from '../support/in-memory-virtuals-job-repository.js';
import { MockMemoryProvider } from '../support/mock-memory-provider.js';

const logger = pino({ level: 'silent' });
const config: ApplicationConfig = {
  service: { name: 'continuity-api', version: '0.1.0' },
  runtime: { environment: 'test', port: 3000, logLevel: 'silent', shutdownTimeoutMs: 5000 },
  database: { url: 'postgresql://user:password@localhost:5432/test' },
  memory: { enabled: true, command: 'sibyl-memory-mcp' },
  virtuals: {
    enabled: false,
    chainId: 8453,
    maxJobUsdc: 1,
    pollIntervalMs: 5000,
    jobTimeoutMs: 900000,
  },
  base: {
    enabled: false,
    network: 'base-sepolia',
    rpcUrl: 'https://sepolia.base.org',
    paymentAsset: 'USDC',
    tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    maxPaymentAmount: '1.00',
    confirmations: 1,
  },
  runner: { maximumRetries: 2, timeoutMs: 900000, failureThreshold: 3, candidateLimit: 10 },
};

function memoryRecord(
  input: Partial<MemoryRecord> & Pick<MemoryRecord, 'id' | 'category' | 'agentId'>,
  missionId: string,
): RecalledMemory {
  const record: MemoryRecord = {
    schemaVersion: 1,
    timestamp: '2026-08-22T12:00:00.000Z',
    missionId,
    mission: 'Research and verify information about X',
    capability: 'fact-verification',
    agentProvider: 'virtuals',
    ...input,
  };
  return { record, sibylRecordId: `sibyl-${record.id}`, sibylTier: 'WARM' };
}

describe('Phase 13 dashboard and Phase 14 Judge Mode', () => {
  it('serves the responsive SPA and a safe memory-driven mission projection', async () => {
    const missions = new MissionService(new InMemoryMissionRepository());
    const mission = await missions.create({
      objective: 'Research and verify information about X',
      constraints: { requiredSources: 1 },
      budget: '1.00',
    });
    const provider = new MockMemoryProvider();
    provider.searchResult = [
      memoryRecord(
        {
          id: 'failure-a',
          category: 'failure',
          agentId: 'agent-a',
          success: false,
          failureReason: 'Failed verification twice',
          verification: { status: 'FAIL', summary: 'Unsupported result', score: 0.25 },
        },
        'historical-a',
      ),
      memoryRecord(
        {
          id: 'success-b',
          category: 'experience',
          agentId: 'agent-b',
          success: true,
          verification: { status: 'PASS', summary: 'All checks passed', score: 1 },
          cost: { amount: '0.80', currency: 'USDC' },
        },
        'historical-b',
      ),
      memoryRecord(
        {
          id: 'decision-b',
          category: 'decision',
          agentId: 'agent-b',
          decisionReason: 'Agent B was more reliable for comparable verified research.',
          confidence: 0.88,
          cost: { amount: '0.80', currency: 'USDC' },
          memoryReferences: ['sibyl-failure-a', 'sibyl-success-b'],
          decisionCandidates: [
            {
              agentId: 'agent-b',
              name: 'Agent B',
              offeringName: 'research',
              capabilities: ['fact-verification'],
              price: { amount: '0.80', currency: 'USDC' },
              compatible: true,
              compatibilityScore: 1,
              compatibilityReasons: ['Exact offering capability match.'],
              observationCount: 1,
              successRate: 1,
              verificationSuccessRate: 1,
              failurePatterns: [],
              historicalScore: 1,
              costScore: 0.5,
              finalScore: 0.85,
              memoryReferences: ['sibyl-success-b'],
              selected: true,
            },
          ],
        },
        mission.id,
      ),
      memoryRecord(
        {
          id: 'outcome-b',
          category: 'outcome',
          agentId: 'agent-b',
          timestamp: '2026-08-22T13:00:00.000Z',
          success: true,
          result: 'Agent B succeeded on the comparable verified research mission.',
          verification: { status: 'PASS', summary: 'All checks passed', score: 1 },
        },
        mission.id,
      ),
    ];
    const jobs = new InMemoryVirtualsJobRepository();
    const job = await jobs.createOrGet({
      missionId: mission.id,
      actionId: 'execute-1',
      externalJobId: 'virtuals-job-1',
      chainId: 84532,
      agentId: 'agent-b',
      providerAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      offeringName: 'research',
      requirement: {},
    });
    await jobs.update({
      id: job.id,
      state: 'COMPLETED',
      verification: {
        id: 'verification-1',
        passed: true,
        score: 1,
        verifierVersion: 'continuity-deterministic-v1',
        reasons: ['All checks passed.'],
      },
    });
    const transactions = new InMemoryBaseTransactionRepository();
    const transaction = await transactions.createOrGet({
      missionId: mission.id,
      actionId: 'base-action-1',
      paymentId: 'payment-1',
      agentId: 'agent-b',
      network: 'base-sepolia',
      chainId: 84532,
      action: 'AGENT_PAYMENT',
      recipient: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      amount: '0.80',
      asset: 'USDC',
    });
    await transactions.update({
      id: transaction.id,
      status: 'CONFIRMED',
      transactionHash: `0x${'1'.repeat(64)}`,
      blockNumber: 123n,
      confirmations: 1,
      explorerUrl: `https://sepolia.basescan.org/tx/0x${'1'.repeat(64)}`,
    });
    await missions.transition(mission.id, 'PLANNING');
    await missions.transition(mission.id, 'SELECTING_AGENT');
    await missions.transition(mission.id, 'EXECUTING');
    await missions.transition(mission.id, 'VERIFYING');
    await missions.transition(mission.id, 'COMPLETED');
    const memory = new MemoryService(provider, logger);
    const dashboard = new DashboardService(missions, memory, jobs, transactions);
    const application = createApp({
      config,
      logger,
      healthService: new HealthService({ check: () => Promise.resolve() }),
      missionService: missions,
      dashboard,
    });

    const page = await request(application).get(`/dashboard/missions/${mission.id}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Autonomous operations');
    expect(page.text).toContain('/continuity-ui/app.js');
    const client = await request(application).get('/continuity-ui/app.js');
    expect(client.status).toBe(200);
    expect(client.text).toContain('WHY THIS AGENT?');
    expect(client.text).toContain('What was written afterward');
    expect(client.text).toContain('DASHBOARD_AUTH_REQUIRED');
    expect(client.text).toContain('operator-token');
    expect((await request(application).get('/dashboard/judge')).status).toBe(200);

    const response = await request(application).get(`/api/v1/dashboard/missions/${mission.id}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      mission: { id: mission.id },
      decision: {
        selectedAgentId: 'agent-b',
        confidence: 0.88,
        memoryReferences: ['sibyl-failure-a', 'sibyl-success-b'],
        candidates: [{ agentId: 'agent-b', offeringName: 'research', selected: true }],
        why: expect.arrayContaining([
          expect.stringContaining('historical outcome'),
          expect.stringContaining('verification rate'),
          expect.stringContaining('agent-a recorded'),
          expect.stringContaining('within mission budget'),
        ]),
      },
      memory: {
        trace: {
          impact: {
            level: 'LOAD_BEARING',
            citedCount: 2,
            resolvedCount: 2,
          },
          affectedDecision: [
            { sibylRecordId: 'sibyl-failure-a' },
            { sibylRecordId: 'sibyl-success-b' },
          ],
          writtenAfterward: [
            {
              sibylRecordId: 'sibyl-outcome-b',
              result: 'Agent B succeeded on the comparable verified research mission.',
            },
          ],
          outcome: { sibylRecordId: 'sibyl-outcome-b', success: true },
        },
      },
      jobs: [{ externalJobId: 'virtuals-job-1', state: 'COMPLETED' }],
      transactions: [{ status: 'CONFIRMED', blockNumber: '123' }],
    });
    expect(response.body.data.jobs[0].providerAddress).toBe(
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    expect(JSON.stringify(response.body)).not.toContain('privateKey');
    expect(JSON.stringify(response.body)).not.toContain('operatorToken');

    const publicOverview = await request(application).get('/api/v1/judge/overview');
    expect(publicOverview.status).toBe(200);
    expect(publicOverview.body.data.missions).toEqual([
      expect.objectContaining({ id: mission.id, status: 'COMPLETED' }),
    ]);
    const publicReceipt = await request(application).get(`/api/v1/judge/missions/${mission.id}`);
    expect(publicReceipt.status).toBe(200);
    expect(publicReceipt.body.data).toMatchObject({
      mission: { id: mission.id, status: 'COMPLETED' },
      jobs: [{ externalJobId: 'virtuals-job-1' }],
      transactions: [{ status: 'CONFIRMED' }],
    });
  });

  it('renders honest empty provenance when Sibyl returns no mission memory', async () => {
    const missions = new MissionService(new InMemoryMissionRepository());
    const mission = await missions.create({
      objective: 'Research and verify a new topic',
      constraints: {},
      budget: '1.00',
    });
    const memory = new MemoryService(new MockMemoryProvider(), logger);
    const dashboard = new DashboardService(missions, memory);

    const detail = await dashboard.missionDetail(mission.id);

    expect(detail.memory.trace).toMatchObject({
      remembered: [],
      retrieved: [],
      affectedDecision: [],
      writtenAfterward: [],
      outcome: null,
      impact: {
        level: 'AWAITING_DECISION',
        citedCount: 0,
        resolvedCount: 0,
      },
    });
    expect(detail.decision).toBeNull();

    const application = createApp({
      config,
      logger,
      healthService: new HealthService({ check: () => Promise.resolve() }),
      missionService: missions,
      dashboard,
    });
    expect((await request(application).get('/api/v1/judge/overview')).body.data.missions).toEqual(
      [],
    );
    expect((await request(application).get(`/api/v1/judge/missions/${mission.id}`)).status).toBe(
      404,
    );
  });
});
