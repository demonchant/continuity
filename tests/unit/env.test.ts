import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

describe('environment validation', () => {
  it('accepts required configuration', () =>
    expect(
      parseEnv({ NODE_ENV: 'test', PORT: '3000', DATABASE_URL: 'postgresql://localhost/db' })
        .NODE_ENV,
    ).toBe('test'));
  it('rejects missing database URL', () =>
    expect(() => parseEnv({ NODE_ENV: 'test', PORT: '3000' })).toThrow(/DATABASE_URL/));
});
