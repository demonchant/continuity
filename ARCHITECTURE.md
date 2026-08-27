# Continuity engineering architecture

## Design goals

Continuity uses one backend, one relational database, one small web client, and narrow adapters for Sibyl, Virtuals, and Base. The architecture favors an observable state machine and explicit provider receipts over distributed services, event-bus complexity, or opaque ranking models.

This document specifies the target architecture; it does not claim the partner integrations are already implemented.

## System view

```text
Browser
  |
  v
Continuity API and mission runner (Node.js, TypeScript, Express)
  |             |                  |                 |
  v             v                  v                 v
PostgreSQL   Sibyl Memory      Virtuals          Base RPC/tool
runtime      experience        agents/jobs       payments
state        and checkpoints
```

## Backend architecture

The backend is a modular monolith:

```text
src/
|- config/          validated environment and provider configuration
|- api/             routes, controllers, middleware, response contracts
|- missions/        lifecycle, planning, transitions, runner
|- decisions/       evidence normalization, ranking, explanations
|- agents/          agent/capability models and experience profiles
|- memory/          application-owned memory interface and record types
|- verification/    declared checks and verification reports
|- payments/        budget policy, payment intents, receipts
|- integrations/    sibyl/, virtuals/, base/ adapters
|- recovery/        action ledger reconciliation and resume policy
|- security/        redaction, authorization, financial safety policy
`- shared/          errors, logging, clocks, IDs, common utilities
```

HTTP controllers only validate and translate requests. Domain services own rules. Repositories own PostgreSQL access. Provider adapters translate external APIs/SDKs into application-owned interfaces. The runner composes these modules; it does not hide their decisions.

## Frontend architecture

The frontend is a single TypeScript web application with no separate backend-for-frontend. A small React/Vite SPA is sufficient, subject to implementation-phase confirmation.

It has five views:

- dashboard: active/completed missions and spending;
- mission: state, current step, agent, result, and recovery state;
- decision: selected agent, reason, evidence, confidence, and alternatives;
- memory explorer: genuine Sibyl records and “used in this decision” links;
- experience: capability-specific agent outcomes and failure patterns.

The browser calls only the Continuity API. It never receives provider secrets, a wallet private key, raw signing capability, or the private submission URL. Live progress can use simple polling for the MVP; WebSockets are unnecessary unless measurement proves polling inadequate.

## Mission engine

The mission engine owns the state machine defined in `PRODUCT.md`, validates transitions, appends transition events, and exposes the stable next action. A mission plan describes required capabilities, verification rules, constraints, budget, and ordered steps.

The autonomous runner executes one durable step at a time:

```text
understand -> recall -> discover -> decide -> budget -> act
           -> verify -> learn -> checkpoint -> complete
