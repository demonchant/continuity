# Continuity execution roadmap

This is the single build order from the current repository to submission. A phase closes only when its gate and proof artifact exist. `P/U`, `T`, `M`, and `D` refer to product/usefulness, technical execution, memory innovation, and demo/communication; `PMF`, `V`, and `B` refer to the PMF bonus and Virtuals/Base multipliers.

## Critical path

```text
0 Freeze -> 1 Foundation -> 2 Missions -> 3 Sibyl -> 4 Decisions
         -> 5 Experience -> 6 Verify -> 7 Failure proof -> 8 Recovery
         -> 9 Virtuals -> 10 Base -> 11 Economics -> 12 Autonomous runner
         -> 13 Frontend -> 14 Memory explorer -> 15 Kill-Sibyl proof
         -> 16 Fresh-session proof -> 17 Adversarial tests -> 18 PMF
         -> 19 Public proof -> 20 Polish -> 21 Judge mode -> 22 README
         -> 23 GitHub quality -> 24 License -> 25 Final demo
         -> 26 Build-log posts -> 27 Final audit -> 28 Submit
```

Phases 3-7 form the judged memory loop. Phases 8-12 create the complete engine and partner multipliers. Phases 13-28 expose, attack, validate, polish, and prove it. Product polish must not displace the critical path.

## Phase 0 — freeze the product `[P/U, M, D]`

**Build:** `PRODUCT.md`, `ARCHITECTURE.md`, `DEMO.md`, `JUDGING.md`, and this roadmap. Freeze the vocabulary, scope, invariants, and two-session acceptance story.

**Gate:** every team member can use the same one-sentence definition; any proposed feature maps to the core loop.

**Proof:** reviewed documents and a rejected-features list in `PRODUCT.md`.

## Phase 1 — backend foundation `[T]` — current repository state: implemented, verify in target environment

**Build:** Node/TypeScript/Express, configuration validation, structured logging, error handling, PostgreSQL/Prisma migration, health endpoint, Vitest, lint/typecheck/build scripts.

**Gate:** clean install; generated Prisma client; database migration/deploy; server start; healthy database response; tests, lint, typecheck, and build pass.

**Proof:** CI run and deployment health response. The prior npm 429 is treated as a registry/environment incident, not an architecture change.

## Phase 2 — mission engine `[T, D]`

**Build:** create/get/list/cancel APIs; lifecycle transition service; append-only transition events; mission constraints, budget, stable current step, and cancellation policy. Add `SELECTING_AGENT` and remove or formally define any extra states.

**Gate:** one integration test drives a mission through the full internal lifecycle without external adapters, and invalid transitions fail deterministically.

**Proof:** API collection, state-transition test, and mission timeline response.

## Phase 3 — real Sibyl memory core `[M, T]`

**Build:** first validate the supported Sibyl SDK/MCP integration path with a spike. Implement the narrow `MemoryService`, typed records, provenance, tenant/mission scoping, recall/write/checkpoint operations, and integration tests against genuine Sibyl. Do not present a fake local adapter as the judged integration.

**Gate:** write a mission experience, terminate the process, then recall it from a new process using only its semantic mission/capability context.

**Proof:** redacted provider receipts, record identifiers, and a repeatable cross-session test/script.

## Phase 4 — memory-driven decision engine `[M, P/U, D]`

**Build:** candidate normalization; comparable-mission recall; evidence weighting by capability, recency, sample size, verification strength, failure pattern, and cost; selection output with reason/evidence/confidence/alternatives. Start with transparent rules, not an opaque learned ranker.

**Gate:** fixed evidence fixtures produce explainable, deterministic choices; removing relevant Sibyl evidence changes the decision.

**Proof:** side-by-side decision trace with cited memory identifiers.

## Phase 5 — capability-specific experience engine `[M, P/U]`

**Build:** derive per-agent/per-capability success rate, verification-pass rate, average cost, recent trend, task-specific and similar-mission performance, failure taxonomy, sample size, and observation window. Define similarity conservatively from mission capabilities/tags before considering embeddings.

**Gate:** the same agent can rank differently for summarization and fact verification; sparse data visibly lowers confidence.

**Proof:** capability profile endpoint/view and calculation tests covering recency, zero samples, mixed currencies, and failures.

