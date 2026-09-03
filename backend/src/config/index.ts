import { parseEnvironment } from './environment.js';

export interface ApplicationConfig {
  readonly service: {
    readonly name: 'continuity-api';
    readonly version: string;
  };
  readonly runtime: {
    readonly environment: 'development' | 'test' | 'production';
    readonly port: number;
    readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
    readonly shutdownTimeoutMs: number;
    readonly headersTimeoutMs?: number;
    readonly requestTimeoutMs?: number;
    readonly keepAliveTimeoutMs?: number;
    readonly corsAllowedOrigins?: readonly string[];
  };
  readonly database: {
    readonly url: string;
  };
  readonly access?: {
    readonly publicUrl: string;
    readonly inviteTtlHours: number;
    readonly sessionTtlHours: number;
    readonly resendApiKey?: string;
    readonly emailFrom?: string;
    readonly adminEmail?: string;
  };
  readonly security?: {
    readonly operatorToken?: string;
    readonly rateLimitWindowMs: number;
    readonly rateLimitMaxRequests: number;
  };
  readonly memory: {
    readonly enabled: boolean;
    readonly command: string;
    readonly callTimeoutMs?: number;
    readonly databasePath?: string;
    readonly credentialsPath?: string;
  };
  readonly virtuals: {
    readonly enabled: boolean;
    readonly walletAddress?: `0x${string}`;
    readonly walletId?: string;
    readonly signerPrivateKey?: string;
    readonly builderCode?: string;
    readonly discoveryAccessToken?: string;
    readonly discoveryRefreshToken?: string;
    readonly discoveryCredentialKey?: string;
    readonly discoveryTimeoutMs?: number;
    readonly chainId: number;
    readonly maxJobUsdc: number;
    readonly pollIntervalMs: number;
    readonly jobTimeoutMs: number;
    readonly operatorToken?: string;
  };
  readonly base: {
    readonly enabled: boolean;
    readonly network: 'base' | 'base-sepolia';
    readonly chainId?: number;
    readonly rpcUrl: string;
    readonly rpcTimeoutMs?: number;
    readonly rpcRetryCount?: number;
    readonly privateKey?: `0x${string}`;
    readonly paymentRecipient?: `0x${string}`;
    readonly paymentAsset: 'ETH' | 'USDC';
    readonly tokenAddress?: `0x${string}`;
    readonly maxPaymentAmount: string;
    readonly confirmations: number;
    readonly operatorToken?: string;
  };
  readonly runner: {
    readonly maximumRetries: number;
    readonly timeoutMs: number;
    readonly failureThreshold: number;
    readonly candidateLimit: number;
  };
}

