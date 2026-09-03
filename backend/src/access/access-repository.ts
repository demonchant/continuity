import type {
  AccessInvitationResult,
  AccessPrincipal,
  AccessRole,
  BetaAccessRequest,
  OrganizationAccessMember,
} from './access.js';

export interface ApproveAccessRequestInput {
  readonly requestId: string;
  readonly organizationName: string;
  readonly organizationMode: 'CUSTOMER' | 'JUDGE';
  readonly role: AccessRole;
  readonly spendingEnabled: boolean;
  readonly maximumMissionBudget: string;
  readonly maximumAcpJobUsdc: string;
  readonly token: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface AccessRepository {
  listRequests(): Promise<readonly BetaAccessRequest[]>;
  approveRequest(input: ApproveAccessRequestInput): Promise<AccessInvitationResult>;
  reissueInvitation(input: {
    readonly requestId: string;
    readonly token: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<AccessInvitationResult>;
  rejectRequest(requestId: string, reviewNote?: string): Promise<BetaAccessRequest>;
  listMembers(organizationId: string): Promise<readonly OrganizationAccessMember[]>;
  createMemberInvitation(input: {
    readonly organizationId: string;
    readonly email: string;
    readonly role: AccessRole;
    readonly token: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<AccessInvitationResult>;
  acceptInvitation(input: {
    tokenHash: string;
    name: string;
    passwordHash: string;
  }): Promise<{ readonly userId: string; readonly organizationId: string }>;
  findLogin(email: string): Promise<{
    readonly userId: string;
    readonly passwordHash: string;
    readonly organizationIds: readonly string[];
  } | null>;
  createSession(input: {
    userId: string;
    organizationId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AccessPrincipal>;
  findSession(tokenHash: string): Promise<AccessPrincipal | null>;
  revokeSession(tokenHash: string): Promise<void>;
}
