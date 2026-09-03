ALTER TABLE "BetaSignup"
ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
ADD COLUMN "reviewedAt" TIMESTAMPTZ(3),
ADD COLUMN "reviewNote" VARCHAR(500);

CREATE TABLE "Organization" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "mode" VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER',
  "spendingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "maximumMissionBudget" DECIMAL(20,8) NOT NULL DEFAULT 1,
  "maximumAcpJobUsdc" DECIMAL(20,8) NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccessUser" (
  "id" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "passwordHash" VARCHAR(500) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AccessUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationMember" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" VARCHAR(30) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccessInvitation" (
  "id" UUID NOT NULL,
  "betaSignupId" UUID,
  "organizationId" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "role" VARCHAR(30) NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AccessInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccessSession" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Mission" ADD COLUMN "organizationId" UUID;

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "AccessUser_email_key" ON "AccessUser"("email");
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");
CREATE UNIQUE INDEX "AccessInvitation_tokenHash_key" ON "AccessInvitation"("tokenHash");
CREATE INDEX "AccessInvitation_email_status_idx" ON "AccessInvitation"("email", "status");
CREATE INDEX "AccessInvitation_betaSignupId_idx" ON "AccessInvitation"("betaSignupId");
CREATE UNIQUE INDEX "AccessSession_tokenHash_key" ON "AccessSession"("tokenHash");
CREATE INDEX "AccessSession_userId_expiresAt_idx" ON "AccessSession"("userId", "expiresAt");
CREATE INDEX "AccessSession_organizationId_expiresAt_idx" ON "AccessSession"("organizationId", "expiresAt");
CREATE INDEX "AccessSession_expiresAt_idx" ON "AccessSession"("expiresAt");
CREATE INDEX "Mission_organizationId_createdAt_idx" ON "Mission"("organizationId", "createdAt");

ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AccessUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessInvitation" ADD CONSTRAINT "AccessInvitation_betaSignupId_fkey" FOREIGN KEY ("betaSignupId") REFERENCES "BetaSignup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccessInvitation" ADD CONSTRAINT "AccessInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessSession" ADD CONSTRAINT "AccessSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AccessUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessSession" ADD CONSTRAINT "AccessSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