export function loadConfig(input: NodeJS.ProcessEnv = process.env): ApplicationConfig {
  const environment = parseEnvironment(input);

  return Object.freeze({
    service: Object.freeze({ name: 'continuity-api' as const, version: '0.1.0' }),
    runtime: Object.freeze({
      environment: environment.NODE_ENV,
      port: environment.PORT,
      logLevel: environment.LOG_LEVEL,
      shutdownTimeoutMs: environment.SHUTDOWN_TIMEOUT_MS,
      headersTimeoutMs: environment.HTTP_HEADERS_TIMEOUT_MS,
      requestTimeoutMs: environment.HTTP_REQUEST_TIMEOUT_MS,
      keepAliveTimeoutMs: environment.HTTP_KEEP_ALIVE_TIMEOUT_MS,
      corsAllowedOrigins: environment.CORS_ALLOWED_ORIGINS,
    }),
    database: Object.freeze({ url: environment.DATABASE_URL }),
    access: Object.freeze({
      publicUrl: environment.PUBLIC_APP_URL,
      inviteTtlHours: environment.ACCESS_INVITE_TTL_HOURS,
      sessionTtlHours: environment.ACCESS_SESSION_TTL_HOURS,
      ...(environment.RESEND_API_KEY ? { resendApiKey: environment.RESEND_API_KEY } : {}),
      ...(environment.ACCESS_EMAIL_FROM ? { emailFrom: environment.ACCESS_EMAIL_FROM } : {}),
      ...(environment.BETA_ADMIN_EMAIL ? { adminEmail: environment.BETA_ADMIN_EMAIL } : {}),
    }),
    security: Object.freeze({
      ...(environment.CONTINUITY_OPERATOR_TOKEN
        ? { operatorToken: environment.CONTINUITY_OPERATOR_TOKEN }
        : {}),
      rateLimitWindowMs: environment.RATE_LIMIT_WINDOW_MS,
      rateLimitMaxRequests: environment.RATE_LIMIT_MAX_REQUESTS,
    }),
    memory: Object.freeze({
      enabled: environment.MEMORY_ENABLED,
      command: environment.SIBYL_MCP_COMMAND,
      callTimeoutMs: environment.SIBYL_CALL_TIMEOUT_MS,
      ...(environment.SIBYL_MEMORY_DB ? { databasePath: environment.SIBYL_MEMORY_DB } : {}),
      ...(environment.SIBYL_CREDENTIALS ? { credentialsPath: environment.SIBYL_CREDENTIALS } : {}),
    }),
    virtuals: Object.freeze({
      enabled: environment.VIRTUALS_ENABLED,
      ...(environment.VIRTUALS_WALLET_ADDRESS
        ? { walletAddress: environment.VIRTUALS_WALLET_ADDRESS as `0x${string}` }
        : {}),
      ...(environment.VIRTUALS_WALLET_ID ? { walletId: environment.VIRTUALS_WALLET_ID } : {}),
      ...(environment.VIRTUALS_SIGNER_PRIVATE_KEY
        ? { signerPrivateKey: environment.VIRTUALS_SIGNER_PRIVATE_KEY }
        : {}),
      ...(environment.VIRTUALS_BUILDER_CODE
        ? { builderCode: environment.VIRTUALS_BUILDER_CODE }
        : {}),
      ...(environment.VIRTUALS_DISCOVERY_OAUTH_ACCESS_TOKEN
        ? { discoveryAccessToken: environment.VIRTUALS_DISCOVERY_OAUTH_ACCESS_TOKEN }
        : {}),
      ...(environment.VIRTUALS_DISCOVERY_OAUTH_REFRESH_TOKEN
        ? { discoveryRefreshToken: environment.VIRTUALS_DISCOVERY_OAUTH_REFRESH_TOKEN }
        : {}),
      ...(environment.VIRTUALS_DISCOVERY_CREDENTIAL_KEY
        ? { discoveryCredentialKey: environment.VIRTUALS_DISCOVERY_CREDENTIAL_KEY }
        : {}),
      discoveryTimeoutMs: environment.VIRTUALS_DISCOVERY_TIMEOUT_MS,
      chainId: environment.VIRTUALS_CHAIN_ID,
      maxJobUsdc: environment.VIRTUALS_MAX_JOB_USDC,
      pollIntervalMs: environment.VIRTUALS_POLL_INTERVAL_MS,
      jobTimeoutMs: environment.VIRTUALS_JOB_TIMEOUT_MS,
      ...(environment.VIRTUALS_OPERATOR_TOKEN
        ? { operatorToken: environment.VIRTUALS_OPERATOR_TOKEN }
        : {}),
    }),
    base: Object.freeze({
      enabled: environment.BASE_ENABLED,
      network: environment.BASE_NETWORK,
      chainId: environment.BASE_CHAIN_ID ?? (environment.BASE_NETWORK === 'base' ? 8453 : 84532),
      rpcUrl:
        environment.BASE_RPC_URL ??
        (environment.BASE_NETWORK === 'base'
          ? 'https://mainnet.base.org'
          : 'https://sepolia.base.org'),
      rpcTimeoutMs: environment.BASE_RPC_TIMEOUT_MS,
      rpcRetryCount: environment.BASE_RPC_RETRY_COUNT,
      ...(environment.BASE_PRIVATE_KEY
        ? { privateKey: environment.BASE_PRIVATE_KEY as `0x${string}` }
        : {}),
      ...(environment.BASE_PAYMENT_RECIPIENT
        ? { paymentRecipient: environment.BASE_PAYMENT_RECIPIENT as `0x${string}` }
        : {}),
      paymentAsset: environment.BASE_PAYMENT_ASSET,
      ...(environment.BASE_PAYMENT_ASSET === 'USDC'
        ? {
            tokenAddress: (environment.BASE_TOKEN_ADDRESS ??
              '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`,
          }
        : {}),
      maxPaymentAmount: environment.BASE_MAX_PAYMENT_AMOUNT,
      confirmations: environment.BASE_CONFIRMATIONS,
      ...(environment.BASE_OPERATOR_TOKEN
        ? { operatorToken: environment.BASE_OPERATOR_TOKEN }
        : {}),
    }),
    runner: Object.freeze({
      maximumRetries: environment.RUNNER_MAX_RETRIES,
      timeoutMs: environment.RUNNER_TIMEOUT_MS,
      failureThreshold: environment.RUNNER_FAILURE_THRESHOLD,
      candidateLimit: environment.RUNNER_CANDIDATE_LIMIT,
    }),
  });
}

export { parseEnvironment } from './environment.js';
export type { Environment } from './environment.js';