```

Each step is restartable. External side effects are delegated through the action ledger and provider adapters.

## Decision engine

Input:

- mission objective, capability requirements, constraints, verification needs, and budget;
- currently available Virtuals candidates and prices;
- relevant Sibyl experiences and failures;
- evidence recency, sample size, similarity, verification strength, and cost.

Output:

```text
selected_agent
reason
evidence[]
confidence
alternatives[]
expected_cost
```

The MVP uses deterministic, inspectable weighting and eligibility rules. Evidence is scoped by capability: strong summarization history is not fact-verification evidence. Every aggregate exposes its count/window, sparse or stale history reduces confidence, and a failure penalizes only relevant work. Economic selection compares expected verified completion within budget; it does not collapse performance into a universal rating.

## Memory layer

Application code depends on a narrow `MemoryService` contract:

```text
recall(query, missionContext)
remember(record)
checkpoint(missionState)
recordDecision(decision)
recordOutcome(verifiedOutcome)
recordExperience(experience)
```

The Sibyl adapter must use the genuinely supported Sibyl SDK, MCP, or service path selected during integration. There is no fake local Sibyl implementation in the judged runtime. Test doubles may exist only in unit tests and must be named and scoped as such.

Sibyl stores durable cross-session mission, agent, decision, failure, experience, and recovery context. Recall results include provenance and record identifiers. PostgreSQL may cache provider references or store runtime state, but the decision engine obtains historical experience through `MemoryService`.

### Load-bearing invariant

> **If Sibyl Memory is removed, Continuity cannot use historical agent experience to make its core agent-selection decision.**

With memory disabled, the application must explicitly report that historical experience is unavailable. It must not silently reproduce the same behavior from a hidden PostgreSQL history or local fixture.

## Agent layer

The agent layer normalizes Virtuals identities, advertised capabilities, availability, price, and job state. It combines live candidate data with capability-specific experience produced from Sibyl evidence. It never treats advertised capability or self-reported success as verified performance.

The layer exposes candidate discovery, candidate eligibility, normalized execution request, job status, and normalized result interfaces. Virtuals-specific types remain inside its adapter.

## Verification layer

Mission plans select versioned verifiers. The MVP verifier supports required fields, schema/format, source presence, claim support, and mission requirements. It returns:

```text
PASS | FAIL
checks[]
reasons[]
evidence[]
verifier_version
```

The verified report controls mission completion and experience updates. Verification runs before success is learned or final settlement occurs when the chosen Base/Virtuals flow permits verification-before-payment.

## Recovery layer

The recovery layer maintains an action ledger with a unique logical action key, mission ID, action ID, provider request reference, state, attempts, and receipt. The write order is:

```text
persist intent -> perform/reconcile side effect -> persist receipt -> Sibyl checkpoint
```

On restart it reads PostgreSQL runtime state, recalls the Sibyl checkpoint, and asks Virtuals/Base for ambiguous provider state before retrying. It resumes known jobs, never resends confirmed payments, chooses policy-approved fallbacks, and marks irreconcilable cases for explicit failure rather than guessing.

## Base integration

The Base adapter performs a real, budget-authorized transaction using the organizer-supported path selected during implementation. It owns network/chain ID checks, asset/amount validation, recipient policy, transaction submission, confirmation, explorer URL generation, and receipt normalization.

Signing credentials remain server-side in a capped demo wallet. A payment intent is linked to the mission, selected agent, and action idempotency key. Continuity records the confirmed transaction reference in PostgreSQL and the economic outcome/experience in Sibyl.

## Virtuals integration

The Virtuals adapter performs real agent discovery and job execution through the currently supported Virtuals/ACP path. It normalizes candidates, creates a job, stores its provider identifier, polls or receives status, and returns a normalized result. Provider errors and timeouts map to explicit recoverable or terminal categories.

The final decision must use both live Virtuals candidate information and recalled Sibyl experience. A hard-coded candidate list does not qualify as the judged integration.

## Database

PostgreSQL with Prisma stores transactional runtime state:

- users/owners and missions;
- mission transition events and plans;
- agent attempts and provider references;
- decision snapshots and cited Sibyl record IDs;
- action intents/idempotency keys;
- verification reports;
- Base payment intents and receipts.

Core constraints include unique action idempotency keys, valid foreign keys, decimal-safe monetary values, timestamps, and indexes for mission status/recovery queries. PostgreSQL is not the source of cross-session agent experience used for selection; Sibyl is.

## API boundaries

```text
POST   /api/v1/missions
GET    /api/v1/missions
GET    /api/v1/missions/:id
POST   /api/v1/missions/:id/cancel
POST   /api/v1/missions/:id/run          internal/operator protected
GET    /api/v1/missions/:id/timeline
GET    /api/v1/missions/:id/decision
GET    /api/v1/missions/:id/verification
GET    /api/v1/agents/:id/experience
GET    /api/v1/memory                    redacted/operator protected
GET    /api/v1/health
```

API payloads use Zod validation, stable error codes, request/correlation IDs, pagination for lists, and redacted provider data. Provider webhooks, if required, live under a separate authenticated route and are signature-verified before state changes.

## Security boundaries

- Validate environment and fail closed when required integration configuration is absent.
- Never log or return API keys, wallet keys, signatures, auth headers, raw sensitive memory, or the tokenized submission URL.
- Keep Base signing server-side; enforce chain, asset, recipient, per-action, per-mission, and total demo-wallet limits.
- Authorize mission/memory access and preserve tenant boundaries in PostgreSQL and Sibyl.
- Validate request bodies, cap body size, rate-limit mutation routes, and verify provider webhook signatures.
- Treat recalled memory and agent output as untrusted input; neither may override system policy or payment controls.
- Redact proof artifacts before publication and use least-privilege demo credentials.

## End-to-end data flow

```text
1. API persists mission and requirements in PostgreSQL.
2. Mission engine creates a plan and required capability set.
3. Memory layer recalls relevant experience from real Sibyl.
4. Agent layer discovers live candidates from Virtuals.
5. Decision engine ranks candidates and stores its evidence-linked decision.
6. Budget/payment policy authorizes the selected economic path.
7. Recovery layer persists action intent; adapters execute/reconcile job and payment.
8. Agent result enters the verification layer.
9. Verification produces PASS/FAIL with evidence.
10. Mission engine completes, recovers, falls back, or fails.
11. Memory layer writes decision, verified outcome, failure/lesson, and checkpoint to Sibyl.
12. A future fresh session recalls those records and changes its next decision.
```

No token, NFT, DAO, social-network, general marketplace, or unrelated feature is part of this architecture.
