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
});
