import type { MissionStatus } from './mission.js';

const allowedTransitions: Readonly<Record<MissionStatus, readonly MissionStatus[]>> = {
  CREATED: ['QUEUED', 'PLANNING', 'FAILED', 'CANCELLED'],
  QUEUED: ['PLANNING', 'RECOVERING', 'FAILED', 'CANCELLED'],
  PLANNING: ['SELECTING_AGENT', 'RECOVERING', 'FAILED', 'CANCELLED'],
  SELECTING_AGENT: ['EXECUTING', 'RECOVERING', 'FAILED', 'CANCELLED'],
  EXECUTING: ['VERIFYING', 'FAILED', 'RECOVERING', 'CANCELLED'],
  VERIFYING: ['COMPLETED', 'FAILED', 'RECOVERING', 'CANCELLED'],
  RECOVERING: ['PLANNING', 'SELECTING_AGENT', 'EXECUTING', 'VERIFYING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

const defaultSteps: Readonly<Record<MissionStatus, string>> = {
  CREATED: 'created',
  QUEUED: 'queued',
  PLANNING: 'planning',
  SELECTING_AGENT: 'selecting-agent',
  EXECUTING: 'executing',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RECOVERING: 'recovering',
  CANCELLED: 'cancelled',
};

export function isMissionTransitionAllowed(
  currentStatus: MissionStatus,
  targetStatus: MissionStatus,
): boolean {
  return allowedTransitions[currentStatus]?.includes(targetStatus) ?? false;
}

export function defaultStepForStatus(status: MissionStatus): string {
  return defaultSteps[status];
}
