# Continuity

Continuity turns verified agent outcomes into durable Sibyl experience, then uses that experience to choose the next agent.

## The Problem

Autonomous systems can execute work, but later processes often choose from current capability and price only. Verification failures remain trapped in logs, so the system can repeat a bad choice or avoidable cost.

## The Solution

Continuity runs a bounded loop: create a mission, recall comparable Sibyl experience, select an agent with an explainable decision, execute, verify, perform an idempotent Base action when required, and write the outcome back to Sibyl.

## Why Sibyl Is Load-Bearing

Sibyl is the production source of historical experience used by the decision engine. PostgreSQL stores runtime state, jobs, payments, and recovery records; the decision path does not rebuild historical agent evidence from PostgreSQL or a local cache.

**Removing Sibyl Memory removes the historical experience used by Continuity's core agent-selection decision.**

## Judge Quick Start

Sibyl WRITE: [`backend/src/memory/memory-service.ts`](backend/src/memory/memory-service.ts)

Sibyl READ: [`backend/src/memory/decision-memory-context.ts`](backend/src/memory/decision-memory-context.ts)

Decision: [`backend/src/decisions/decision-engine.ts`](backend/src/decisions/decision-engine.ts)

Deletion Test: [`backend/tests/integration/load-bearing-memory-gate.test.ts`](backend/tests/integration/load-bearing-memory-gate.test.ts)

Virtuals: [`backend/src/integrations/virtuals/virtuals-acp-adapter.ts`](backend/src/integrations/virtuals/virtuals-acp-adapter.ts)

Base: [`backend/src/integrations/base/base-viem-adapter.ts`](backend/src/integrations/base/base-viem-adapter.ts)

```bash
cd backend
npm ci
npm run prisma:generate
npm run test:memory-gate
```

## Architecture

```text
Browser -> Continuity API / mission runner
              |        |        |        |
       PostgreSQL    Sibyl   Virtuals   Base
       runtime      history   ACP jobs  confirmed actions
```

Provider SDKs are isolated behind adapters. See [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`backend/src/server.ts`](backend/src/server.ts).

## How Memory Makes Decisions Better

The decision engine scores mission fit, cost, comparable outcomes, verification rate, failures, recency, and confidence. A cited Sibyl failure can penalize a cheaper agent enough for a more expensive agent with better verified history to win. Memory changes the evidence and selection; it does not guarantee success.

Proof: [`backend/tests/unit/decision-engine.test.ts`](backend/tests/unit/decision-engine.test.ts), [`backend/tests/unit/experience-engine.test.ts`](backend/tests/unit/experience-engine.test.ts), and [`backend/tests/adversarial/memory-agent-selection.test.ts`](backend/tests/adversarial/memory-agent-selection.test.ts).

## Fresh Session Demo

[`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md) defines a one-command, fail-closed proof. It creates a fresh run and Sibyl database, launches Session A and Session B as separate Node processes, and emits a JSON receipt plus JSONL transcript. Session A's controlled result fails the production verifier and writes official Sibyl entity/event IDs. After Session A terminates, Session B receives no failure payload, recalls and cites that entity, penalizes cheap Agent A, selects Agent B, verifies success, and writes new Sibyl IDs.

```powershell
$env:SIBYL_MCP_COMMAND = (Resolve-Path ".sibyl-demo-venv\Scripts\sibyl-memory-mcp.exe").Path
npm.cmd --prefix backend run demo:sibyl-proof
```

The proof is honestly labelled **“Production Sibyl cross-process causal proof using controlled simulated agent results.”** It proves production Sibyl persistence and causal decision behavior, not live Virtuals execution.

## Setup

Requirements: Node.js 20.11+, npm, PostgreSQL, Python, and `sibyl-memory-mcp==0.1.13` for the cross-process demo.

```bash
git clone <public-repository-url>
cd continuity/backend
npm ci
cp .env.example .env
# Set DATABASE_URL locally; never commit .env.
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

Virtuals and Base are disabled until their complete credential-gated environment is configured. Base defaults to Base Sepolia; mainnet requires explicit opt-in.

## Testing

```bash
cd backend
npm test
npm run test:memory-gate
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Live scripts fail when credentials or provider receipts are unavailable; they do not substitute fixtures: `npm run sibyl:smoke`, `npm run virtuals:smoke`, `npm run base:smoke`, `npm run runner:smoke`.

## Deployment

Container, PostgreSQL, HTTPS, migrations, health checks, and secret handling are documented in [`DEPLOYMENT.md`](DEPLOYMENT.md), using [`backend/Dockerfile`](backend/Dockerfile), [`compose.production.yml`](compose.production.yml), and [`Caddyfile`](Caddyfile). Do not call an environment live until it has a public health response, Sibyl read/write evidence, a Virtuals job ID, a Base transaction hash, and a complete mission receipt.

## Partner Integrations

### Sibyl Memory

[`backend/src/integrations/sibyl/sibyl-memory-adapter.ts`](backend/src/integrations/sibyl/sibyl-memory-adapter.ts) calls the official MCP operations `memory_search`, `memory_remember`, `memory_recall`, `memory_record_event`, and `memory_set_state` through [`backend/src/integrations/sibyl/sibyl-tool-client.ts`](backend/src/integrations/sibyl/sibyl-tool-client.ts). Production has no local-memory fallback.

### Virtuals Protocol

[`backend/src/integrations/virtuals/virtuals-acp-adapter.ts`](backend/src/integrations/virtuals/virtuals-acp-adapter.ts) uses the pinned `@virtuals-protocol/acp-node-v2` package. A live claim requires the job identifier emitted by [`backend/scripts/virtuals-live-smoke.mjs`](backend/scripts/virtuals-live-smoke.mjs) or [`backend/scripts/mission-runner-live-smoke.mjs`](backend/scripts/mission-runner-live-smoke.mjs).

### Base

[`backend/src/integrations/base/base-viem-adapter.ts`](backend/src/integrations/base/base-viem-adapter.ts) submits and confirms Base transactions. [`backend/src/integrations/base/base-payment-service.ts`](backend/src/integrations/base/base-payment-service.ts) enforces network, recipient, asset, budget, and idempotency. A live claim requires the transaction hash and explorer URL emitted by [`backend/scripts/base-live-smoke.mjs`](backend/scripts/base-live-smoke.mjs).

## PMF Evidence

[`PMF.md`](PMF.md) is an evidence ledger. As of its last review it contains no verified external testers, design partners, production users, or waitlist entries. No PMF claim is made from empty evidence.

## Prior Work Declaration

The repository documents a pre-existing backend foundation and later mission, memory, integration, dashboard, recovery, and hardening work. It distinguishes implemented code, automated tests, and credential-gated live tests. This workspace has no `.git` directory, so genuine commit history and public repository state cannot be verified here; no synthetic history is claimed.

## License

MIT. See [`LICENSE`](LICENSE).
