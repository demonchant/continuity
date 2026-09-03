# Continuity operator workflow

The production dashboard at `/dashboard` is the supported browser control plane. The central operator token is held in browser `sessionStorage`, attached as a bearer credential to protected requests, and removed by **Lock dashboard**.

## Safe execution sequence

1. Create a durable mission with an objective, USDC budget, capabilities, bounded controls, and an optional Base settlement (off by default).
2. Run **Discover Agents**. This reads live Virtuals OAuth discovery and Sibyl history. It does not create, fund, or settle a job.
3. Run the mission. The backend selects through the Sibyl-informed decision engine and creates one ACP job through `@virtuals-protocol/acp-node-v2`.
4. When ACP proposes a budget, the mission pauses in `AWAITING_FUNDING_APPROVAL`. The exact job, amount, and currency are stored only after **Approve ACP spend**. Without that durable approval, `JobSession.fund()` is unreachable.
5. Continuity observes the ACP lifecycle, persists the provider deliverable, verifies it, stores SHA-256 evidence and ACP provenance, and writes the outcome to Sibyl.
6. If the mission requested Base settlement, verified success pauses in `AWAITING_BASE_APPROVAL`. **Approve Base mainnet transaction** stores a separate exact approval. This approval cannot authorize ACP funding, and ACP approval cannot authorize Base settlement.

Production mission plans enforce `maximumRetries: 0`. A consumed approval remains bound to its exact action for idempotent recovery, while an ambiguous side effect blocks blind retry and must be reconciled.
