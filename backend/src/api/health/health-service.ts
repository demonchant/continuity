import type { DatabaseHealthRepository } from './health-repository.js';

export interface HealthCheckResult {
  readonly status: 'ok' | 'degraded';
  readonly database: {
    readonly status: 'connected' | 'unavailable';
  };
}

export class HealthService {
  constructor(private readonly database: DatabaseHealthRepository) {}

  async check(): Promise<HealthCheckResult> {
    try {
      await this.database.check();
      return { status: 'ok', database: { status: 'connected' } };
    } catch {
      return { status: 'degraded', database: { status: 'unavailable' } };
    }
  }
}
