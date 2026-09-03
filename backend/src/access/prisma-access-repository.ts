import { randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  AccessInvitationResult,
  AccessPrincipal,
  AccessRole,
  BetaAccessRequest,
  OrganizationAccessMember,
} from './access.js';
import type { AccessRepository, ApproveAccessRequestInput } from './access-repository.js';

function request(record: {
  id: string;
  email: string;
  role: string;
  workflow: string | null;
  status: string;
  consentToContact: boolean;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
  reviewNote: string | null;
}): BetaAccessRequest {
  return {
    id: record.id,
    email: record.email,
    role: record.role,
    ...(record.workflow ? { workflow: record.workflow } : {}),
    status: record.status as BetaAccessRequest['status'],
    consentToContact: record.consentToContact,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.reviewedAt ? { reviewedAt: record.reviewedAt } : {}),
    ...(record.reviewNote ? { reviewNote: record.reviewNote } : {}),
  };
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 55);
  return `${base || 'workspace'}-${randomBytes(5).toString('hex')}`;
}

export class PrismaAccessRepository implements AccessRepository {
  constructor(private readonly client: PrismaClient) {}

  async listRequests(): Promise<readonly BetaAccessRequest[]> {
    return (await this.client.betaSignup.findMany({ orderBy: { createdAt: 'desc' } })).map(request);
  }

