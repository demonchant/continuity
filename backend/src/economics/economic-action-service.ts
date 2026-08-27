import type { Logger } from 'pino';
import type { BasePaymentService } from '../integrations/base/base-payment-service.js';
import type { VirtualsAgentSource } from '../integrations/virtuals/virtuals-agent-source.js';
import type { Mission } from '../missions/mission.js';
import { AppError } from '../shared/errors/app-error.js';
import type { EconomicExecutionResult } from './economic-decision.js';
import type { EconomicDecisionService } from './economic-decision-service.js';

export class EconomicActionService {
  constructor(
    private readonly source: VirtualsAgentSource,
    private readonly decisions: EconomicDecisionService,
    private readonly basePayments: BasePaymentService | undefined,
    private readonly logger: Logger,
  ) {}

  async execute(input: {
    readonly mission: Pick<Mission, 'id' | 'objective' | 'budget'>;
    readonly capabilities: readonly string[];
    readonly budgetCurrency: string;
    readonly candidateLimit?: number;
    readonly executeBase: boolean;
    readonly actionId: string;
    readonly paymentId: string;
  }): Promise<EconomicExecutionResult> {
    const candidates = await this.source.discoverCandidates({
      missionObjective: input.mission.objective,
      capabilities: input.capabilities,
      ...(input.candidateLimit ? { limit: input.candidateLimit } : {}),
    });
    const decision = await this.decisions.decide({
      mission: input.mission,
      candidates: candidates.map(({ agent }) => agent),
      capabilities: input.capabilities,
      budgetCurrency: input.budgetCurrency,
    });
    if (!input.executeBase) return { decision, baseAction: { status: 'NOT_REQUESTED' } };
    if (!this.basePayments) {
      throw new AppError({
        statusCode: 503,
        code: 'BASE_INTEGRATION_UNAVAILABLE',
        message: 'Base mission settlement is not enabled',
      });
    }
    this.logger.warn(
      { event: 'economic.base.blocked', missionId: input.mission.id },
      'Decision-only economic endpoint cannot execute a Base settlement',
    );
    throw new AppError({
      statusCode: 422,
      code: 'BASE_REQUIRES_VERIFIED_MISSION',
      message:
        'Base is a distinct mission success settlement and may run only through the verified mission runner after ACP verification',
    });
  }
}
