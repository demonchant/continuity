# Continuity product specification

## One-sentence definition

**Continuity gives autonomous agents operational experience: it remembers which agents worked, which failed, why, and what happened, then uses that evidence to make better decisions in future missions.**

## Problem

Autonomous systems can discover and execute agents, but they repeatedly make selection decisions without durable knowledge of prior operational outcomes. Generic reputation does not answer “good at what?”, agent self-reports do not prove success, and a new session often loses the reasons behind earlier choices and failures. The result is repeated mistakes, wasted budget, and unsafe retries.

## Target users

Primary users are developers and operators building autonomous-agent workflows that repeatedly select or hire external agents. They need to know which agent is reliable for a specific capability, why it should be trusted, what it costs, and whether previous failures should change the next decision.

Secondary users are teams supervising long-running agent missions that must survive restarts without duplicated jobs or payments.

## Product

Continuity is a small experience and orchestration layer between missions, Sibyl Memory, Virtuals agents, and Base payments.

```text
Sibyl Memory                    durable experience and recovery context
       |
       v
Continuity                      decisions and orchestration
       |                 |
       v                 v
Virtuals Protocol         Base
agent discovery/work      verifiable payments
```

Sibyl is mandatory and load-bearing. PostgreSQL may hold transactional runtime state, but it is not a substitute for cross-session experience. Base and Virtuals must perform genuine functions before Continuity claims either partner multiplier.

## Core user journey

1. An operator creates a mission with requirements, constraints, verification rules, and budget.
2. Continuity recalls relevant capability-specific experience from Sibyl.
3. It discovers currently available agents through Virtuals.
4. It compares candidates using recalled evidence, current price, and mission fit.
5. It selects an agent and exposes the reason, evidence, confidence, and alternatives.
6. It checks budget and executes the real job/payment flow.
7. It verifies the returned result independently of the agent's self-report.
8. It records the decision, result, verification, cost, failure or success, and lesson in Sibyl.
9. In a fresh session, a comparable mission recalls that experience and can make a better selection.

## Mission lifecycle

```text
CREATED -> PLANNING -> SELECTING_AGENT -> EXECUTING -> VERIFYING -> COMPLETED
                 |              |             |            |
                 +--------------+-------------+------------+-> FAILED
                                                |
                                                +-> RECOVERING

Any nonterminal state -> CANCELLED when policy permits
```

- `CREATED`: objective, constraints, budget, and acceptance criteria are persisted.
- `PLANNING`: requirements and required capabilities are derived.
- `SELECTING_AGENT`: Sibyl experience and live Virtuals candidates are evaluated.
- `EXECUTING`: the chosen agent/job and any required payment action are in progress.
- `VERIFYING`: the result is checked against declared requirements.
- `COMPLETED`: verification passed and experience was recorded.
- `FAILED`: no safe continuation remains or a terminal policy failed.
- `RECOVERING`: Continuity is reconciling prior actions and selecting a safe next step.
- `CANCELLED`: execution stopped under cancellation policy.

Only explicit, validated transitions are allowed. Every transition is auditable.

## Agent lifecycle

```text
DISCOVERED -> ELIGIBLE -> RANKED -> SELECTED -> EXECUTING
          -> RESULT_RETURNED -> VERIFIED_PASS | VERIFIED_FAIL
          -> EXPERIENCE_UPDATED
```

An agent is evaluated per capability and comparable mission, never by one universal star rating. Its experience profile includes sample count and observation window alongside success rate, verification-pass rate, average cost, recent performance, task-specific performance, similar-mission performance, and recurring failure patterns.

## Memory lifecycle

```text
Mission context
  -> formulate recall query
  -> retrieve genuine Sibyl records
  -> validate scope and provenance
  -> cite relevant evidence in a decision
  -> execute and verify
  -> write decision, outcome, failure, lesson, and checkpoint to Sibyl
  -> retrieve in a future session
```

Memory categories are mission, agent, decision, failure, and learned experience. Every record has identity, timestamps, mission and capability context, provenance, and provider references. Only verified outcomes may change success/failure experience. Retrieval must return record identifiers so the decision can show what it used.

## Verification lifecycle

```text
Agent result -> run declared checks -> PASS or FAIL with reasons
             -> record evidence and verifier version -> update experience
```

The MVP checks required fields, output format, required sources, claim support, and mission-specific requirements. An agent saying “I succeeded” has no effect on the final outcome. Failed checks create failure memory.

## Failure lifecycle

```text
Failure detected
  -> classify cause
  -> capture mission, agent, action, cost, and verification evidence
  -> record failure and recommendation in Sibyl
  -> decide whether retry, fallback, recovery, or terminal failure is safe
  -> influence future comparable missions
```

Failure types include agent error, verification failure, provider/network error, budget rejection, payment uncertainty, and internal interruption. Continuity remembers what not to do, but a failure affects only relevant capabilities and mission contexts.

## Recovery lifecycle

```text
Restart/interruption
  -> load mission and action ledger
  -> recall Sibyl checkpoint/recovery context
  -> reconcile Virtuals and Base provider state
  -> determine the last confirmed side effect
  -> resume, retry safely, choose fallback, or fail explicitly
  -> checkpoint the recovered state
```

Every critical action has a mission ID, action ID, and provider/payment identifier. Continuity records intent before an external side effect and its receipt afterward. A confirmed payment or submitted job is never repeated merely because the process restarted.

## MVP scope

- Mission creation, retrieval, listing, cancellation, and explicit lifecycle transitions.
- Genuine Sibyl recall, experience writes, decisions, outcomes, failures, and checkpoints.
- Genuine Virtuals agent discovery and execution for one narrowly defined mission type.
- Capability-specific experience profiles with transparent evidence and confidence.
- Explainable memory-driven agent selection within a budget.
- Focused, versioned result verification.
- Genuine Base payment on the declared network with receipt and idempotency protection.
- Crash recovery that prevents duplicate critical actions.
- A small dashboard showing missions, decisions, memory evidence, verification, and spending.
- The fresh-session and Sibyl-deletion demonstrations defined in `DEMO.md`.

## Explicitly excluded features

- Generic conversational assistant behavior.
- Tokens, NFTs, token launches, staking, or speculative economics.
- DAOs, governance, voting, or treasury products.
- Social networks, feeds, messaging, or community features.
- A new agent marketplace or broad marketplace discovery UX.
- Giant swarms or open-ended multi-agent coordination.
- Universal star ratings or unsupported reputation scores.
- Training a proprietary ranking model.
- General-purpose workflow builders or plugin ecosystems.
- Multiple chains, multiple payment assets, or unrelated DeFi features.
- Fake Sibyl, Virtuals, or Base adapters presented as real integrations.

The scope rule is: **do not build a feature unless it helps Continuity remember something important, make a better decision because of memory, execute that decision, verify it, recover it, or prove the loop works.**
