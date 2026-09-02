import 'dotenv/config';
import { z } from 'zod';

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const encodedCredentialKeyPattern = /^(?:[A-Za-z0-9+/]{43}=?|[A-Za-z0-9_-]{43}=?|[0-9a-fA-F]{64})$/;

function normalizeSecretInput(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return trimmed.length >= 2 && (quote === '"' || quote === "'") && trimmed.at(-1) === quote
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: logLevelSchema.default('info'),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
    HTTP_HEADERS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    HTTP_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().url()).max(20)),
    CONTINUITY_OPERATOR_TOKEN: z.string().min(20).optional(),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).max(10_000).default(120),
    DATABASE_URL: z
      .string()
      .url('must be a valid PostgreSQL URL')
      .refine(
        (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
        'must use the postgresql:// or postgres:// protocol',
      ),
    MEMORY_ENABLED: booleanString.default('true'),
    SIBYL_MCP_COMMAND: z.string().trim().min(1).default('sibyl-memory-mcp'),
    SIBYL_CALL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    SIBYL_MEMORY_DB: z.string().trim().min(1).optional(),
    SIBYL_CREDENTIALS: z.string().trim().min(1).optional(),
    VIRTUALS_ENABLED: booleanString.default('false'),
    VIRTUALS_WALLET_ADDRESS: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
    VIRTUALS_WALLET_ID: z.string().trim().min(1).optional(),
    VIRTUALS_SIGNER_PRIVATE_KEY: z.string().trim().min(1).optional(),
    VIRTUALS_BUILDER_CODE: z.string().trim().min(1).optional(),
    VIRTUALS_DISCOVERY_OAUTH_ACCESS_TOKEN: z.string().trim().min(20).optional(),
    VIRTUALS_DISCOVERY_OAUTH_REFRESH_TOKEN: z.string().trim().min(20).optional(),
    VIRTUALS_DISCOVERY_CREDENTIAL_KEY: z
      .string()
      .transform(normalizeSecretInput)
      .refine(
        (value) => encodedCredentialKeyPattern.test(value),
        'must encode exactly 32 bytes as base64, base64url, or 64-character hex',
      )
      .optional(),
    VIRTUALS_DISCOVERY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    VIRTUALS_CHAIN_ID: z.coerce.number().int().positive().default(8453),
    VIRTUALS_MAX_JOB_USDC: z.coerce.number().positive().default(1),
    VIRTUALS_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(5000),
    VIRTUALS_JOB_TIMEOUT_MS: z.coerce.number().int().min(1000).default(900000),
    VIRTUALS_OPERATOR_TOKEN: z.string().min(20).optional(),
    BASE_ENABLED: booleanString.default('false'),
    BASE_NETWORK: z.enum(['base', 'base-sepolia']).default('base-sepolia'),
    BASE_CHAIN_ID: z.coerce.number().int().positive().optional(),
    BASE_RPC_URL: z.string().url().optional(),
    BASE_RPC_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
    BASE_RPC_RETRY_COUNT: z.coerce.number().int().min(0).max(5).default(2),
    BASE_PRIVATE_KEY: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
    BASE_PAYMENT_RECIPIENT: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
    BASE_PAYMENT_ASSET: z.enum(['ETH', 'USDC']).default('ETH'),
    BASE_TOKEN_ADDRESS: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
    BASE_MAX_PAYMENT_AMOUNT: z
      .string()
      .regex(/^\d+(?:\.\d{1,18})?$/)
      .default('0.001'),
    BASE_CONFIRMATIONS: z.coerce.number().int().min(1).max(64).default(1),
    BASE_OPERATOR_TOKEN: z.string().min(20).optional(),
    BASE_ALLOW_MAINNET: booleanString.default('false'),
    RUNNER_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    RUNNER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(900_000),
    RUNNER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(10).default(3),
    RUNNER_CANDIDATE_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
  })
  .superRefine((value, context) => {
    if (value.HTTP_HEADERS_TIMEOUT_MS > value.HTTP_REQUEST_TIMEOUT_MS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['HTTP_HEADERS_TIMEOUT_MS'],
        message: 'must not exceed HTTP_REQUEST_TIMEOUT_MS',
      });
    }
    if (value.NODE_ENV === 'production' && !value.MEMORY_ENABLED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MEMORY_ENABLED'],
        message: 'must be true in production; Sibyl is load-bearing',
      });
    }
    if (value.NODE_ENV === 'production' && !value.CONTINUITY_OPERATOR_TOKEN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CONTINUITY_OPERATOR_TOKEN'],
        message: 'is required in production to protect mission and dashboard operations',
      });
    }
    if (value.VIRTUALS_ENABLED) {
      for (const key of [
        'VIRTUALS_WALLET_ADDRESS',
        'VIRTUALS_WALLET_ID',
        'VIRTUALS_SIGNER_PRIVATE_KEY',
        'VIRTUALS_DISCOVERY_OAUTH_ACCESS_TOKEN',
        'VIRTUALS_DISCOVERY_OAUTH_REFRESH_TOKEN',
        'VIRTUALS_DISCOVERY_CREDENTIAL_KEY',
        'VIRTUALS_OPERATOR_TOKEN',
      ] as const) {
        if (!value[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'is required when VIRTUALS_ENABLED=true',
          });
        }
      }
    }
    if (value.BASE_ENABLED) {
      const expectedBaseChainId = value.BASE_NETWORK === 'base' ? 8453 : 84532;
      if (value.BASE_CHAIN_ID !== undefined && value.BASE_CHAIN_ID !== expectedBaseChainId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BASE_CHAIN_ID'],
          message: `must be ${expectedBaseChainId} for BASE_NETWORK=${value.BASE_NETWORK}`,
        });
      }
      for (const key of [
        'BASE_PRIVATE_KEY',
        'BASE_PAYMENT_RECIPIENT',
        'BASE_OPERATOR_TOKEN',
      ] as const) {
        if (!value[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'is required when BASE_ENABLED=true',
          });
        }
      }
      if (value.BASE_NETWORK === 'base' && !value.BASE_ALLOW_MAINNET) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BASE_ALLOW_MAINNET'],
          message: 'must be true for Base mainnet transactions',
        });
      }
      if (
        value.BASE_PAYMENT_ASSET === 'USDC' &&
        value.BASE_NETWORK === 'base' &&
        !value.BASE_TOKEN_ADDRESS
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BASE_TOKEN_ADDRESS'],
          message: 'is required for mainnet USDC payments',
        });
      }
    }
  });

export type Environment = Readonly<z.infer<typeof environmentSchema>>;

function formatEnvironmentError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');
}

export function parseEnvironment(input: NodeJS.ProcessEnv): Environment {
  const result = environmentSchema.safeParse(input);

  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${formatEnvironmentError(result.error)}`);
  }

  return Object.freeze(result.data);
}