## Phase 6 — verification engine `[T, M, P/U]`

**Build:** mission-declared validators for required fields, source presence, claim support, output schema, and requirements; versioned PASS/FAIL report; verified outcome recording.

**Gate:** a known unsupported answer fails for a visible reason and a conforming answer passes; only the verifier result updates experience.

**Proof:** paired reports and automated tests.

## Phase 7 — failure memory loop `[M, D]`

**Build:** failure taxonomy and recommendation records; recall queries that target relevant capability/mission failures; decision policy that can avoid or penalize an agent based on verified evidence.

**Gate:** execute the complete two-session story in `DEMO.md` before adding partner complexity.

**Proof:** fresh-session recording with Sibyl write/recall identifiers and changed decision.

## Phase 8 — recovery and idempotency `[T, M]`

**Build:** action ledger, unique idempotency keys, intent-before-effect pattern, provider reconciliation, checkpoints, leases/locking, retry policy, and recovery worker. Cover crash windows before request, after request/before receipt, and after receipt/before checkpoint.

**Gate:** kill the process after payment/job intent and at each crash window; restart reaches the correct next state with no duplicate side effect.

**Proof:** recovery tests, action timeline, and duplicate count of zero.

## Phase 9 — real Virtuals integration `[V, T, D]`

**Build:** confirm current ACP/API support; real agent discovery, capability/price normalization, job submission, status polling/webhook handling, result capture, and sandbox/provider error mapping.

**Gate:** a mission discovers at least two genuine candidates and completes a real Virtuals job whose identifier is retained.

**Proof:** provider receipt, job link/identifier, logs, and demo clip.

## Phase 10 — real Base integration `[B, T, D]`

**Build:** explicit network/asset configuration, wallet isolation, spend limits, payment intents, transaction submission, confirmations, explorer URL, receipt persistence, and Sibyl transaction experience. Prefer the organizer-supported Base path after verifying its current documentation.

**Gate:** one budget-authorized genuine transaction confirms on the declared network; a replay cannot pay twice.

**Proof:** explorer link, action/idempotency record, and recovery test.

## Phase 11 — economic decision making `[M, P/U, B, V]`

**Build:** compare candidate price with capability-specific probability of verified completion and expected retry cost. Keep the policy legible and budget constrained; do not imply statistical certainty from tiny samples.

**Gate:** with a $1 budget, Continuity can justify choosing a $0.80 agent over a $0.50 agent when the additional $0.30 buys a materially stronger evidence-backed chance of verified success, and can choose the cheaper agent when evidence does not justify the premium.

**Proof:** two counterfactual decision traces followed by a real Base-to-Virtuals execution.

## Phase 12 — autonomous mission runner `[T, M, B, V]`

**Build:** connect the complete backend in this order: receive mission, understand requirements, recall memory, discover agents, rank/select, enforce budget, execute the Virtuals job, verify, settle the appropriate Base payment according to the chosen provider flow, record outcome, update experience, and complete. On failure, recall recovery state, diagnose, choose a policy-approved fallback, and continue. Resolve the exact pay-before/pay-after contract during partner integration; never pay twice and never leave settlement ordering implicit.

**Gate:** a mission completes the entire real loop without manual database edits; an injected agent/provider failure enters recovery and either selects a fallback or ends in an explainable terminal state.

**Proof:** end-to-end test, mission/action timeline, Sibyl identifiers, Virtuals job identifier, and Base receipt.

## Phase 13 — frontend `[P/U, D]`

**Build:** the smallest polished dashboard for active/completed missions, agent experience, memory events, and spending. The mission page exposes budget, status, current agent, and selection reason. The decision panel compares the selected agent with alternatives and their capability-specific evidence.

**Gate:** a first-time tester can launch a mission and answer what is happening, which agent was selected, why, what it cost, and whether it passed.

**Proof:** deployed UI and usability recording.

## Phase 14 — memory explorer `[M, D]`

**Build:** browse memory by agent, mission, capability, decision, outcome, and failure pattern. Highlight the exact memories used by the current decision and link them to the resulting action.

**Gate:** a judge can trace `Sibyl record -> decision evidence -> selected agent -> action` without reading logs or source.

