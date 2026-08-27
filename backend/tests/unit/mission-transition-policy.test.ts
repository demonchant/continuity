import { describe, expect, it } from 'vitest';
import type { MissionStatus } from '../../src/missions/mission.js';
import { isMissionTransitionAllowed } from '../../src/missions/mission-transition-policy.js';

const mainLifecycle: readonly [MissionStatus, MissionStatus][] = [
  ['CREATED', 'PLANNING'],
  ['PLANNING', 'SELECTING_AGENT'],
  ['SELECTING_AGENT', 'EXECUTING'],
  ['EXECUTING', 'VERIFYING'],
  ['VERIFYING', 'COMPLETED'],
];

describe('mission transition policy', () => {
  it.each(mainLifecycle)('allows %s -> %s', (current, target) => {
    expect(isMissionTransitionAllowed(current, target)).toBe(true);
  });

  it.each<MissionStatus>([
    'CREATED',
    'PLANNING',
    'SELECTING_AGENT',
    'EXECUTING',
    'VERIFYING',
    'RECOVERING',
  ])('allows cancellation from nonterminal %s', (current) => {
    expect(isMissionTransitionAllowed(current, 'CANCELLED')).toBe(true);
  });

  it.each<[MissionStatus, MissionStatus]>([
    ['CREATED', 'COMPLETED'],
    ['PLANNING', 'EXECUTING'],
    ['SELECTING_AGENT', 'VERIFYING'],
    ['COMPLETED', 'CANCELLED'],
    ['FAILED', 'RECOVERING'],
    ['CANCELLED', 'PLANNING'],
    ['EXECUTING', 'EXECUTING'],
  ])('rejects %s -> %s', (current, target) => {
    expect(isMissionTransitionAllowed(current, target)).toBe(false);
  });
});
