CREATE TABLE "VirtualsDiscoveryCredential" (
    "id" VARCHAR(100) NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authenticationTag" BYTEA NOT NULL,
    "encryptionVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VirtualsDiscoveryCredential_pkey" PRIMARY KEY ("id")
);