**Proof:** explorer screenshot/recording with genuine Sibyl record identifiers.

## Phase 15 — kill-Sibyl test `[M, T, D]`

**Build:** a safe demo/test configuration such as `MEMORY_ENABLED`, disabled only outside production. With memory enabled, historical experience affects selection. With memory disabled, Continuity reports historical evidence unavailable and cannot make the experience-driven selection. This is not permission to silently fall back to a fake store.

**Gate:** an automated or scripted A/B test proves removal of Sibyl breaks the defining behavior while baseline mission handling remains observable.

**Proof:** paired traces with identical candidates and mission context.

## Phase 16 — fresh-session test `[M, D]`

**Build:** run Session A through verified failure and Sibyl write, fully close the application, record the timestamp/session identifier, then start Session B with no manual context and request an equivalent mission. Recall the failure and recommend the better agent.

**Gate:** the centerpiece story in `DEMO.md` passes twice from clean processes.

**Proof:** uncut fresh-session clip plus machine-readable receipts.

## Phase 17 — adversarial testing `[T, M, B]`

**Build:** attack server restart, duplicate payment, agent failure, repeated mission, Sibyl disabled, invalid result, exhausted budget, network outage, concurrency, and a second complete run. Add automated coverage where deterministic and a scripted fault-injection runbook where providers are involved.

**Gate:** restart resumes; payment count stays one; failures become memory; repeat selection changes; invalid output fails verification; exhausted budget blocks spending; network faults recover without corrupting state; the complete run works again without intervention.

**Proof:** adversarial test matrix with results and linked tests/receipts.

## Phase 18 — PMF validation `[P/U, PMF]`

**Build:** test with autonomous-agent developers/operators. Capture current selection workflow, failure cost, reaction to capability-specific experience, adoption objections, and changes made. Target at least 2-3 genuine design partners rather than vanity interest.

**Gate:** at least two named or privately documented design partners have used/reviewed the flow and provided credible follow-up intent; all public quotes have permission.

**Proof:** redacted interview notes, feedback issues, product decisions, and pilot/test evidence.

## Phase 19 — public proof `[P/U, PMF, D]`

**Build:** a focused landing page with “Your agents shouldn't make the same mistake twice,” a private-beta call to action with consent-aware analytics, and a public build log explaining the tested memory-to-decision behavior.

**Gate:** the page works, signups are genuine, metrics exclude internal/test traffic, and public claims match shipped behavior.

**Proof:** live page, analytics snapshot, and build-log URL.

## Phase 20 — product polish `[P/U, T, D]`

**Build:** stop feature development. Improve speed, hierarchy, accessible states, human-readable errors, loading/empty/recovery views, log readability, secret isolation, and setup ergonomics.

**Gate:** no broken or ambiguous state appears in the rehearsed demo; a clean setup is practical; frontend bundles and logs contain no secrets.

**Proof:** polish checklist, accessibility/smoke run, and clean-checkout run.

## Phase 21 — hackathon judge mode `[D, M, B, V]`

**Build:** give the repository and demo to someone unfamiliar with Continuity. Time whether they can understand the product in 10 seconds and locate Sibyl write/read, behavioral change, Base proof, and Virtuals proof in under two minutes.

**Gate:** every timed task succeeds without coaching; otherwise fix pitch, README, demo, or integration presentation and repeat.

**Proof:** judge-test notes with timings and resulting changes.

## Phase 22 — judge-first README `[D, M, T]`

**Build:** put the frozen definition and judge quick start near the top, with direct pointers to Sibyl write/read, decision engine, Virtuals, Base, kill-Sibyl test, and fresh-session demo. Follow with architecture, setup, configuration, run/test instructions, security, PMF evidence, prior-work declaration, memory implementation note, limitations, and license.

**Gate:** all commands work from a clean checkout and every code pointer resolves at the release commit.

**Proof:** clean-checkout verification and judge-mode timing.

## Phase 23 — GitHub quality `[T, D]`

**Build:** preserve real, reviewable development history with focused commits that reflect foundation, missions, Sibyl, experience, decisions, verification, recovery, partners, runner, UI, tests, fixes, and docs. Never rewrite or fabricate history to mimic progress.

