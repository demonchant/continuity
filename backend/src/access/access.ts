export const accessRoles = ['OWNER', 'OPERATOR', 'FINANCE_APPROVER', 'VIEWER', 'JUDGE'] as const;
export type AccessRole = (typeof accessRoles)[number];

export interface AccessPrincipal {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationMode: 'CUSTOMER' | 'JUDGE';
  readonly role: AccessRole;
  readonly spendingEnabled: boolean;
  readonly maximumMissionBudget: string;
  readonly maximumAcpJobUsdc: string;
  readonly sessionId: string;
}

export interface BetaAccessRequest {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly workflow?: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly consentToContact: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly reviewedAt?: Date;
  readonly reviewNote?: string;
}

export interface AccessInvitationResult {
  readonly invitationId: string;
  readonly token: string;
  readonly email: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly role: AccessRole;
  readonly expiresAt: Date;
}

export interface OrganizationAccessMember {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: AccessRole;
  readonly status: string;
  readonly joinedAt: Date;
}
