export const betaRoles = [
  'AGENT_DEVELOPER',
  'AUTONOMOUS_AGENT_BUILDER',
  'MULTI_AGENT_TEAM',
] as const;

export type BetaRole = (typeof betaRoles)[number];

export interface BetaSignupInput {
  readonly email: string;
  readonly role: BetaRole;
  readonly workflow?: string;
  readonly consentToContact: true;
  readonly publicAttributionConsent: boolean;
  readonly attributionName?: string;
}

export interface BetaSignupRecord extends BetaSignupInput {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BetaSignupRepository {
  upsert(input: BetaSignupInput): Promise<BetaSignupRecord>;
}