**Gate:** public default branch builds; CI is green; commit messages and diffs tell the actual development story; repository contains no generated clutter or secrets.

**Proof:** public repository, CI badges/runs, and secret scan.

## Phase 24 — license `[T]`

**Build:** retain the MIT license in the repository root and verify all added dependencies/assets are compatible and attributed where required.

**Gate:** license exists, copyright details are correct, and dependency/asset review has no incompatible item.

**Proof:** `LICENSE` and dependency review note.

## Phase 25 — final demo `[D, M, B, V]`

**Build:** produce a roughly 3:15 video: problem (0:00), Continuity (0:20), Agent A failure and Sibyl write (0:40), full close/timestamp (1:10), fresh-session recall and Agent B decision (1:25), genuine Virtuals job (1:55), genuine Base transaction (2:20), verified success and Sibyl learning (2:40), kill-Sibyl comparison (2:55), closing line (3:10). Adjust seconds to the official 2-5 minute constraint without cutting proof.

**Gate:** the video clearly shows fresh sessions, provider identifiers, transaction network, verification, and memory-caused behavioral change; captions are readable at normal speed.

**Proof:** final public video and backup recording/receipt bundle.

## Phase 26 — build-log posts `[PMF, D, B, V]`

**Build:** publish at least one honest progress post and the final demo post. Tag the organizer and partner accounts required by the current rules. Claim only integrations actually exercised.

**Gate:** posts are public, links work signed out, tags and project/team names are correct, and no secret/edit token appears.

**Proof:** post URLs and screenshots.

## Phase 27 — final judging audit `[T, M, D, PMF, B, V]`

**Build:** execute the checklist in `JUDGING.md`: real Sibyl write/read/behavior change/fresh session/kill test; experience, negative memory, verification, recovery; tests, idempotency, budgets, errors, second run; genuine Base and Virtuals receipts; PMF evidence; public GitHub, MIT, README, video, team/partner data, posts, prior-work declaration, and memory implementation note.

**Gate:** zero unchecked mandatory item, zero broken signed-out link, zero claim without a receipt, and two successful release-candidate rehearsals.

**Proof:** signed/timestamped release checklist.

## Phase 28 — final submission by wizardskull `[D, PMF, B, V]`

**Build:** assemble the public repository, 3-4 minute demo, build log, demo post, team and partner information, and memory implementation note. Re-check the official portal, deadline/timezone, exact rubric labels/weights, prior-work requirement, and Mark Ready behavior. Keep the tokenized edit URL private and out of repository, logs, screenshots, chat excerpts, and public posts.

**Gate:** **wizardskull** reviews the final payload, submits through the private portal, selects **Mark Ready**, and verifies the submission's public/read-only view.

**Proof:** timestamped confirmation and a private copy of the submitted fields.

## Stop-the-line risks

| Risk                                                         | Earliest mitigation                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Sibyl integration path is incompatible with the Node runtime | Phase 3 spike; use a small supported sidecar/adapter if required, while keeping the real system load-bearing |
| Virtuals candidate/job availability is unreliable            | Validate provider sandbox early and prepare two known compatible agents without fabricating responses        |
| Base funds or confirmations delay the live demo              | Use the organizer-supported network, pre-fund a capped wallet, rehearse, and retain honest fallback receipts |
| Verification is subjective                                   | Choose a narrowly testable mission and deterministic checks for the MVP                                      |
| Experience statistics overclaim sparse evidence              | Always expose counts/windows/confidence and use conservative priors                                          |
| UI work consumes the critical path                           | Do not start Phase 13 until the Phase 12 autonomous runner passes                                            |
| A private portal edit token leaks                            | Never store or repeat the tokenized URL; use it only at final submission                                     |

## Immediate next action

Close Phase 0 review, re-run the Phase 1 gate against PostgreSQL, then implement Phase 2. Perform a time-boxed Sibyl integration spike early enough that Phase 3 assumptions are proven before the mission engine hardens around them. The score-maximizing order is foundation -> missions -> Sibyl -> memory-driven decisions -> experience -> verification -> failure memory -> recovery -> Virtuals -> Base -> autonomous runner -> frontend -> proof/tests -> PMF/polish -> demo/docs/posts -> audit -> submit.
