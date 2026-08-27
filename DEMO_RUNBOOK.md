# Phase 28 — Final Sibyl Load-Bearing Proof

**Production Sibyl cross-process causal proof using controlled simulated agent results.**

This is the exact continuous recording sequence for the mandatory memory gate. The orchestrator creates a unique run namespace and a database path that does not exist, launches Session A, waits for that Node process to terminate, and only then launches Session B. Both sessions use the production `SibylMemoryAdapter`, the official Sibyl MCP process, the production `DecisionEngine`, and the production deterministic `VerificationService`.

The candidate agents and their deliverables are controlled simulations. This proof must never be described as live Virtuals execution.

## One-time setup

From the repository root in PowerShell:

```powershell
python -m venv .sibyl-demo-venv
.\.sibyl-demo-venv\Scripts\python.exe -m pip install sibyl-memory-mcp==0.1.13
npm.cmd --prefix backend ci
$env:SIBYL_MCP_COMMAND = (Resolve-Path ".sibyl-demo-venv\Scripts\sibyl-memory-mcp.exe").Path
```

Do not set a failure, memory-record, result, or citation payload. The orchestrator generates the run ID and fresh database path itself.

For the final recorded evidence, run from a real Git checkout and require a commit hash:

```powershell
$env:CONTINUITY_REQUIRE_GIT_COMMIT = "true"
```

The script fails if that flag is set and `git rev-parse HEAD` cannot return a genuine commit.

## One continuous screen capture

Start recording, keep the same terminal visible, and run exactly:

```powershell
Get-Date -Format o
npm.cmd --prefix backend run demo:sibyl-proof
Get-Date -Format o
```

The single command builds the authoritative backend and runs both child processes. Do not edit the database or terminal output.

From a trusted production service shell, set `CONTINUITY_DEMO_EVIDENCE_DIR=/data/sibyl/proofs` to place the proof database and JSON artifacts on the durable Sibyl disk. The default local output remains `.continuity-demo/phase28/`.

## Required visible causal sequence

Session A prints:

- ISO timestamps, child PID, parent PID, unique run ID, Git commit, mission ID, and both candidate IDs/prices;
- no recalled records for the unique namespace;
- cheap Agent A selected;
- a clearly labelled controlled simulated deliverable;
- deterministic verification failure and failed requirements;
- Continuity memory record ID, official Sibyl entity ID, and official Sibyl journal event ID;
- `application.stop`, after which the orchestrator states that Session A terminated.

Session B then prints:

- a different PID and mission ID with the same persistent database/run namespace;
- the recalled Session A Sibyl record ID;
- Agent A's historical failure count and penalty;
- Agent B selected despite its higher price;
- the exact selection explanation and Sibyl decision citation;
- a controlled successful deliverable, deterministic verification pass, and new Sibyl entity/event IDs;
- `application.stop` and `CAUSAL PROOF PASSED`.

## Machine-readable evidence

Each run writes two ignored local artifacts under:

```text
.continuity-demo/phase28/<run-id>/sibyl-causal-proof.json
.continuity-demo/phase28/<run-id>/sibyl-causal-proof.jsonl
```

The JSON receipt includes the Git commit (or `null` before Git recovery), ISO timestamps, orchestrator and child PIDs, run ID, separate mission IDs, candidate and selected-agent IDs, verification IDs/results, Continuity memory IDs, Sibyl entity/event IDs, decision citations, selection explanations, simulation disclosure, and all causal assertions. The JSONL file is the unedited structured transcript.

## Fail-closed assertions

The command exits non-zero if:

- the Sibyl executable is unavailable or any MCP operation fails;
- the generated database path already exists;
- Session A has prior evidence;
- Session A does not select cheap Agent A and fail the real verifier;
- the official adapter does not return entity and journal IDs;
- either child fails to terminate successfully;
- Session A and B do not have distinct PIDs and mission IDs;
- Session B does not recall and cite Session A's Sibyl entity ID;
- Agent B is not selected after recall;
- Session B does not pass verification and write success to Sibyl;
- final recording requires Git but no genuine commit is available.

Session B's supported inputs are the run ID and persistent database path. Environment keys resembling direct failure/memory/result/citation injection are removed before the child is launched.

## Judge source map

- Controlled lifecycle: `backend/src/demo/fresh-session-recall-demo.ts`
- Cross-process orchestrator: `backend/scripts/fresh-session-recall-demo.mjs`
- Verification-generated write: `backend/src/verification/verification-service.ts`
- Memory write/receipt: `backend/src/memory/memory-service.ts`
- Official Sibyl calls: `backend/src/integrations/sibyl/sibyl-memory-adapter.ts`
- Recall context: `backend/src/memory/decision-memory-context.ts`
- Memory-driven selection: `backend/src/decisions/decision-engine.ts`
- Causal deletion test: `backend/tests/integration/load-bearing-memory-gate.test.ts`
- Deterministic regression: `backend/tests/integration/fresh-session-recall.test.ts`

## Automated checks

```powershell
npm.cmd --prefix backend run test:memory-gate
npm.cmd --prefix backend test -- --run tests/integration/fresh-session-recall.test.ts
```

Those tests use test providers and prove deterministic behavior. Only `npm run demo:sibyl-proof` uses the production adapter and official MCP process; the distinction must remain explicit in the demo and submission.
