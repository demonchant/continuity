import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { HealthService } from '../../src/api/health/health-service.js';
import type { ApplicationConfig } from '../../src/config/index.js';
import type {
  VirtualsExecutionResult,
  VirtualsExecutionService,
} from '../../src/integrations/virtuals/virtuals-execution-service.js';
import type { VirtualsJobRepository } from '../../src/integrations/virtuals/virtuals-job-repository.js';
import { MissionService } from '../../src/missions/mission-service.js';
import { InMemoryMissionRepository } from '../support/in-memory-mission-repository.js';

const config: ApplicationConfig = {
  service: { name: 'continuity-api', version: '0.1.0' },
  runtime: { environment: 'test', port: 3000, logLevel: 'silent', shutdownTimeoutMs: 5000 },
  database: { url: 'postgresql://user:password@localhost:5432/test' },
  memory: { enabled: true, command: 'sibyl-memory-mcp' },
  virtuals: {
    enabled: true,
    chainId: 8453,
    maxJobUsdc: 1,
    pollIntervalMs: 5000,
    jobTimeoutMs: 900000,
    operatorToken: 'operator-token-at-least-20-characters',
  },
  base: {
    enabled: false,
    network: 'base-sepolia',
    rpcUrl: 'https://sepolia.base.org',
    paymentAsset: 'ETH',
    maxPaymentAmount: '0.001',
    confirmations: 1,
  },
  runner: { maximumRetries: 2, timeoutMs: 900000, failureThreshold: 3, candidateLimit: 10 },
};
const logger = pino({ level: 'silent' });

describe('Virtuals application API', () => {
  it('exposes authenticated read-only discovery, execution, and durable-job routes', async () => {
    const missions = new MissionService(new InMemoryMissionRepository());
    const mission = await missions.create({
      objective: 'Research and verify X',
      constraints: {},
      budget: '1.00',
    });
    const result = {
      job: { id: '00000000-0000-4000-8000-000000000901', state: 'COMPLETED', externalJobId: '901' },
      verification: { passed: true },
      decision: { selectedAgent: { provider: 'virtuals' } },
    } as unknown as VirtualsExecutionResult;
    const execute = vi.fn().mockResolvedValue(result);
    const discover = vi.fn().mockResolvedValue([
      {
        agent: { id: 'virtuals:8453:0xabc', name: 'Public ACP Researcher' },
        chainId: 8453,
        providerAddress: '0xabc',
        offeringName: 'research',
        cost: { amount: '0.25', currency: 'USDC' },
      },
    ]);
    const execution = { execute, discover } as unknown as VirtualsExecutionService;
    const jobs = {
      findById: vi.fn().mockResolvedValue(result.job),
    } as unknown as VirtualsJobRepository;
    const app = createApp({
      config,
      logger,
      healthService: new HealthService({ check: () => Promise.resolve() }),
      missionService: missions,
      virtuals: { execution, jobs, operatorToken: config.virtuals.operatorToken! },
    });

    const denied = await request(app)
      .post('/api/v1/virtuals/execute')
      .send({
        missionId: mission.id,
        actionId: 'job-1',
        capabilities: ['research'],
        requirements: {},
      });
    expect(denied.status).toBe(401);

    const malformedAuth = await request(app)
      .post('/api/v1/virtuals/execute')
      .set('authorization', `Bearer ${config.virtuals.operatorToken} extra`)
      .send({
        missionId: mission.id,
        actionId: 'job-1',
        capabilities: ['research'],
        requirements: {},
      });
    expect(malformedAuth.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();

    const discovery = await request(app)
      .post('/api/v1/virtuals/discovery')
      .set('authorization', `Bearer ${config.virtuals.operatorToken}`)
      .send({
        objective: 'Research and verify X',
        capabilities: ['research'],
        candidateLimit: 10,
      });
    expect(discovery.status).toBe(200);
    expect(discovery.body.data.candidates).toMatchObject([
      { offeringName: 'research', chainId: 8453 },
    ]);
    expect(discover).toHaveBeenCalledWith({
      missionObjective: 'Research and verify X',
      capabilities: ['research'],
      limit: 10,
    });
    expect(execute).not.toHaveBeenCalled();

    const malformed = await request(app)
      .post('/api/v1/virtuals/execute')
      .set('authorization', `Bearer ${config.virtuals.operatorToken}`)
      .send({ missionId: 'not-a-uuid', actionId: '', capabilities: [], requirements: [] });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    expect(execute).not.toHaveBeenCalled();

    const accepted = await request(app)
      .post('/api/v1/virtuals/execute')
      .set('authorization', `Bearer ${config.virtuals.operatorToken}`)
      .send({
        missionId: mission.id,
        actionId: 'job-1',
        capabilities: ['research'],
        requirements: { topic: 'X' },
      });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toMatchObject({
      job: { externalJobId: '901', state: 'COMPLETED' },
      verification: { passed: true },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        mission: expect.objectContaining({ id: mission.id }),
        actionId: 'job-1',
        capabilities: ['research'],
        requirements: { topic: 'X' },
      }),
    );

    const visible = await request(app)
      .get('/api/v1/virtuals/jobs/00000000-0000-4000-8000-000000000901')
      .set('authorization', `Bearer ${config.virtuals.operatorToken}`);
    expect(visible.status).toBe(200);
    expect(visible.body.data.externalJobId).toBe('901');
  });
});
