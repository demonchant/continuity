# Continuity Deployment

This runbook deploys the frontend, backend, PostgreSQL database, and Sibyl Memory as one production service behind HTTPS. It does not treat a local Docker stack as a public deployment.

## Current deployment status

As of 2026-08-27, this workspace has no hosting account connection, public domain, production database, or live Virtuals/Base credentials. The production artifacts are implemented and locally verifiable, but a public HTTPS deployment and complete live mission have **not** been executed from this workspace.

## Topology

```text
Internet
   |
   v
Caddy :443 (automatic HTTPS, security headers, JSON access logs)
   |
   v
Continuity backend :3000 (API plus static frontend)
   |                         |
   v                         v
PostgreSQL              Sibyl MCP subprocess
private network         persistent memory volume
```

Virtuals ACP and Base RPC are outbound-only integrations. PostgreSQL is not published to the host or internet.

The preferred hackathon topology is the checked-in Render Blueprint: one Docker web service serving both frontend and API, one managed PostgreSQL database, and one persistent disk mounted at `/data/sibyl`. The disk forces a single Render instance and is the only safe location for the load-bearing Sibyl SQLite file. Horizontal scaling is unsupported in this release.

## Deployment files

- `backend/Dockerfile`: multi-stage Node build, OpenSSL-compatible Prisma generation, official `sibyl-memory-mcp==0.1.13`, non-root runtime, health check.
- `compose.production.yml`: backend, PostgreSQL 16, Caddy, private network, persistent volumes, startup health dependencies.
- `render.yaml`: one-instance Render Docker service, managed PostgreSQL, durable Sibyl disk, readiness probe, and secret prompts.
- `Caddyfile`: automatic HTTPS, compression, reverse proxy, HSTS, safe response headers, JSON logs.
- `.env.production.example`: names and safe defaults only; no usable secret.
- `backend/prisma/migrations/`: checked-in forward migrations applied before server startup.

## Prerequisites

1. A Linux host with current Docker Engine and Compose.
2. A real DNS A/AAAA record for `CONTINUITY_DOMAIN` pointing to that host.
3. Inbound TCP 80 and TCP/UDP 443 allowed.
4. A secret-management mechanism or a host-readable `.env.production` with mode `0600`.
5. Funded, allowlisted provider credentials only if Virtuals and Base are enabled.

## Secure environment setup

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Replace every `REPLACE_WITH_SECRET` value and placeholder. Generate independent, high-entropy values for:

- `POSTGRES_PASSWORD`
- `CONTINUITY_OPERATOR_TOKEN`
- `VIRTUALS_SIGNER_PRIVATE_KEY`, wallet identifiers, and `VIRTUALS_OPERATOR_TOKEN`
- `VIRTUALS_DISCOVERY_OAUTH_ACCESS_TOKEN` and `VIRTUALS_DISCOVERY_OAUTH_REFRESH_TOKEN`
- `BASE_PRIVATE_KEY` and `BASE_OPERATOR_TOKEN`

Never put secrets in Compose YAML, Docker build arguments, Git, screenshots, logs, issue comments, or `DEPLOYMENT.md`. Production rejects disabled Sibyl memory and incomplete enabled-provider configuration. Base mainnet additionally requires `BASE_ALLOW_MAINNET=true`.

Virtuals discovery OAuth is intentionally separate from the ACP SDK execution signer. Obtain the two discovery values locally with the official `acp configure` browser flow, then copy them directly from the local OS keychain into Render's secret fields without placing them in source or chat. The OAuth client can only call token refresh and `GET /agents/search`; it has no job or wallet methods. Virtuals rotates the refresh token. The running single-instance process keeps the rotated pair in memory, so re-run `acp configure` and replace both Render values before a later restart if the configured refresh token has already been consumed.

## CORS and HTTPS

The recommended deployment serves frontend and API from the same origin, so `CORS_ALLOWED_ORIGINS` remains empty. If a separate trusted frontend is required, set an exact comma-separated HTTPS origin allowlist. Wildcards are not supported. Unlisted preflight requests receive `403`.

Caddy obtains and renews certificates automatically after DNS resolves. Do not claim HTTPS readiness until this succeeds:

```bash
curl --fail --show-error --silent "https://${CONTINUITY_DOMAIN}/api/v1/health"
```

## Build and deploy

### Render Blueprint (preferred)

1. Push the final clean commit to the public repository.
2. Create a Render Blueprint from the repository-root `render.yaml`.
3. Supply every `sync: false` value in Render's secret prompt. Do not put values in the Blueprint.
4. Keep the service at exactly one instance. The attached Sibyl disk intentionally prevents scaling.
5. Wait for `/api/v1/readiness` to report PostgreSQL and Sibyl as connected.

The Docker start command applies checked-in Prisma migrations before starting Node. Render supplies HTTPS at its public service URL. `DATABASE_URL` comes from the Blueprint-managed PostgreSQL service, while `SIBYL_MEMORY_DB=/data/sibyl/memory.db` points inside the attached disk. A free web service cannot be used because persistent disks require a paid instance.

### Self-hosted Compose

Validate interpolation without printing the resulting configuration into public logs, because it contains secrets:

