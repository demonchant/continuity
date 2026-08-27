# Continuity judging map

## Score strategy

Continuity is optimized around one provable claim: verified experience stored in Sibyl changes a future agent-selection decision after a complete application restart.

| Category            |             Points | What Continuity must prove                                                                            |
| ------------------- | -----------------: | ----------------------------------------------------------------------------------------------------- |
| Memory load-bearing |                 40 | Real Sibyl write/read across fresh sessions materially changes agent selection                        |
| Innovation          |                 25 | Capability-specific experience, negative memory, verification-driven learning, and economic decisions |
| Technical execution |                 20 | A working, tested, recoverable, idempotent, secure end-to-end system                                  |
| Presentation        |                 15 | A clear 3-4 minute causal demonstration with inspectable receipts                                     |
| PMF bonus           |                +10 | Credible evidence from target users/design partners and public proof                                  |
| Base multiplier     | Partner multiplier | A genuine mission-linked Base transaction                                                             |
| Virtuals multiplier | Partner multiplier | Genuine Virtuals discovery and job execution                                                          |

## Memory load-bearing — 40 points

### Phase 3 source proof

- **SIBYL MEMORY WRITE LOCATION:** `backend/src/integrations/sibyl/sibyl-memory-adapter.ts`; application boundary: `backend/src/memory/memory-service.ts`.
- **SIBYL MEMORY READ LOCATION:** `backend/src/integrations/sibyl/sibyl-memory-adapter.ts`; decision consumer boundary: `backend/src/memory/decision-memory-context.ts`.
- Exact official surface: `memory_remember`, `memory_recall`, `memory_search`, `memory_record_event`, and `memory_set_state` through the Sibyl stdio MCP server. No invented Sibyl methods appear in production code.
- Local test doubles live only under `backend/tests/`; production constructs `SibylMemoryAdapter` and cannot disable it when `NODE_ENV=production`.

### Phase 5 decision proof

- **DECISION MEMORY READ LOCATION:** `backend/src/decisions/decision-engine.ts` calls the sole decision-facing boundary in `backend/src/memory/decision-memory-context.ts` before scoring candidates.
- **DECISION MEMORY WRITE LOCATION:** `backend/src/decisions/decision-engine.ts` stores the selected agent, reason, confidence, score evidence, recommendation, and cited Sibyl record IDs through `MemoryService.recordDecision`.
- Explainable score: 65% capability-specific historical reliability, 20% verification-pass history, and 15% comparable cost, with an explicit failure-rate penalty, conservative smoothing, and modest similarity/recency weighting.
- Decision contract: `selectedAgent`, `reason`, `confidence`, `evidence`, `alternatives`, and `memoryReferences`.
- Automated proof: `backend/tests/unit/decision-engine.test.ts` covers neutral history, failure penalties, success preference, evidence citations, decision persistence, and the paired deletion test.

### Phase 6 experience proof

- **EXPERIENCE ENGINE LOCATION:** `backend/src/experience/experience-engine.ts`; profile contracts: `backend/src/experience/experience.ts`.
- **EXPERIENCE MEMORY READ LOCATION:** `backend/src/decisions/decision-engine.ts` supplies only recalled Sibyl evidence to `ExperienceEngine`; no PostgreSQL profile or production fallback exists.
- Profiles are agent-and-capability specific and contain success/failure counts, verification-pass rate, comparable cost, latency, recent and similar-mission performance, staleness, failure patterns, sample window, conservative reliability/confidence, recommendations, and Sibyl references.
- Negative memory becomes operational guidance, while strict capability filtering and explicit age/similarity weights prevent unrelated or stale history from dominating a decision.
- Automated proof: `backend/tests/unit/experience-engine.test.ts` covers successful and failed experience changing selection, capability-specific ranking, negative summaries, cost/latency aggregation, and stale/unrelated evidence resistance.

### Phase 7 verification proof

