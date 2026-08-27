import type { PrismaClient } from '@prisma/client';
import type { BetaSignupInput, BetaSignupRecord, BetaSignupRepository } from './beta-signup.js';

export class PrismaBetaSignupRepository implements BetaSignupRepository {
  constructor(private readonly client: PrismaClient) {}

  async upsert(input: BetaSignupInput): Promise<BetaSignupRecord> {
    const record = await this.client.betaSignup.upsert({
      where: { email: input.email },
      create: {
        email: input.email,
        role: input.role,
        consentToContact: input.consentToContact,
        publicAttributionConsent: input.publicAttributionConsent,
        ...(input.workflow ? { workflow: input.workflow } : {}),
        ...(input.attributionName ? { attributionName: input.attributionName } : {}),
      },
      update: {
        role: input.role,
        workflow: input.workflow ?? null,
        consentToContact: input.consentToContact,
        publicAttributionConsent: input.publicAttributionConsent,
        attributionName: input.attributionName ?? null,
      },
    });
    return {
      id: record.id,
      email: record.email,
      role: record.role as BetaSignupInput['role'],
      ...(record.workflow ? { workflow: record.workflow } : {}),
      consentToContact: true,
      publicAttributionConsent: record.publicAttributionConsent,
      ...(record.attributionName ? { attributionName: record.attributionName } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
