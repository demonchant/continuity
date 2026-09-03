import { describe, expect, it } from 'vitest';
import { parseMissionPlan } from '../../src/runner/mission-plan.js';

describe('production mission plan', () => {
  it('enforces zero retries even when a mission requests more', () => {
    const plan = parseMissionPlan(
      {
        objective: 'Research and verify an answer',
        constraints: { runner: { maximumRetries: 99 } },
      },
      { maximumRetries: 5, timeoutMs: 900_000, failureThreshold: 3, candidateLimit: 10 },
    );
    expect(plan.limits.maximumRetries).toBe(0);
  });

  it('sends only explicit offering input to ACP providers', () => {
    const plan = parseMissionPlan(
      {
        objective: 'Create a sourced crypto news brief',
        constraints: {
          capabilities: ['crypto news research'],
          acpRequirements: { topic: 'AI agents on Base', timeframe: '24h', focus: 'analysis' },
          runner: { maximumRetries: 0 },
        },
      },
      { maximumRetries: 2, timeoutMs: 900_000, failureThreshold: 3, candidateLimit: 10 },
    );

    expect(plan.requirements).toEqual({
      topic: 'AI agents on Base',
      timeframe: '24h',
      focus: 'analysis',
    });
  });
});