- **VERIFICATION LOCATION:** `backend/src/verification/verification-service.ts`; provider-neutral result/report contracts: `backend/src/verification/verification.ts`.
- **VERIFICATION MEMORY WRITE LOCATION:** `VerificationService.verify` calls `MemoryService.recordExperience` only after PASS and `MemoryService.recordFailure` after FAIL. The failure record is the useful failure experience, avoiding duplicate observations.
- Versioned deterministic checks cover completeness, required fields and output structure, source/evidence presence, internal consistency, required/prohibited content, and mission word-count constraints.
- Reports expose `passed`, a `0..1` score, `reasons`, `failedRequirements`, individual checks, and verifier version. Agent self-reported success is ignored.
- Automated proof: `backend/tests/unit/verification-service.test.ts`, including a closed loop where a stored verification failure changes the next agent selection.

### Phase 8 recovery proof

- **RECOVERY SERVICE LOCATION:** `backend/src/recovery/recovery-service.ts`; durable PostgreSQL adapter: `backend/src/recovery/prisma-recovery-repository.ts`.
- **CHECKPOINT/LEDGER SCHEMA:** `backend/prisma/schema.prisma`; migration: `backend/prisma/migrations/20260821000000_add_recovery_ledger/migration.sql`.
- **SIBYL RECOVERY WRITE LOCATION:** `RecoveryService.checkpoint` persists a safe mission/action/payment/verification summary through `MemoryService.recordCheckpoint` after the PostgreSQL operational checkpoint.
- PostgreSQL uniquely constrains `(missionId, actionId)` and `paymentId`. Completed retries return the original receipt; in-progress/uncertain outcomes block replay until explicit provider reconciliation.
- Recovery plans expose what happened, what remains, what must not repeat, whether resume is safe, a blocking reason when it is not, and the exact next action.
- Automated unit proof: `backend/tests/unit/recovery-service.test.ts`. Real persistence proof: `backend/tests/integration/recovery-database.test.ts` disconnects one Prisma client, creates another, restores the mission plan, and suppresses the prior side effect.

### Phase 12 autonomous lifecycle proof

- **RUNNER LOCATION:** `backend/src/runner/mission-runner.ts`; authenticated application route: `POST /api/v1/missions/:id/run` in `backend/src/runner/mission-runner-routes.ts`.
- **COMPLETE CHAIN:** parsed requirements -> mission-level Sibyl recall -> live candidate discovery -> Sibyl-backed decision/explanation -> Virtuals execution -> verification -> bounded recovery/fallback -> required Base action -> outcome/experience writes -> completed checkpoint.
- **MEMORY-DRIVEN RECOVERY:** a verification failure is written as capability-specific negative experience. The next selection recalls that record; repeated failure eventually excludes the agent, and retry/failure/timeout limits prevent an infinite loop.
- **LIMITS:** per-mission `maximumRetries`, `failureThreshold`, `timeoutMs`, and `candidateLimit` may only lower validated server-side `RUNNER_*` caps. The remaining timeout constrains Virtuals polling, candidates are budget/currency filtered, and the combined Virtuals execution plus separate Base action must remain within the total mission budget.
- **IDEMPOTENCY:** attempt action IDs, Virtuals funding/settlement actions, and the deterministic mission Base `paymentId` use the Phase 8 durable ledger; ambiguous side effects are not replayed.
- **AUTOMATED FULL-MISSION PROOF:** `backend/tests/integration/mission-runner-lifecycle.test.ts` proves A fails verification, Sibyl changes the fallback decision to B, B passes, exactly one Base transfer confirms, experience/outcome/checkpoint writes occur, and the mission reaches `COMPLETED`. It separately proves persistent failure stops at the threshold.
- **REAL GATE:** `backend/scripts/mission-runner-live-smoke.mjs` calls the production endpoint and refuses success without a completed mission, passed verification, real Virtuals job ID, and confirmed Base transaction hash. It requires credentials and is not replaced by the automated adapter test.

### Phase 13 frontend proof

