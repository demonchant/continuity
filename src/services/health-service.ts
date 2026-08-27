import type { HealthRepository } from '../repositories/health-repository.js';

export class HealthService {
  constructor(private readonly repository: HealthRepository) {}
  async check() {
    try {
      await this.repository.checkDatabase();
      return { status: 'ok' as const, database: 'ok' as const };
    } catch {
      return { status: 'degraded' as const, database: 'unavailable' as const };
    }
  }
}
