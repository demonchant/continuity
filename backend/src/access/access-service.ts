import type { AccessNotificationService, NotificationDelivery } from './access-notifications.js';
import type { AccessPrincipal, AccessRole, BetaAccessRequest } from './access.js';
import { createOpaqueToken, hashOpaqueToken } from './access-token.js';
import type { AccessRepository } from './access-repository.js';
import { hashPassword, verifyPassword } from './password.js';
import { AppError } from '../shared/errors/app-error.js';

export class AccessService {
  constructor(
    private readonly repository: AccessRepository,
    private readonly notifications: AccessNotificationService,
    private readonly options: {
      readonly publicUrl: string;
      readonly inviteTtlHours: number;
      readonly sessionTtlHours: number;
    },
  ) {}

  listRequests(): Promise<readonly BetaAccessRequest[]> {
    return this.repository.listRequests();
  }

  async approve(input: {
    readonly requestId: string;
    readonly organizationName: string;
    readonly organizationMode: 'CUSTOMER' | 'JUDGE';
    readonly role: AccessRole;
    readonly spendingEnabled: boolean;
    readonly maximumMissionBudget: string;
    readonly maximumAcpJobUsdc: string;
  }): Promise<{
    readonly inviteUrl: string;
    readonly delivery: NotificationDelivery;
    readonly expiresAt: Date;
  }> {
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.options.inviteTtlHours * 3_600_000);
    let invitation;
    try {
      invitation = await this.repository.approveRequest({
        ...input,
        token,
        tokenHash: hashOpaqueToken(token),
        expiresAt,
      });
    } catch (error) {
      throw new AppError({
        statusCode: 409,
        code: 'ACCESS_APPROVAL_FAILED',
        message: error instanceof Error ? error.message : 'Access request could not be approved',
      });
    }
    const inviteUrl = `${this.options.publicUrl.replace(/\/$/, '')}/access/invite?token=${encodeURIComponent(token)}`;
    const delivery = await this.notifications.sendInvitation(invitation, inviteUrl);
    return { inviteUrl, delivery, expiresAt };
  }

  async reject(requestId: string, reviewNote?: string): Promise<BetaAccessRequest> {
    try {
      return await this.repository.rejectRequest(requestId, reviewNote);
    } catch {
      throw new AppError({
        statusCode: 404,
        code: 'ACCESS_REQUEST_NOT_FOUND',
        message: 'Beta access request not found',
      });
    }
  }

  async reissue(requestId: string) {
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.options.inviteTtlHours * 3_600_000);
    let invitation;
    try {
      invitation = await this.repository.reissueInvitation({
        requestId,
        token,
        tokenHash: hashOpaqueToken(token),
        expiresAt,
      });
    } catch (error) {
      throw new AppError({
        statusCode: 409,
        code: 'INVITATION_REISSUE_FAILED',
        message: error instanceof Error ? error.message : 'Invitation could not be reissued',
      });
    }
    const inviteUrl = `${this.options.publicUrl.replace(/\/$/, '')}/access/invite?token=${encodeURIComponent(token)}`;
    const delivery = await this.notifications.sendInvitation(invitation, inviteUrl);
    return { inviteUrl, delivery, expiresAt };
  }

  listMembers(organizationId: string) {
    return this.repository.listMembers(organizationId);
  }

  async inviteMember(input: {
    readonly organizationId: string;
    readonly email: string;
    readonly role: AccessRole;
  }) {
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.options.inviteTtlHours * 3_600_000);
    let invitation;
    try {
      invitation = await this.repository.createMemberInvitation({
        ...input,
        email: input.email.toLowerCase(),
        token,
        tokenHash: hashOpaqueToken(token),
        expiresAt,
      });
    } catch (error) {
      throw new AppError({
        statusCode: 409,
        code: 'MEMBER_INVITATION_FAILED',
        message: error instanceof Error ? error.message : 'Member invitation could not be created',
      });
    }
    const inviteUrl = `${this.options.publicUrl.replace(/\/$/, '')}/access/invite?token=${encodeURIComponent(token)}`;
    const delivery = await this.notifications.sendInvitation(invitation, inviteUrl);
    return { inviteUrl, delivery, expiresAt };
  }

  async acceptInvitation(input: {
    readonly token: string;
    readonly name: string;
    readonly password: string;
  }) {
    const passwordHash = await hashPassword(input.password);
    let identity;
    try {
      identity = await this.repository.acceptInvitation({
        tokenHash: hashOpaqueToken(input.token),
        name: input.name,
        passwordHash,
      });
    } catch {
      throw new AppError({
        statusCode: 400,
        code: 'INVITATION_INVALID',
        message: 'Invitation is invalid, expired, or already used',
      });
    }
    return this.issueSession(identity.userId, identity.organizationId);
  }

  async login(input: {
    readonly email: string;
    readonly password: string;
    readonly organizationId?: string;
  }) {
    const login = await this.repository.findLogin(input.email.toLowerCase());
    // Perform equivalent password work for unknown emails to reduce account
    // enumeration through response timing.
    const valid = login
      ? await verifyPassword(input.password, login.passwordHash)
      : await hashPassword(input.password).then(() => false);
    if (!login || !valid || login.organizationIds.length === 0) {
      throw new AppError({
        statusCode: 401,
        code: 'LOGIN_FAILED',
        message: 'Email or password is incorrect',
      });
    }
    const organizationId = input.organizationId ?? login.organizationIds[0]!;
    if (!login.organizationIds.includes(organizationId)) {
      throw new AppError({
        statusCode: 403,
        code: 'ORGANIZATION_ACCESS_DENIED',
        message: 'Account does not belong to that workspace',
      });
    }
    return this.issueSession(login.userId, organizationId);
  }

  session(token: string): Promise<AccessPrincipal | null> {
    return this.repository.findSession(hashOpaqueToken(token));
  }

  revoke(token: string): Promise<void> {
    return this.repository.revokeSession(hashOpaqueToken(token));
  }

  private async issueSession(userId: string, organizationId: string) {
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.options.sessionTtlHours * 3_600_000);
    const principal = await this.repository.createSession({
      userId,
      organizationId,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
    });
    return { token, expiresAt, principal };
  }
}
