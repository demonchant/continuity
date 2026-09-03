import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { HealthService } from '../../src/api/health/health-service.js';
import type { ApplicationConfig } from '../../src/config/index.js';
import type { EconomicActionService } from '../../src/economics/economic-action-service.js';
import { MissionService } from '../../src/missions/mission-service.js';
import { InMemoryMissionRepository } from '../support/in-memory-mission-repository.js';

const token = 'economic-operator-token-at-least-20-characters';
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

describe('economic decision UI and API', () => {
  it('shows the Sibyl-to-decision-to-Base chain and returns its evidence', async () => {
    const missions = new MissionService(new InMemoryMissionRepository());
    const mission = await missions.create({
      objective: 'Research and verify X',
      constraints: {},
      budget: '1.00',
    });
    const result = {
      decision: {
        selectedAgent: { id: 'agent-b', name: 'Agent B' },
        expectedOutcome: { verifiedSuccessProbability: 0.95 },
        estimatedCost: { amount: '0.80', currency: 'USDC' },
        historicalEvidence: [{ agentId: 'agent-b', memoryReferences: ['sibyl-success-b'] }],
        reason: 'Agent B has stronger comparable verified history.',
        memoryReferences: ['sibyl-success-b'],
      },
      baseAction: { status: 'NOT_REQUESTED' },
    };
    const execute = vi.fn().mockResolvedValue(result);
    const app = createApp({
      config,
      logger: pino({ level: 'silent' }),
      healthService: new HealthService({ check: () => Promise.resolve() }),
      missionService: missions,
      economics: { service: { execute } as unknown as EconomicActionService, operatorToken: token },
    });

    const dashboard = await request(app).get('/economic-decisions');
    expect(dashboard.status).toBe(302);
    expect(dashboard.headers.location).toBe('/dashboard/missions');

    const payload = {
      missionId: mission.id,
      capabilities: ['research'],
      budgetCurrency: 'USDC',
      executeBase: false,
      actionId: 'economic-1',
      paymentId: 'payment-1',
    };
    expect(
      (await request(app).post('/api/v1/economic-decisions/execute').send(payload)).status,
    ).toBe(401);
    const response = await request(app)
      .post('/api/v1/economic-decisions/execute')
      .set('authorization', `Bearer ${token}`)
      .send(payload);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject(result);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        mission: expect.objectContaining({ id: mission.id }),
        budgetCurrency: 'USDC',
      }),
    );
  });
});
