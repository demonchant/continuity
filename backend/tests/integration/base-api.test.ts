import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { HealthService } from '../../src/api/health/health-service.js';
import type { ApplicationConfig } from '../../src/config/index.js';
import type { BasePaymentService } from '../../src/integrations/base/base-payment-service.js';
import type { BaseTransactionRepository } from '../../src/integrations/base/base-transaction-repository.js';
import { MissionService } from '../../src/missions/mission-service.js';
import { InMemoryMissionRepository } from '../support/in-memory-mission-repository.js';

const operatorToken = 'base-operator-token-at-least-20-characters';
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
    enabled: true,
    network: 'base-sepolia',
    rpcUrl: 'https://sepolia.base.org',
    paymentAsset: 'ETH',
    maxPaymentAmount: '0.001',
    confirmations: 1,
    operatorToken,
  },
  runner: { maximumRetries: 2, timeoutMs: 900000, failureThreshold: 3, candidateLimit: 10 },
};

describe('Base application API', () => {
  it('exposes authenticated payment and transaction receipt routes', async () => {
    const missions = new MissionService(new InMemoryMissionRepository());
    const mission = await missions.create({
      objective: 'Pay selected agent',
      constraints: {},
      budget: '0.001',
    });
    const transaction = {
      id: '00000000-0000-4000-8000-000000000010',
      transactionHash: `0x${'c'.repeat(64)}`,
      network: 'base-sepolia',
      status: 'CONFIRMED',
      amount: '0.0001',
    };
    const pay = vi.fn().mockResolvedValue(transaction);
    const findById = vi.fn().mockResolvedValue(transaction);
    const app = createApp({
      config,
      logger: pino({ level: 'silent' }),
      healthService: new HealthService({ check: () => Promise.resolve() }),
      missionService: missions,
      base: {
        payments: { pay } as unknown as BasePaymentService,
        transactions: { findById } as unknown as BaseTransactionRepository,
        operatorToken,
      },
    });
    const payload = {
      missionId: mission.id,
      actionId: 'pay-1',
      paymentId: 'payment-1',
      agentId: 'virtuals:agent',
      amount: '0.0001',
      verificationId: 'verification-base-api',
    };
    expect((await request(app).post('/api/v1/base/payments').send(payload)).status).toBe(401);
    for (const authorization of [
      `bearer ${operatorToken}`,
      `Bearer ${operatorToken} extra`,
      `Basic ${operatorToken}`,
    ]) {
      expect(
        (
          await request(app)
            .post('/api/v1/base/payments')
            .set('authorization', authorization)
            .send(payload)
        ).status,
      ).toBe(401);
    }
    expect(pay).not.toHaveBeenCalled();
    const malformed = await request(app)
      .post('/api/v1/base/payments')
      .set('authorization', `Bearer ${operatorToken}`)
      .send({ ...payload, amount: '-1', actionId: '' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    expect(pay).not.toHaveBeenCalled();
    const paid = await request(app)
      .post('/api/v1/base/payments')
      .set('authorization', `Bearer ${operatorToken}`)
      .send(payload);
    expect(paid.status).toBe(200);
    expect(paid.body.data).toMatchObject({
      transactionHash: transaction.transactionHash,
      status: 'CONFIRMED',
    });
    expect(pay).toHaveBeenCalledWith(
      expect.objectContaining({
        mission: expect.objectContaining({ id: mission.id }),
        paymentId: 'payment-1',
      }),
    );
    const visible = await request(app)
      .get(`/api/v1/base/transactions/${transaction.id}`)
      .set('authorization', `Bearer ${operatorToken}`);
    expect(visible.status).toBe(200);
    expect(visible.body.data.transactionHash).toBe(transaction.transactionHash);
  });
});
