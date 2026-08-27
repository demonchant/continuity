CREATE TABLE "BetaSignup" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" VARCHAR(50) NOT NULL,
    "workflow" TEXT,
    "consentToContact" BOOLEAN NOT NULL,
    "publicAttributionConsent" BOOLEAN NOT NULL DEFAULT false,
    "attributionName" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BetaSignup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BetaSignup_email_key" ON "BetaSignup"("email");
CREATE INDEX "BetaSignup_createdAt_idx" ON "BetaSignup"("createdAt");