```bash
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml build --pull
docker compose --env-file .env.production -f compose.production.yml up -d
```

For configuration validation against the checked-in placeholder file only, override `CONTINUITY_ENV_FILE=.env.production.example`; never start services with that placeholder file.

The backend command runs `prisma migrate deploy` before `node dist/server.js`. Startup fails in production if PostgreSQL is unavailable. The edge waits for both PostgreSQL and backend health checks.

## Health and route verification

```bash
curl --fail "https://${CONTINUITY_DOMAIN}/"
curl --fail "https://${CONTINUITY_DOMAIN}/dashboard"
curl --fail "https://${CONTINUITY_DOMAIN}/api/v1/health"
curl --fail "https://${CONTINUITY_DOMAIN}/api/v1/readiness"
curl --fail "https://${CONTINUITY_DOMAIN}/continuity-site/app.js"
curl --fail "https://${CONTINUITY_DOMAIN}/continuity-ui/app.js"
```

Expected liveness status is HTTP 200. Readiness is HTTP 200 only when both PostgreSQL and the production Sibyl MCP process are reachable. Neither response contains database URLs or credentials.

Inspect service state and structured logs:

```bash
docker compose --env-file .env.production -f compose.production.yml ps
docker compose --env-file .env.production -f compose.production.yml logs --since=10m backend edge
```

Authorization, cookies, private keys, generic secrets, and tokens are redacted by the application logger. Do not enable trace logging in production unless investigating a bounded incident.

## Partner verification

Run these from a trusted release checkout whose environment targets the deployed HTTPS URL. Never paste their environment into shell history on a shared machine.

### Sibyl

1. Run the cross-process write/read proof with the production Sibyl configuration.
2. Confirm Session B returns the exact entity ID written by Session A.
3. Run `npm run test:memory-gate` to confirm removal eliminates historical selection behavior.

### Virtuals

```bash
cd backend
CONTINUITY_URL="https://${CONTINUITY_DOMAIN}" npm run virtuals:smoke
```

Record the real chain ID, agent ID, and Virtuals external job ID. A 200 response or imported SDK alone is not proof.

### Base

```bash
CONTINUITY_URL="https://${CONTINUITY_DOMAIN}" npm run base:smoke
```

Record the network, transaction hash, and public explorer URL. Never repeat a payment request to obtain a cleaner demo; use its existing idempotency key and reconcile uncertain state.

### Complete mission

```bash
CONTINUITY_URL="https://${CONTINUITY_DOMAIN}" npm run runner:smoke
```

The gate passes only when the mission reaches `COMPLETED`, verification passes, a real Virtuals job ID is present, the required Base transaction is `CONFIRMED`, and Sibyl memory references are returned.

## Production proof record

Populate this table only from the deployed environment. Blank values are not evidence.

| Evidence                    | Value                                                      | Status       |
| --------------------------- | ---------------------------------------------------------- | ------------ |
| Public HTTPS URL            | Not available                                              | NOT EXECUTED |
| Deployment timestamp/commit | Git metadata unavailable in this workspace                 | BLOCKED      |
| PostgreSQL migration count  | 8 on disposable local PostgreSQL                           | LOCAL PASS   |
| Production image            | `continuity-backend:latest`; Sibyl 0.1.13                  | LOCAL PASS   |
| Sibyl entity ID             | Local Docker proof: `ebd5b094-d571-4cd9-974e-916199975754` | LOCAL ONLY   |
| Complete mission ID         | Not executed                                               | NOT EXECUTED |
| Selected Virtuals agent ID  | Not executed                                               | NOT EXECUTED |
| Virtuals external job ID    | Not executed                                               | NOT EXECUTED |
| Verification report ID      | Not executed                                               | NOT EXECUTED |
| Base network                | Not executed                                               | NOT EXECUTED |
| Base transaction hash       | Not executed                                               | NOT EXECUTED |
| Base explorer URL           | Not executed                                               | NOT EXECUTED |

The local Docker proof on 2026-08-27 used controlled simulated agent results and is not Virtuals evidence. It wrote the official cross-process Sibyl database and receipt under a named Docker volume, restarted the backend container, retained identical SHA-256 hashes for both files, and returned HTTP 200 from liveness and readiness afterward. This proves the image, migration startup, official MCP, and durable mount behavior locally; it does not prove a public Render deployment.

## Restart and rollback

Restart only the application and recheck health:

```bash
docker compose --env-file .env.production -f compose.production.yml restart backend
curl --fail "https://${CONTINUITY_DOMAIN}/api/v1/health"
```

Migrations are forward-only. Before a release, take a database backup and preserve the prior immutable image tag. Roll back application code by image digest; do not reverse an applied database migration without a reviewed data migration. PostgreSQL and Sibyl volumes must remain attached across application replacement.

## Known deployment blockers

- No public hosting provider/account is connected to this workspace; `render.yaml` is configuration, not deployment evidence.
- No production domain or ACME contact has been supplied.
- No live Virtuals or Base credentials are available in this process environment.
- No `.git` metadata is present, so an immutable public commit identifier cannot be recorded.

Until those are resolved, the public frontend, live Virtuals job, Base transaction, and complete production mission remain unverified rather than failed or simulated.