- **VISIBLE APPLICATION:** `GET /dashboard` serves the operations console from `public/continuity/`; missions, mission detail, agent experience, memory explorer, and activity have dedicated routes.
- **CAUSAL MISSION DETAIL:** the page renders mission -> memory recalled -> agents considered -> decision -> execution -> verification -> Base action -> memory updated, with incomplete/current/completed stage states.
- **WHY THIS AGENT:** the selected agent is explained using recalled successes, verification rate, alternative failure history, budget fit, confidence, and exact Sibyl citations. The memory panel highlights the records that affected selection.
- **REAL DATA BOUNDARY:** `backend/src/dashboard/dashboard-service.ts` joins `MissionService`, a fresh `MemoryService.recall`, durable Virtuals jobs, and durable Base transactions. No synthetic production data or browser-side decision logic substitutes for these sources.
- **SAFE PROJECTION:** raw provider payloads, mission constraints, credentials, private keys, operator tokens, and adapter configuration are not returned. Public transaction hashes/explorer links and Sibyl record IDs remain visible as proof.
- **RESILIENCE/ACCESSIBILITY:** responsive layouts, mobile navigation, keyboard focus, skip navigation, reduced-motion support, loading skeletons, retryable errors, empty states, labeled filters, and safe external links are implemented.
- **AUTOMATED PROOF:** `backend/tests/integration/dashboard-api.test.ts` verifies UI delivery, memory-driven decision reasons, cited memory, agent experience, Virtuals verification state, Base receipt serialization, and absence of secret fields.

### Phase 14 Judge Mode proof

- **JUDGE VIEW:** `GET /dashboard/judge` presents remembered -> retrieved -> decision impact -> afterward write as a single left-to-right causal proof, followed by the real outcome memory.
- **PROVENANCE BOUNDARIES:** `DashboardService.missionDetail` performs a capability recall matching decision use and a mission-text recall for current writes, merges only genuine `RecalledMemory` records, and exposes the boundaries separately.
- **MEMORY IMPACT:** `LOAD_BEARING` is emitted only when a stored decision's `memoryReferences` intersect exact Sibyl IDs returned by the current decision recall. Awaiting, no-history, and unresolved-citation states remain explicit.
- **NO FABRICATION:** Judge cards display record result, failure reason, recommendation, agent, category, timestamp, and Sibyl ID from backend data. Empty evidence produces an empty state, never sample copy.
- **AFTERWARD WRITE:** the service selects only current-mission non-decision records timestamped after the latest stored decision; the outcome panel displays the latest returned outcome/experience/failure record.
- **DELETION TEST VISIBILITY:** the UI states the implementation invariant: removing Sibyl retrieval removes historical cards and current citation matches because no local store reconstructs them.
- **AUTOMATED PROOF:** `backend/tests/integration/dashboard-api.test.ts` verifies two retrieved decision citations, `LOAD_BEARING`, the affected Agent A/Agent B records, Agent B selection, a real post-decision Agent B success record, UI delivery, and secret exclusions.

### Phase 15 load-bearing hard gate

- **ONE-COMMAND GATE:** `npm test -- --run backend/tests/integration/load-bearing-memory-gate.test.ts` executes the canonical paired proof; `npm run test:memory-gate` is a convenience alias.
- **NO INJECTED FAILURE:** the initial real `DecisionEngine` selection chooses cheaper Agent A with no history. `VerificationService` then evaluates Agent A's claimed-success output against required object structure, summary, sources, and evidence. Its failed checks generate the negative records through `MemoryService.recordFailure`.
- **FRESH COMPARABLE DECISION:** a new mission with the same requirements and candidate registry recalls the two capability-specific Agent A failures, reports zero historical/verification success for A, cites their Sibyl IDs, and selects more expensive Agent B.
- **CONTROLLED DELETION:** `MEMORY_ENABLED=false` is parsed in `NODE_ENV=test` and passed through the exact server composition factory at `backend/src/config/memory-provider.ts`. The result is `DisabledMemoryProvider`, which always reports memory unavailable and never stores local history.
- **BEHAVIOR DISAPPEARS:** the equivalent disabled decision selects Agent A, reports `historicalExperience: unavailable`, confidence `0.1`, zero observations, no memory references, and no decision-memory write.
- **PRODUCTION INVARIANT:** environment validation rejects `MEMORY_ENABLED=false` in production. A Sibyl outage/disablement cannot silently fall back to PostgreSQL, browser state, fixtures, or in-process memory.
- **SOURCE MAP:** write — `verification/verification-service.ts` -> `memory/memory-service.ts` -> `integrations/sibyl/sibyl-memory-adapter.ts`; read — `memory/decision-memory-context.ts`; decision — `decisions/decision-engine.ts`; deletion — `tests/integration/load-bearing-memory-gate.test.ts`.

