import { SibylMemoryAdapter } from '../integrations/sibyl/sibyl-memory-adapter.js';
import { SibylMcpToolClient } from '../integrations/sibyl/sibyl-tool-client.js';
import { DisabledMemoryProvider, type MemoryProvider } from '../memory/memory-provider.js';
import type { ApplicationConfig } from './index.js';

/**
 * Production composition boundary for the load-bearing memory dependency.
 * Disabled mode is deliberately unavailable rather than an in-process store.
 */
export function createConfiguredMemoryProvider(
  config: ApplicationConfig['memory'],
): MemoryProvider {
  if (!config.enabled) return new DisabledMemoryProvider();
  return new SibylMemoryAdapter(
    new SibylMcpToolClient({
      command: config.command,
      ...(config.callTimeoutMs ? { timeoutMs: config.callTimeoutMs } : {}),
      ...(config.databasePath ? { databasePath: config.databasePath } : {}),
      ...(config.credentialsPath ? { credentialsPath: config.credentialsPath } : {}),
    }),
  );
}
