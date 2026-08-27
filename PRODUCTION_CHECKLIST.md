# Continuity Production Checklist

Last updated: 2026-08-27

## Build and dependency integrity

- [x] Root clean install completed with `npm ci`.
- [x] Backend clean install completed with `npm ci`.
- [x] Prisma Client regenerated after the clean install.
- [x] Backend strict TypeScript typecheck passed.
- [x] Backend lint passed.
- [x] Backend build passed.
- [x] Backend formatting passed after applying the clean install's formatter version.
- [x] Root production dependency audit reports zero vulnerabilities after a scoped `deepmerge-ts@8.0.2` override.
- [x] Runtime `ws` advisory mitigated with a scoped lockfile override to `8.21.3` for `@ethersproject/providers`.
- [ ] Remaining official Virtuals transitive audit findings resolved upstream. Current no-fix findings are documented under Known limitations.

## Database

- [x] Isolated PostgreSQL 16 fixture created on `127.0.0.1:55441`.
- [x] All ten migrations applied to the disposable `continuity_phase35` database.
- [x] Migration command reported ten completed migrations.
- [x] Query indexes added for ordered mission, Virtuals job, Base transaction, and recovery-action reads.
- [x] Database-backed mission, recovery, Virtuals, Base, and connectivity suites passed.

## API and security

- [x] Production fails startup when PostgreSQL is unavailable.
- [x] Production refuses `MEMORY_ENABLED=false`.
- [x] HTTP header, request, keep-alive, Sibyl MCP, and Base RPC timeouts are bounded and configurable.
- [x] Base RPC retries are bounded and delayed.
- [x] Disabled Virtuals/Base adapters are dynamically imported only when enabled; production startup no longer pays unused partner SDK initialization cost.
- [x] Mission retry, timeout, failure-threshold, candidate, budget, and idempotency limits remain enforced.
- [x] Mission, Base, Virtuals, economics, beta, dashboard, and runner request schemas reject unknown fields where applicable.
- [x] JSON request body limit reduced to 256 KiB.
- [x] API responses use `Cache-Control: no-store`.
- [x] CORS is deny-by-default with an exact HTTPS-origin allowlist.
- [x] Helmet security headers remain enabled.
- [x] Authorization, cookies, private keys, secrets, and tokens are covered by structured-log redaction paths.
- [x] Production examples contain placeholders, not usable database or provider credentials.
- [x] No public endpoint exposes the beta waitlist or its count.

## Frontend and routes

- [x] Public landing page includes problem, product, demo, honest evidence status, private beta, loading, success, and error behavior.
- [x] Dashboard includes loading, retryable error, empty, and mission-memory states.
- [x] External Google Fonts dependency removed from the dashboard.
- [x] Landing, dashboard, static asset, health, mission, dashboard API, beta, and not-found routes are covered by integration tests.
- [x] No testimonials, partner logos, users, or production data are fabricated.

## Test evidence

- [x] Full clean-database backend suite passed on 2026-08-27: 39 files, 160 tests, 0 skipped, 0 failed.
- [x] Aggregate root suite passed on 2026-08-27: 43 files, 168 tests, 0 skipped, 0 failed with `TEST_DATABASE_URL` supplied.
- [x] Load-bearing Sibyl deletion gate passed in the full suite.
- [x] Two-process PostgreSQL recovery/idempotency test passed in the full suite.
- [x] Phase 17 adversarial tests remain included in the passing suite.
- [x] Post-format HTTP/CORS suite passed: 1 file, 8 tests.

## Restart and mission verification

- [x] PostgreSQL durable restart/recovery is covered by distinct Node processes and persisted receipts.
- [x] Two compiled `NODE_ENV=production` backend processes started cleanly around a graceful shutdown; process B recovered mission `58eb8789-894e-4b4a-8582-88f9969448e4` from PostgreSQL.
- [x] Health, landing page, dashboard, and Sibyl-backed overview returned success before/after the local backend restart.
- [ ] Two complete provider-backed mission runs with a backend restart executed in this environment.
- [ ] Complete public production mission executed.
- [ ] Live Virtuals external job ID recorded.
- [ ] Live Base transaction hash and explorer URL recorded.

These mission items are blocked because this process has no Virtuals or Base credentials. The application will not enable the runner without the complete credential sets, and mocks will not be presented as production proof.

## Deployment

- [x] Multi-stage non-root backend container defined.
- [x] Official `sibyl-memory-mcp==0.1.13` pinned in the runtime image.
- [x] Production image `continuity-backend:latest` built successfully as non-root; image inspection confirmed the health check and the installed Sibyl package reported `0.1.13`.
- [x] OpenSSL is installed in build and runtime stages so Prisma selects a supported engine without its prior compatibility warning.
- [x] Private PostgreSQL network and persistent PostgreSQL/Sibyl volumes defined.
- [x] Migrations execute before backend startup.
- [x] Container and dependency health checks defined.
- [x] Caddy HTTPS, HSTS, compression, reverse proxy, and JSON logs configured.
- [x] Secure production environment template added and ignored actual environment path retained.
- [ ] Public hosting account connected.
- [ ] Public DNS and automatic certificate verified.
- [ ] Public frontend/backend/database/Sibyl/Virtuals/Base verified.

## Public repository

- [x] MIT license file exists.
- [x] `.gitignore` excludes environments, dependencies, builds, coverage, logs, demo data, and local Sibyl virtual environments.
- [x] `.dockerignore` excludes secrets, dependency directories, builds, coverage, logs, and temporary demo data.
- [x] Root debug database credential removed from `.env.example`.
- [ ] Git history reviewed. Blocked: this workspace contains no `.git` directory.
- [ ] Public GitHub remote verified. Blocked: no Git metadata or GitHub connection is available.
- [ ] Meaningful existing commits preserved. The genuine history must be restored; synthetic commits were not created.
- [x] Generated `node_modules`, `dist`, and the reproducible local Sibyl virtual environment were removed after final checks. Ignored `.continuity-demo` evidence databases are intentionally preserved, not submitted.

## Known limitations

1. The pinned official `@virtuals-protocol/acp-node-v2@0.1.12` dependency tree currently retains npm audit findings with no compatible published fix: `elliptic`, `js-cookie`, and nested `uuid`. The directly fixable `ws` issue is overridden to a patched release. Do not silently remove the official integration; monitor and upgrade after testing an upstream release.
2. A public HTTPS deployment needs a domain, host, and secret injection supplied outside this workspace.
3. Live Virtuals and Base verification needs funded, scoped credentials. None are present in this process environment.
4. The current workspace has no Git metadata, so history, remote visibility, and commit identity cannot be verified.
