import { inferMissionCapabilities } from '../agents/mission-agent-candidates.js';
import type { JsonObject, JsonValue, Mission } from '../missions/mission.js';

export interface MissionRunLimits {
  readonly maximumRetries: number;
  readonly timeoutMs: number;
  readonly failureThreshold: number;
  readonly candidateLimit: number;
}

export interface ParsedMissionPlan {
  readonly capabilities: readonly string[];
  readonly requirements: JsonObject;
  readonly budgetCurrency: string;
  readonly requireBaseAction: boolean;
  readonly baseAction?: {
    readonly purpose: 'MISSION_SUCCESS_SETTLEMENT';
    readonly amount: string;
    readonly asset?: string;
  };
  readonly limits: MissionRunLimits;
}

export interface MissionPlanCaps {
  readonly maximumRetries: number;
  readonly timeoutMs: number;
  readonly failureThreshold: number;
  readonly candidateLimit: number;
}

function object(value: JsonValue | undefined): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function strings(value: JsonValue | undefined): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function boundedInteger(
  value: JsonValue | undefined,
  fallback: number,
  minimum: number,
  cap: number,
) {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(Math.max(value, minimum), cap)
    : fallback;
}

export function parseMissionPlan(
  mission: Pick<Mission, 'objective' | 'constraints'>,
  caps: MissionPlanCaps,
): ParsedMissionPlan {
  const runner = object(mission.constraints.runner);
  const acpRequirements = object(mission.constraints.acpRequirements);
  const baseAction = object(mission.constraints.baseAction);
  const requireBaseAction =
    mission.constraints.requireBaseAction === true || baseAction?.required === true;
  const baseActionAmount =
    typeof baseAction?.amount === 'string' && /^\d+(?:\.\d{1,18})?$/.test(baseAction.amount)
      ? baseAction.amount
      : undefined;
  if (requireBaseAction && baseAction?.purpose !== 'MISSION_SUCCESS_SETTLEMENT') {
    throw new Error(
      'Required Base action purpose must be MISSION_SUCCESS_SETTLEMENT; ACP funding pays the provider separately',
    );
  }
  if (requireBaseAction && !baseActionAmount) {
    throw new Error('Required Base mission settlement must declare a positive decimal amount');
  }
  const capabilities = [
    ...new Set([
      ...inferMissionCapabilities(mission.objective),
      ...strings(mission.constraints.capabilities),
    ]),
  ];
  return {
    capabilities,
    // Provider offerings define their own input schema. Keep orchestration
    // controls out of the ACP payload when an explicit provider input exists.
    requirements: acpRequirements ?? mission.constraints,
    budgetCurrency:
      typeof mission.constraints.budgetCurrency === 'string'
        ? mission.constraints.budgetCurrency.toUpperCase()
        : typeof baseAction?.asset === 'string'
          ? baseAction.asset.toUpperCase()
          : 'USDC',
    requireBaseAction,
    ...(requireBaseAction && baseActionAmount
      ? {
          baseAction: {
            purpose: 'MISSION_SUCCESS_SETTLEMENT' as const,
            amount: baseActionAmount,
            ...(typeof baseAction?.asset === 'string'
              ? { asset: baseAction.asset.toUpperCase() }
              : {}),
          },
        }
      : {}),
    limits: {
      maximumRetries: boundedInteger(runner?.maximumRetries, 0, 0, 0),
      timeoutMs: boundedInteger(
        runner?.timeoutMs,
        Math.min(15 * 60_000, caps.timeoutMs),
        1_000,
        caps.timeoutMs,
      ),
      failureThreshold: boundedInteger(
        runner?.failureThreshold,
        Math.min(2, caps.failureThreshold),
        1,
        caps.failureThreshold,
      ),
      candidateLimit: boundedInteger(
        runner?.candidateLimit,
        Math.min(5, caps.candidateLimit),
        1,
        caps.candidateLimit,
      ),
    },
  };
}
