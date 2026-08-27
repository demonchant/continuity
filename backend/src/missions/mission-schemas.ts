import { z } from 'zod';
import type { JsonValue } from './mission.js';

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const decimalBudgetSchema = z
  .string()
  .trim()
  .regex(
    /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/,
    'Budget must be a non-negative decimal with at most 12 integer and 8 fractional digits',
  );

export const createMissionRequestSchema = z
  .object({
    objective: z.string().trim().min(1).max(10_000),
    constraints: z.record(jsonValueSchema).default({}),
    budget: z
      .union([z.string(), z.number().finite().nonnegative()])
      .transform((value) => String(value))
      .pipe(decimalBudgetSchema),
  })
  .strict();

export const missionIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

export type CreateMissionRequest = z.infer<typeof createMissionRequestSchema>;
export type MissionIdParams = z.infer<typeof missionIdParamsSchema>;
