import { z } from 'zod';

export const missionStatusSchema = z.enum([
  'CREATED',
  'PLANNING',
  'EXECUTING',
  'WAITING',
  'VERIFYING',
  'RECOVERING',
  'FAILED',
  'COMPLETED',
  'CANCELLED',
]);
export const createMissionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1),
  budget: z.number().nonnegative().optional(),
  currency: z.string().trim().max(16).optional(),
  constraints: z.record(z.unknown()).optional(),
});
export const updateMissionSchema = createMissionSchema.partial().extend({
  status: missionStatusSchema.optional(),
  currentStep: z.number().int().nonnegative().optional(),
  nextAction: z.string().trim().optional(),
});