### Phase 16 fresh-session recall

The exact continuous video sequence is in [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md). It uses two independently launched Node application processes against the same real Sibyl database:

- **SESSION A:** a new mission and unique local-test candidate pair have no history, so Agent A wins on cost. Agent A's claimed-success output is missing the required summary, sources, and evidence. The real `VerificationService` fails it and writes a run-scoped capability-specific negative memory through the production Sibyl adapter. The application closes and prints `application.stop`.
- **SESSION B:** a new process reconstructs the mission repository, registry, `DecisionEngine`, `VerificationService`, `MemoryService`, and MCP connection. It receives no failure payload. Sibyl recalls Session A's record IDs, the decision explains that Agent A is not recommended because it failed a comparable mission previously, Agent B is selected, and its complete result passes verification.
- **VISIBLE CONTINUITY:** every event includes an ISO timestamp; both sessions show their process IDs, run ID, and absolute Sibyl database path. Different process IDs plus the intervening stop event make the restart visible.
- **FAIL-CLOSED DEMO:** Session A rejects a reused or contaminated run. Session B exits non-zero unless Agent A has recalled observations, Sibyl IDs are cited, Agent B is selected, and verification passes.
- **NO FABRICATION:** no script accepts a memory record. Negative memory can only arise from the verifier evaluating Agent A's actual demo output.

**PHASE 16 FILES:** lifecycle `backend/src/demo/fresh-session-recall-demo.ts`; process launcher `backend/scripts/fresh-session-recall-demo.mjs`; regression `backend/tests/integration/fresh-session-recall.test.ts`; operator sequence `DEMO_RUNBOOK.md`.

### Implementation

- Real Sibyl integration for mission, decision, agent, failure, experience, outcome, and recovery records.
- Historical evidence retrieved through the `MemoryService` boundary, not a hidden local substitute.
- Decision outputs cite the Sibyl record identifiers that influenced selection.
- A verified Agent A failure is written in Session A and retrieved in Session B.
- Session B chooses Agent B for a comparable capability because of the recalled failure/success evidence.
- Sibyl checkpoints contribute to restart recovery.

### Required deletion test

> **If Sibyl Memory is removed, Continuity cannot use historical agent experience to make its core agent-selection decision.**

The automated paired test first supplies a relevant Sibyl failure for cheaper Agent A: the engine selects Agent B and cites that record. It then runs the identical mission and agents through the explicit disabled provider: history becomes unavailable, all memory references disappear, no decision memory is written, and cheaper Agent A is selected. PostgreSQL, fixtures, prompts, and caches do not reproduce the missing history. An enabled-provider failure propagates instead of silently falling back.

### Evidence

- Sibyl write and recall calls visible in source and linked near the top of the final README.
- Genuine record IDs and redacted provider receipts.
- Two distinct process/session IDs and visible timestamps.
- Decision trace linking recalled records to the changed selection.
- Paired deletion-test traces.

### Gate

This category fails if memory is decorative, if the “fresh” session receives prior context manually, or if disabling Sibyl leaves the core historical selection behavior intact.

## Innovation — 25 points

### Implementation

