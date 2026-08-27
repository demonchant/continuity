# Continuity final hackathon demo

Target length: 3:45. The recording must prioritize the causal Sibyl proof and must not turn missing live evidence into narration.

## Evidence status before recording

- Production Sibyl cross-process causal proof: locally verified with controlled simulated agent results.
- Virtuals ACP: implemented and tested, but not live verified until a real external job receipt exists.
- Base: implemented and tested, but not live verified until a confirmed explorer receipt exists.
- Public deployment, video, and PMF evidence: not yet present.

Record the full script only after the live gates exist. If either partner gate is still missing, omit that claim, label the gap on screen, and accept that its multiplier is unverified.

## Exact screen sequence

### 0:00-0:20 - Problem

Show the landing page and say:

> Autonomous systems keep selecting agents based on price and advertised capability. They often forget verified failures. Continuity remembers what agents proved and uses that evidence to decide who gets the next job.

### 0:20-0:50 - Session A

Run the command in `DEMO_RUNBOOK.md`. Show the run ID, timestamp, PID, fresh namespace, both controlled candidates, and prices. Agent A must be selected because it is cheaper. Show its controlled simulated deliverable failing the production deterministic verifier, followed by the Continuity memory ID and official Sibyl entity/event IDs.

Keep this label visible: **Production Sibyl cross-process causal proof using controlled simulated agent results.**

### 0:50-1:10 - Process boundary

Show Session A's explicit stop and exit, then Session B starting with a different PID and mission ID. Do not provide Session A's failure payload to Session B.

### 1:10-1:40 - Session B

Show the same Sibyl record recalled through the production adapter. Show Agent A's historical penalty, Agent B's higher price, Agent B's selection, and the exact decision citation. Show Agent B's controlled result passing verification and the new Sibyl success record.

### 1:40-2:20 - Live Virtuals gate

Only include this segment after `backend/scripts/virtuals-live-smoke.mjs` or the complete mission smoke has produced a real receipt. Show the real provider, offering semantics, ACP job ID, proposed amount, funding state, actual deliverable, Continuity verification, and completion/rejection state. Do not call the controlled Session A/B candidates live Virtuals agents.

### 2:20-2:50 - Live Base gate

Only include this segment after a confirmed real transaction. Explain that Virtuals funding pays the external agent job, while the Base action is a separate mission-level settlement triggered after successful verification. Show the network, tiny amount, recipient, transaction hash, confirmations, and explorer page. Never display a key, token, RPC URL, or authorization header.

### 2:50-3:20 - Sibyl outcome

Show the verified mission outcome and transaction linkage written to Sibyl. Display real record IDs and explain that a later comparable mission can cite this outcome.

### 3:20-3:45 - Judge Mode and close

Show the public, read-only mission timeline and causal banner:

> PREVIOUS FAILURE -> SIBYL MEMORY -> AGENT A PENALIZED -> AGENT B SELECTED

Close with:

> Continuity doesn't just remember what agents said. It remembers what they proved - and uses that evidence to decide who gets the next job.

## Exact commands

From a genuine Git checkout, require the commit hash and run the controlled memory proof:

```powershell
$env:CONTINUITY_REQUIRE_GIT_COMMIT = "true"
npm.cmd --prefix backend run demo:sibyl-proof
```

For the real partner mission, after deploying with funded, scoped credentials:

```powershell
$env:CONTINUITY_API_URL = "https://<public-service>/api/v1"
$env:CONTINUITY_OPERATOR_TOKEN = "<operator token>"
$env:VIRTUALS_OPERATOR_TOKEN = "<Virtuals route token>"
$env:BASE_OPERATOR_TOKEN = "<Base route token>"
node backend/scripts/mission-runner-live-smoke.mjs
```

The partner command is a live economic action. Run it once only after checking wallet balance, offering, recipient allowlist, budgets, and network.

## Backup plan

- Record one successful live partner mission in advance and preserve its redacted JSON receipt.
- If an external network fails during filming, show the unedited prior receipt and public explorer/job evidence, explicitly saying it is a recorded live run.
- Never replace a missing live receipt with mocked output, a screenshot-only identifier, or a placeholder.
- If live partner evidence does not exist before the deadline, submit the verified Sibyl proof and disclose that the partner multiplier is not claimed.

## Evidence checklist

- [ ] Genuine commit hash visible.
- [ ] Session A/B timestamps, distinct PIDs, distinct mission IDs, and one unique run ID.
- [ ] Official Sibyl entity/event IDs and recalled decision citation.
- [ ] Controlled simulation label visible during the causal proof.
- [ ] Real Virtuals agent, offering, external job ID, deliverable, verification, and settlement receipt.
- [ ] Real Base transaction hash, receipt, confirmations, and public explorer URL.
- [ ] PostgreSQL mission receipt and final state.
- [ ] Public Judge Mode uses runtime data and works signed out.
- [ ] No secrets or personal data visible.
- [ ] Video URL works signed out and duration is 2-5 minutes.
