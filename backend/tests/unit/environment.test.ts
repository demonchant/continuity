import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { parseEnvironment } from '../../src/config/environment.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '3100',
  LOG_LEVEL: 'silent',
  SHUTDOWN_TIMEOUT_MS: '5000',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/continuity_test',
};

describe('environment validation', () => {
  it('parses and coerces valid configuration', () => {
    const environment = parseEnvironment(validEnvironment);

    expect(environment).toMatchObject({
      NODE_ENV: 'test',
      PORT: 3100,
      LOG_LEVEL: 'silent',
      SHUTDOWN_TIMEOUT_MS: 5000,
      HTTP_HEADERS_TIMEOUT_MS: 15_000,
      HTTP_REQUEST_TIMEOUT_MS: 30_000,
      HTTP_KEEP_ALIVE_TIMEOUT_MS: 5_000,
      MEMORY_ENABLED: true,
      SIBYL_MCP_COMMAND: 'sibyl-memory-mcp',
      SIBYL_CALL_TIMEOUT_MS: 30_000,
      VIRTUALS_ENABLED: false,
      VIRTUALS_CHAIN_ID: 8453,
      BASE_ENABLED: false,
      BASE_NETWORK: 'base-sepolia',
      BASE_RPC_TIMEOUT_MS: 10_000,
      BASE_RPC_RETRY_COUNT: 2,
    });
    expect(Object.isFrozen(environment)).toBe(true);
  });

  it('rejects an HTTP headers timeout that exceeds the request timeout', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        HTTP_HEADERS_TIMEOUT_MS: '30001',
        HTTP_REQUEST_TIMEOUT_MS: '30000',
      }),
    ).toThrow(/HTTP_HEADERS_TIMEOUT_MS.*must not exceed HTTP_REQUEST_TIMEOUT_MS/);
  });

  it('applies safe runtime defaults', () => {
    const environment = parseEnvironment({ DATABASE_URL: validEnvironment.DATABASE_URL });

    expect(environment).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      SHUTDOWN_TIMEOUT_MS: 10_000,
      MEMORY_ENABLED: true,
    });
  });

  it('reports every invalid field without exposing credentials', () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: 'invalid',
        PORT: '70000',
        DATABASE_URL: 'https://example.com/database',
      }),
    ).toThrow(/NODE_ENV.*PORT.*DATABASE_URL/);
  });

  it('builds centralized application configuration', () => {
    const config = loadConfig(validEnvironment);

    expect(config.service.name).toBe('continuity-api');
    expect(config.runtime.port).toBe(3100);
    expect(config.database.url).toBe(validEnvironment.DATABASE_URL);
    expect(config.memory).toMatchObject({ enabled: true, command: 'sibyl-memory-mcp' });
    expect(config.virtuals).toMatchObject({ enabled: false, chainId: 8453, maxJobUsdc: 1 });
    expect(config.base).toMatchObject({
      enabled: false,
      network: 'base-sepolia',
      paymentAsset: 'ETH',
      maxPaymentAmount: '0.001',
    });
  });

  it('refuses to remove the load-bearing Sibyl dependency in production', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        MEMORY_ENABLED: 'false',
      }),
    ).toThrow(/MEMORY_ENABLED.*must be true in production/);
  });

  it('requires a central operator token in production', () => {
    expect(() => parseEnvironment({ ...validEnvironment, NODE_ENV: 'production' })).toThrow(
      /CONTINUITY_OPERATOR_TOKEN.*required in production/,
    );
    expect(
      parseEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        CONTINUITY_OPERATOR_TOKEN: 'continuity-operator-token-at-least-20-characters',
      }).CONTINUITY_OPERATOR_TOKEN,
    ).toContain('continuity-operator');
  });

  it('requires the complete official ACP credential set when Virtuals is enabled', () => {
    expect(() => parseEnvironment({ ...validEnvironment, VIRTUALS_ENABLED: 'true' })).toThrow(
      /VIRTUALS_WALLET_ADDRESS.*VIRTUALS_WALLET_ID.*VIRTUALS_SIGNER_PRIVATE_KEY.*VIRTUALS_DISCOVERY_OAUTH_ACCESS_TOKEN.*VIRTUALS_DISCOVERY_OAUTH_REFRESH_TOKEN.*VIRTUALS_DISCOVERY_CREDENTIAL_KEY.*VIRTUALS_OPERATOR_TOKEN/,
    );

    expect(
      parseEnvironment({
        ...validEnvironment,
        VIRTUALS_ENABLED: 'true',
        VIRTUALS_WALLET_ADDRESS: '0x1111111111111111111111111111111111111111',
        VIRTUALS_WALLET_ID: 'wallet-id',
        VIRTUALS_SIGNER_PRIVATE_KEY: 'signer-private-key',
        VIRTUALS_DISCOVERY_OAUTH_ACCESS_TOKEN: 'oauth-access-token-at-least-20-characters',
        VIRTUALS_DISCOVERY_OAUTH_REFRESH_TOKEN: 'oauth-refresh-token-at-least-20-characters',
        VIRTUALS_DISCOVERY_CREDENTIAL_KEY: Buffer.alloc(32, 7).toString('base64'),
        VIRTUALS_OPERATOR_TOKEN: 'operator-token-at-least-20-characters',
      }).VIRTUALS_ENABLED,
    ).toBe(true);
  });

  it('accepts supported 32-byte discovery credential key encodings', () => {
    const raw = Buffer.alloc(32, 9);
    for (const encoded of [
      raw.toString('base64'),
      raw.toString('base64').replace(/=$/, ''),
      raw.toString('base64url'),
      raw.toString('hex'),
      `"${raw.toString('base64')}"`,
    ]) {
      expect(
        parseEnvironment({
          ...validEnvironment,
          VIRTUALS_DISCOVERY_CREDENTIAL_KEY: encoded,
        }).VIRTUALS_DISCOVERY_CREDENTIAL_KEY,
      ).toBe(encoded.replace(/^"|"$/g, ''));
    }
  });

  it('rejects a discovery credential key that does not encode 32 bytes', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        VIRTUALS_DISCOVERY_CREDENTIAL_KEY: 'not-a-key',
      }),
    ).toThrow(/VIRTUALS_DISCOVERY_CREDENTIAL_KEY.*must encode exactly 32 bytes/);
  });

  it('requires secure payment configuration and explicit mainnet opt-in for Base', () => {
    expect(() => parseEnvironment({ ...validEnvironment, BASE_ENABLED: 'true' })).toThrow(
      /BASE_PRIVATE_KEY.*BASE_PAYMENT_RECIPIENT.*BASE_OPERATOR_TOKEN/,
    );
    const credentials = {
      ...validEnvironment,
      BASE_ENABLED: 'true',
      BASE_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      BASE_PAYMENT_RECIPIENT: '0x2222222222222222222222222222222222222222',
      BASE_OPERATOR_TOKEN: 'base-operator-token-at-least-20-characters',
    };
    expect(parseEnvironment(credentials).BASE_NETWORK).toBe('base-sepolia');
    expect(() => parseEnvironment({ ...credentials, BASE_CHAIN_ID: '8453' })).toThrow(
      /BASE_CHAIN_ID.*84532/,
    );
    expect(loadConfig({ ...credentials, BASE_PAYMENT_ASSET: 'USDC' }).base).toMatchObject({
      paymentAsset: 'USDC',
      tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    });
    expect(() => parseEnvironment({ ...credentials, BASE_NETWORK: 'base' })).toThrow(
      /BASE_ALLOW_MAINNET.*must be true/,
    );
  });
});