- Operational experience rather than conversation storage alone.
- Capability-specific evidence answering “good at what?” instead of a universal rating.
- Success rate, verification-pass rate, average cost, recency, task/similar-mission performance, failure patterns, sample size, and observation window.
- Negative memory: verified failures become future avoidance or risk evidence.
- Verification-driven learning: agent self-reports never determine experience.
- Explainable selection with reason, evidence, confidence, and alternatives.
- Economic choice: remembered probability of verified success informs whether a higher price is justified.
- Recovery memory prevents repeated side effects after interruption.

### Evidence and gate

Show one agent ranking differently across two capabilities, one failure changing a future decision, and one price/performance comparison. All calculations must be transparent and conservative with sparse evidence.

## Technical execution — 20 points

### Implementation

- Simple modular backend and explicit mission state machine.
- PostgreSQL constraints and migrations for durable runtime state.
- Real Sibyl, Virtuals, and Base adapter boundaries.
- Versioned verification reports and deterministic MVP checks.
- Action ledger, intent-before-effect writes, idempotency keys, and provider reconciliation.
- Budget, network, asset, recipient, and spend controls.
- Validated configuration, structured/redacted errors and logs, authorization, and provider failure handling.
- Unit, integration, end-to-end, restart, duplicate-payment, budget, invalid-result, network-failure, and second-run tests.

### Evidence and gate

CI must pass from a clean checkout. Fault injection must show restart recovery, zero duplicate payment, verification rejection, budget refusal, safe network recovery, and a second complete run without manual state repair.

## Presentation — 15 points

### Implementation

- Judge-first README with direct source/proof links.
- Small dashboard and memory explorer that visibly connect Sibyl evidence, decision, action, verification, and learning.
- Final 3-4 minute demo follows `DEMO.md` and shows real identifiers rather than narrated claims.
- Honest status, declared network, limitations, prior-work note, and no hidden fallback presented as live behavior.

### Evidence and gate

A new reviewer should understand Continuity in 10 seconds and locate Sibyl write/read, the changed decision, the Base transaction, and the Virtuals job within two minutes. All public links must work while signed out.

## PMF bonus — 10 points

### Target evidence

- Autonomous-agent developers and operators are the named audience.
- At least 2-3 genuine design partners review or use the flow.
- Interviews capture current selection method, repeated-failure cost, reaction, objections, and adoption intent.
- Public evidence may include permitted testimonials, GitHub issues, real beta signups, and a build log.
- Product decisions caused by feedback are documented.

Large unsupported market slides and fabricated waitlists do not count. A credible repeat tester or pilot commitment is stronger than vanity signup volume.

## Base multiplier

### Qualifying functionality

Continuity makes a genuine budget decision, creates a payment intent, submits the appropriate real Base transaction, waits for confirmation, stores the receipt, and writes the economic outcome to Sibyl. The demo exposes the declared network, transaction hash, and explorer link. Restart/replay cannot duplicate it.

A disconnected wallet transfer or merely mentioning Base does not qualify.

## Virtuals multiplier

### Qualifying functionality

Continuity performs genuine Virtuals/ACP agent discovery, evaluates live candidates with Sibyl experience, creates a real job, captures its provider ID/result, verifies the result, and records the experience.

A hard-coded agent list, mocked judged flow, or merely mentioning Virtuals does not qualify.

## Base onchain proof

- **BASE TRANSACTION CONSTRUCTION:** `backend/src/integrations/base/base-viem-adapter.ts` uses viem against the configured official Base RPC and checks the RPC chain before enabling payments.
- **BASE BUDGET/IDEMPOTENCY LOCATION:** `backend/src/integrations/base/base-payment-service.ts` enforces mission/global limits and routes the broadcast through the Phase 8 `(missionId, actionId, paymentId)` recovery ledger.
- **BASE RECEIPT LOCATION:** `backend/src/integrations/base/prisma-base-transaction-repository.ts` records the hash, Base network, action, mission, amount, confirmation block/status, and explorer URL.
- **BASE -> SIBYL LOCATION:** confirmed payments call `MemoryService.recordOutcome`; reverted or terminal failures call `MemoryService.recordFailure`.
- **VISIBLE DEMO:** `POST /api/v1/base/payments`, `GET /api/v1/base/transactions/:id`, and `backend/scripts/base-live-smoke.mjs`. The smoke fails unless a genuine Base receipt confirms.

