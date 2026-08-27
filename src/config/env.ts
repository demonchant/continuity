import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),
  SIBYL_API_KEY: z.string().min(1).optional(),
  SIBYL_BASE_URL: z.string().url().optional(),
  VIRTUALS_API_KEY: z.string().min(1).optional(),
  BASE_RPC_URL: z.string().url().optional(),
  BASE_PRIVATE_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}

export const env = parseEnv();
