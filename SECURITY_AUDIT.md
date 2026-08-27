# Security Audit

Rechecked 2026-08-27 against the checked-in lockfiles. No forced audit fix, SDK replacement, or major dependency upgrade was applied.

## Summary

The root workspace reports zero advisories. The backend production graph reports 22 affected packages: 13 low, 4 moderate, 5 high, and 0 critical. Every affected path enters through the direct official Virtuals dependency `@virtuals-protocol/acp-node-v2@0.1.12`. npm therefore marks that direct package high through its transitive `@account-kit/infra` path; no advisory originates in Continuity-owned code.

The Virtuals adapter is dynamically imported only when `VIRTUALS_ENABLED=true`. The intended live deployment does enable Virtuals, so these are accepted upstream production risks—not findings that can be dismissed merely because the integration is feature-gated.

## Originating advisories

| Package           | Advisory                                                                                                                      |            Severity | Installed path                                                               | Relevance                                                                                                                                                   | Fix status                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------: | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `elliptic@6.6.1`  | [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84), risky cryptographic primitive implementation        |      Low (CVSS 5.6) | ACP SDK -> `@account-kit/infra@4.88.5` -> `alchemy-sdk@3.6.5` -> ethers v5   | Server-side Virtuals dependency path; Continuity does not invoke elliptic directly.                                                                         | npm reports no fix for this path.        |
| `js-cookie@3.0.1` | [GHSA-qjx8-664m-686j](https://github.com/advisories/GHSA-qjx8-664m-686j), cookie-attribute injection through prototype hijack |                High | ACP SDK -> `@account-kit/logging@4.88.5` -> `@segment/analytics-next@1.74.0` | Browser-oriented telemetry code in the installed server SDK tree. Continuity's frontend does not import it, but deeper upstream reachability is not proven. | npm reports no fix for this path.        |
| `uuid@8.3.2`      | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), missing buffer bounds check in legacy v3/v5/v6 APIs | Moderate (CVSS 7.5) | ACP SDK -> `alchemy-sdk@3.6.5` -> `@solana/web3.js@1.98.4` -> `jayson@4.3.0` | Continuity does not call the affected UUID APIs directly.                                                                                                   | npm reports no fix for this nested path. |

npm counts affected parent and propagation paths in addition to the three originating advisories, producing the total of 22. The five high entries are `@virtuals-protocol/acp-node-v2`, `@account-kit/infra`, `@account-kit/logging`, `@segment/analytics-next`, and `js-cookie`; they represent one propagated advisory path, not five independent Continuity defects.

## Reachability and controls

- Sibyl, decision, verification, recovery, and Base code do not import the affected tree.
- Base uses the direct `viem` dependency and is not on an audit path.
- The browser client is plain JavaScript and imports none of the affected packages.
- Virtuals credentials and all operator routes remain disabled unless explicitly configured.
- When Virtuals is enabled, strict budgets, offering compatibility gates, bearer authentication, input validation, redacted structured logs, and idempotent recovery constrain exposure but do not remove upstream vulnerabilities.

## Parent upgrade review

`npm view @virtuals-protocol/acp-node-v2 version` returned `0.1.12` on 2026-08-27. That is the installed and adapter-tested version. npm reports no available fix for the high path. Overriding nested packages or replacing the SDK without provider compatibility evidence could break the required official ACP lifecycle, so no speculative override was applied.

## Other security controls

- Production requires an independent `CONTINUITY_OPERATOR_TOKEN` of at least 20 characters.
- Mission, dashboard, recovery, Virtuals, Base, and economic action routes require timing-safe bearer authentication when configured.
- Helmet security headers, strict CORS allowlisting, a 256 KB JSON limit, rate limiting, request IDs, and secret redaction are enabled.
- Base enforces a fixed recipient, maximum amount, mission budget, supported asset, mainnet opt-in guard, pre-broadcast persistence, and idempotency.
- Private keys and operator tokens are never returned from configuration or API responses. Blueprint secrets use `sync: false` or generated values.

## Commands and current evidence

```text
root:    npm audit --json            -> 0 vulnerabilities
backend: npm audit --omit=dev --json -> 22 (13 low, 4 moderate, 5 high, 0 critical)
```

Phase 35 ran the full backend suite against disposable PostgreSQL: 151 passed, 0 skipped, 0 failed. Subsequent Phase 32/33 changes passed typecheck, lint, and focused security/readiness tests; the authoritative final full-suite rerun remains required at the release gate.

## Decision

The advisories do not block a bounded hackathon demonstration, but they are a real production limitation whenever Virtuals is enabled. Recheck the official SDK before public launch, avoid exposing unrestricted mission execution, monitor provider updates, and never claim the dependency graph is vulnerability-free.