## Phase 11 economic-memory proof

- **SIBYL -> DECISION:** `backend/src/economics/economic-decision-service.ts` filters by mission budget/currency, then consumes the existing Sibyl-backed `DecisionEngine`. Its output contains selected agent, expected verified outcome, estimated cost, per-agent historical metrics, explanation, and cited Sibyl IDs.
- **DECISION -> BASE:** `backend/src/economics/economic-action-service.ts` sends exactly the selected advertised cost through `BasePaymentService` only when asset and allowlisted provider recipient match.
- **OBSERVABILITY:** logs expose `economic.memory.evidence`, `economic.decision`, `economic.base.action`, and confirmed transaction events. `GET /economic-decisions` renders the same decision/evidence/Base status for the operator.
- **MEMORY-CHANGE TEST:** `backend/tests/unit/economic-decision-service.test.ts` proves Agent A wins at `0.50 USDC` without history, while Sibyl failure for A plus verified success for Agent B changes selection to B at `0.80 USDC` under a `1.00 USDC` budget.
- **REAL COMBINED GATE:** `backend/scripts/economic-live-smoke.mjs` rejects a run with no Sibyl references or no confirmed Base hash. Mocks cannot satisfy this script.

### Phase 9 implementation proof

- **OFFICIAL VIRTUALS ADAPTER:** `backend/src/integrations/virtuals/virtuals-acp-adapter.ts` calls the published ACP Node v2 SDK directly. The currently installed 0.1.12 declaration requires `AcpAgent.create({ evmProvider })`; Continuity follows that published signature rather than the older README spelling.
- **VIRTUALS EXECUTION LOCATION:** `backend/src/integrations/virtuals/virtuals-execution-service.ts` performs live discovery, invokes the Sibyl-backed decision engine, creates/funds the selected offering's job, waits through official ACP job states, verifies the deliverable, and calls official complete/reject settlement.
- **VIRTUALS JOB RECORD LOCATION:** `backend/src/integrations/virtuals/prisma-virtuals-job-repository.ts` and `backend/prisma/migrations/20260822000000_add_virtuals_jobs/migration.sql` persist mission/action, external job ID, chain, agent/provider/offering, requirements, state, result, verification, and safe error classification.
- **VISIBLE APPLICATION SURFACE:** authenticated `POST /api/v1/virtuals/execute` and `GET /api/v1/virtuals/jobs/:id` are mounted only when real Virtuals configuration is enabled.
- **LIVE GATE:** `backend/scripts/virtuals-live-smoke.mjs` fails unless the real external job completes and passes Continuity verification. The repository's mock tests prove adapter contracts and error/state behavior but are never substituted for this gate.

## Strongest combined proof

```text
Sibyl experience
  -> capability-specific economic decision
  -> Base transaction
  -> Virtuals execution
  -> independent verification
  -> updated Sibyl experience
```

## Final audit

- [ ] Real Sibyl write and fresh-session recall.
- [ ] Recalled memory visibly changes selection.
- [ ] Exact deletion-test statement and paired proof are present.
- [ ] Capability-specific and negative experience are visible.
- [ ] Verification controls learning.
- [ ] Restart, idempotency, budget, invalid-result, outage, and second-run tests pass.
- [ ] Genuine Virtuals job and Base transaction receipts are visible.
- [ ] 2-3 design partners or equivalent credible PMF evidence exist.
- [ ] README, source, CI, demo, explorer links, posts, license, prior-work note, and memory note are public and correct.
- [ ] No secret, private key, or submission edit token appears in any public artifact.
