import type { MissionStatus } from './mission.js';

const allowedTransitions: Readonly<Record<MissionStatus, readonly MissionStatus[]>> = {
  CREATED: ['QUEUED', 'PLANNING', 'FAILED', 'CANCELLED'],
  QUEUED: ['PLANNING', 'RECOVERING', 'FAILED', 'CANCELLED'],
  PLANNING: ['SELECTING_AGENT', 'RECOVERING', 'FAILED', 'CANCELLED'],
  SELECTING_AGENT: ['EXECUTING', 'RECOVERING', 'FAILED', 'CANCELLED'],
  EXECUTING: ['AWAITING_FUNDING_APPROVAL', 'VERIFYING', 'FAILED', 'RECOVERING', 'CANCELLED'],
  AWAITING_FUNDING_APPROVAL: ['QUEUED', 'RECOVERING', 'FAILED', 'CANCELLED'],
  VERIFYING: ['AWAITING_BASE_APPROVAL', 'COMPLETED', 'FAILED', 'RECOVERING', 'CANCELLED'],
  AWAITING_BASE_APPROVAL: ['QUEUED', 'RECOVERING', 'FAILED', 'CANCELLED'],
  RECOVERING: [
    'PLANNING',
    'SELECTING_AGENT',
    'EXECUTING',
    'AWAITING_FUNDING_APPROVAL',
    'VERIFYING',
    'AWAITING_BASE_APPROVAL',
    'FAILED',
    'CANCELLED',
  ],
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
  AWAITING_FUNDING_APPROVAL: 'awaiting-funding-approval',
  VERIFYING: 'verifying',
  AWAITING_BASE_APPROVAL: 'awaiting-base-approval',
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