  async approveRequest(input: ApproveAccessRequestInput): Promise<AccessInvitationResult> {
    return this.client.$transaction(async (transaction) => {
      const signup = await transaction.betaSignup.findUnique({ where: { id: input.requestId } });
      if (!signup) throw new Error('Beta access request not found');
      if (!signup.consentToContact) throw new Error('Beta access request has no contact consent');
      if (signup.status !== 'PENDING')
        throw new Error('Only a pending access request can be approved');
      const organization = await transaction.organization.create({
        data: {
          name: input.organizationName,
          slug: slug(input.organizationName),
          mode: input.organizationMode,
          spendingEnabled: input.organizationMode === 'JUDGE' ? false : input.spendingEnabled,
          maximumMissionBudget: new Prisma.Decimal(input.maximumMissionBudget),
          maximumAcpJobUsdc: new Prisma.Decimal(input.maximumAcpJobUsdc),
        },
      });
      const invitation = await transaction.accessInvitation.create({
        data: {
          betaSignupId: signup.id,
          organizationId: organization.id,
          email: signup.email,
          role: input.organizationMode === 'JUDGE' ? 'JUDGE' : input.role,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
      });
      await transaction.betaSignup.update({
        where: { id: signup.id },
        data: { status: 'APPROVED', reviewedAt: new Date(), reviewNote: null },
      });
      return {
        invitationId: invitation.id,
        token: input.token,
        email: invitation.email,
        organizationId: organization.id,
        organizationName: organization.name,
        role: invitation.role as AccessRole,
        expiresAt: invitation.expiresAt,
      };
    });
  }

  async reissueInvitation(input: {
    requestId: string;
    token: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AccessInvitationResult> {
    return this.client.$transaction(async (transaction) => {
      const signup = await transaction.betaSignup.findUnique({ where: { id: input.requestId } });
      if (!signup || signup.status !== 'APPROVED')
        throw new Error('Approved beta access request not found');
      const previous = await transaction.accessInvitation.findFirst({
        where: { betaSignupId: signup.id },
        include: { organization: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!previous) throw new Error('Previous invitation not found');
      await transaction.accessInvitation.updateMany({
        where: { betaSignupId: signup.id, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      const invitation = await transaction.accessInvitation.create({
        data: {
          betaSignupId: signup.id,
          organizationId: previous.organizationId,
          email: signup.email,
          role: previous.role,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
      });
      return {
        invitationId: invitation.id,
        token: input.token,
        email: invitation.email,
        organizationId: previous.organizationId,
        organizationName: previous.organization.name,
        role: invitation.role as AccessRole,
        expiresAt: invitation.expiresAt,
      };
    });
  }

  async rejectRequest(requestId: string, reviewNote?: string): Promise<BetaAccessRequest> {
    return request(
      await this.client.betaSignup.update({
        where: { id: requestId },
        data: { status: 'REJECTED', reviewedAt: new Date(), reviewNote: reviewNote ?? null },
      }),
    );
  }

  async listMembers(organizationId: string): Promise<readonly OrganizationAccessMember[]> {
    return (
      await this.client.organizationMember.findMany({
        where: { organizationId },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      })
    ).map(({ user, role, createdAt }) => ({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: role as AccessRole,
      status: user.status,
      joinedAt: createdAt,
    }));
  }

  async createMemberInvitation(input: {
    organizationId: string;
    email: string;
    role: AccessRole;
    token: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AccessInvitationResult> {
    const organization = await this.client.organization.findUnique({
      where: { id: input.organizationId },
    });
    if (!organization) throw new Error('Organization not found');
    const existing = await this.client.accessUser.findUnique({
      where: { email: input.email },
      include: { memberships: true },
    });
    if (
      existing?.memberships.some(({ organizationId }) => organizationId === input.organizationId)
    ) {
      throw new Error('That user is already a workspace member');
    }
    await this.client.accessInvitation.updateMany({
      where: { organizationId: input.organizationId, email: input.email, status: 'PENDING' },
      data: { status: 'REVOKED' },
    });
    const invitation = await this.client.accessInvitation.create({
      data: {
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
    return {
      invitationId: invitation.id,
      token: input.token,
      email: invitation.email,
      organizationId: organization.id,
      organizationName: organization.name,
      role: invitation.role as AccessRole,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(input: { tokenHash: string; name: string; passwordHash: string }) {
    return this.client.$transaction(async (transaction) => {
      const invitation = await transaction.accessInvitation.findUnique({
        where: { tokenHash: input.tokenHash },
      });
      if (!invitation || invitation.status !== 'PENDING' || invitation.expiresAt <= new Date()) {
        throw new Error('Invitation is invalid or expired');
      }
      const user = await transaction.accessUser.upsert({
        where: { email: invitation.email },
        create: { email: invitation.email, name: input.name, passwordHash: input.passwordHash },
        // Joining another workspace must never reset an existing account's
        // credentials. The single-use email invitation authorizes membership.
        update: { status: 'ACTIVE' },
      });
      await transaction.organizationMember.upsert({
        where: {
          organizationId_userId: { organizationId: invitation.organizationId, userId: user.id },
        },
        create: {
          organizationId: invitation.organizationId,
          userId: user.id,
          role: invitation.role,
        },
        update: { role: invitation.role },
      });
      const consumed = await transaction.accessInvitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
      if (consumed.count !== 1) throw new Error('Invitation was already accepted');
      return { userId: user.id, organizationId: invitation.organizationId };
    });
  }

  async findLogin(email: string) {
    const user = await this.client.accessUser.findUnique({
      where: { email },
      include: { memberships: { orderBy: { createdAt: 'asc' } } },
    });
    if (!user || user.status !== 'ACTIVE') return null;
    return {
      userId: user.id,
      passwordHash: user.passwordHash,
      organizationIds: user.memberships.map(({ organizationId }) => organizationId),
    };
  }

  async createSession(input: {
    userId: string;
    organizationId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    const membership = await this.client.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: input.organizationId, userId: input.userId },
      },
    });
    if (!membership) throw new Error('Organization membership not found');
    const session = await this.client.accessSession.create({ data: input });
    const principal = await this.principal(session.tokenHash);
    if (!principal) throw new Error('Session principal could not be created');
    return principal;
  }

  findSession(tokenHash: string): Promise<AccessPrincipal | null> {
    return this.principal(tokenHash);
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.client.accessSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async principal(tokenHash: string): Promise<AccessPrincipal | null> {
    const session = await this.client.accessSession.findUnique({
      where: { tokenHash },
      include: { user: true, organization: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'ACTIVE'
    )
      return null;
    const membership = await this.client.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: session.organizationId, userId: session.userId },
      },
    });
    if (!membership) return null;
    return {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      organizationId: session.organization.id,
      organizationName: session.organization.name,
      organizationMode: session.organization.mode as AccessPrincipal['organizationMode'],
      role: membership.role as AccessRole,
      spendingEnabled: session.organization.spendingEnabled,
      maximumMissionBudget: session.organization.maximumMissionBudget.toString(),
      maximumAcpJobUsdc: session.organization.maximumAcpJobUsdc.toString(),
      sessionId: session.id,
    };
  }
}
