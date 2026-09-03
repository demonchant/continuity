# Continuity Production End-to-End Workflow

This is the complete operating workflow for Continuity at
`https://continuity-yj3l.onrender.com`. It covers acquisition, access,
organizations, mission execution, payment approval, verification, memory,
recovery, and judge evidence.

## 1. Actors, roles, and wallets

| Actor or wallet                  | Purpose                                                          | Financial authority               |
| -------------------------------- | ---------------------------------------------------------------- | --------------------------------- |
| Public visitor                   | Reads the site and requests beta access                          | None                              |
| Continuity operator              | Reviews requests in the protected dashboard                      | Administrative approval only      |
| Organization owner               | Manages a customer workspace and invites members                 | Approves exact ACP/Base proposals |
| Organization operator            | Creates, discovers, and runs missions                            | Cannot approve payments           |
| Finance approver                 | Reviews exact payment proposals                                  | Approves exact ACP/Base proposals |
| Viewer                           | Reads organization evidence and runs no-spend discovery          | None                              |
| Judge                            | Uses an isolated no-spend sandbox and public Judge Mode          | None                              |
| MetaMask account `0xf7c1...3245` | Customer-controlled funding/source account for the demonstration | MetaMask owner only               |
| ACP wallet `0x576c...dae9`       | Registered Continuity Virtuals wallet that pays ACP escrow       | Bounded ACP lifecycle only        |
| `0x5A46...C22`                   | Optional verified Base settlement recipient                      | None                              |

The two user-provided addresses are separate accounts inside the same MetaMask
installation. That does not make either one the registered Virtuals wallet.
Never put a seed phrase, private key, signer key, wallet ID, OAuth token,
operator token, password, session, or invitation token in source, chat, or a
screen recording.

## 2. Visitor requests access

1. The visitor opens the public site and selects **Request beta access**.
2. They submit email, role, workflow, and required contact consent.
3. `POST /api/v1/beta-signups` validates and stores the request in PostgreSQL.
4. When Resend is configured, Continuity emails the beta administrator.
5. Without email configuration, the stored request still appears in protected
   Beta Access administration. Notification delivery is not the system of
   record.

## 3. Operator grants or rejects access

1. The operator opens `/dashboard/access` and authenticates with the existing
   operator token.
2. The operator reviews the applicant's details.
3. The operator chooses:
   - **Customer**: configurable spending and organization roles.
   - **Judge sandbox**: forced `JUDGE` role with spending disabled.
4. For a customer, the operator sets workspace name, initial role, maximum
   mission budget, maximum ACP job amount, and paid-execution status.
5. Approval atomically creates the organization and a hashed, expiring,
   single-use invitation, then marks the request `APPROVED`.
6. If email succeeds, the applicant receives the link. Otherwise the operator
   securely copies the manual invitation URL shown by the dashboard.
7. The operator can reject a request or revoke and reissue an unused invite.

Customers never receive or use the Continuity operator token.

## 4. Account creation and login

1. The applicant opens `/access/invite?token=...`.
2. They enter a name and a password of at least 12 characters.
3. The server hashes the password with scrypt; it never stores the raw value.
4. The invitation is consumed once and cannot be reused.
5. Continuity creates the organization membership and an opaque session.
6. The browser receives an `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
7. Future login is at `/access`; logout revokes the session server-side.

If an existing user joins another organization, the invitation does not reset
their existing password.

## 5. Organization team and permissions

At `/portal`, an owner can invite `OPERATOR`, `FINANCE_APPROVER`, and `VIEWER`
members. Each invitation is expiring, single-use, and organization-scoped.

Every portal query checks the signed-in organization ID. Customer missions and
Sibyl records from another organization are excluded. Role enforcement also
happens at the API, so hiding a button is never the security boundary.

## 6. Judge workflow

There are two judge paths:

1. `/dashboard/judge` is public and read-only. It shows safe terminal receipts
   without secrets or approval internals.
2. An invited Judge sandbox account can create a sandbox mission, inspect its
   own evidence, and run live no-spend discovery.

A Judge workspace cannot enqueue paid execution or approve ACP/Base payments,
even through a direct API call.

## 7. Create the production demonstration mission

Use the prefilled customer-portal values:

- Objective: `Create a fresh, sourced crypto news brief on AI agent payments on Base.`
- Capability: `crypto news research`
- Budget: `0.10 USDC`
- ACP offering input:

```json
{
  "topic": "AI agent payments on Base",
  "timeframe": "24h",
  "focus": "analysis"
}
```

The provider input is separate from runner and policy controls. Only that JSON
object is sent to the selected ACP offering.

## 8. Run the no-spend discovery gate

1. Open the mission and select **Discover agents (no spend)**.
2. Continuity queries current online public Base ACP offerings.
3. It rejects hidden, private, malformed, over-budget, self-owned, or
   capability-incompatible offerings.
4. Review the offering, provider, price, requirement schema, compatibility
   reasons, and alternatives.
5. Do not select **Run mission** unless discovery returns a compatible offering.

This avoids repeating the earlier failed mission whose combined
`research + analysis` requirement returned no executable public offering.

## 9. Fund the registered ACP wallet

Fund only this address for ACP jobs:

`0x576ce0a71711e0d45d9ede753c355a74a5a4dae9`

Use Base Mainnet (`8453`) and native Base USDC. One USDC is sufficient for the
`0.10 USDC` demonstration budget and a `0.02 USDC` offering with a buffer. Add a
small amount of Base ETH only if the signer is not gas sponsored.

Verify before and after the transfer:

```powershell
npx.cmd --yes @virtuals-protocol/acp-cli@1.0.34 agent whoami --json
npx.cmd --yes @virtuals-protocol/acp-cli@1.0.34 wallet balance --chain-id 8453
```

Funding the settlement recipient does not fund ACP escrow.

## 10. Run and approve one ACP payment

1. An owner or operator selects **Run mission**.
2. The runner parses bounded limits and recalls only this organization's Sibyl
   experience.
3. It discovers candidates, selects one explainably, and records the decision.
4. It creates one idempotent ACP job.
5. When the provider proposes a budget, the mission pauses at
   `AWAITING_FUNDING_APPROVAL`.
6. Only an owner or finance approver sees **Approve one-time ACP payment**.
7. The server checks the exact mission, action, external job, amount, currency,
   organization cap, and global cap.
8. Approval authorizes that job once. It is not a subscription, recurring
   payment, or standing allowance.
9. The worker resumes and funds the existing ACP escrow. Another spend requires
   a new proposal and approval.

## 11. Provider result and verification

1. Continuity polls the existing ACP job; recovery does not create a replacement.
2. The provider submits a deliverable.
3. Continuity captures provider/job/offering provenance and an evidence hash.
4. The deterministic verifier checks the declared requirements.
5. A pass records verified experience and a success outcome in Sibyl.
6. A failure records failed requirements and an agent penalty recommendation.
7. The ACP job is completed only after a pass; otherwise it is rejected.

## 12. Optional Base settlement

Base settlement is separate from ACP escrow:

1. The mission must explicitly request `MISSION_SUCCESS_SETTLEMENT`.
2. The ACP result must already have passed verification.
3. The mission pauses at `AWAITING_BASE_APPROVAL`.
4. An owner or finance approver approves the exact settlement once.
5. Continuity enforces network, asset, ceiling, idempotency key, and recipient:
   `0x5A46a3882a1B83eBEACBE57695D2Cf10D8A6CC22`.
6. The transaction must become `CONFIRMED` before mission completion.

ACP funding and Base settlement must never be presented as the same payment.

## 13. Recovery and double-spend protection

1. Every critical external action is recorded before and after execution.
2. Checkpoints contain mission, action, payment, verification, selected agent,
   and next-action state.
3. After interruption, Continuity reconciles the existing ACP job and Base
   transaction.
4. A known completed action is not repeated.
5. An ambiguous outcome becomes `UNCERTAIN`; the runner does not spend again to
   produce a cleaner demonstration.
6. Terminal missions cannot be rerun.

## 14. Complete production evidence

A successful live receipt must show:

- mission `COMPLETED`;
- selected provider and offering;
- real external ACP job ID;
- exact one-time approval;
- verification `PASS` and evidence hash;
- Sibyl records retrieved before selection;
- decision-cited Sibyl IDs;
- outcome/experience written afterward;
- confirmed Base hash only when settlement was requested.

Judge Mode removes secrets and internal approvals while preserving the causal
memory-to-decision proof.

## 15. Current completion state

Already deployed:

- PostgreSQL and forward migrations;
- durable Sibyl MCP storage;
- beta request form and protected administration;
- organizations, accounts, sessions, roles, and team invitations;
- manual invitation fallback;
- tenant-scoped missions and memory;
- judge sandbox and public Judge Mode;
- exact one-time ACP/Base approvals;
- provider-specific ACP inputs;
- recovery and idempotency controls;
- configured settlement recipient.

External activation still required:

1. Fund the registered ACP wallet and complete one real paid job.
2. Configure these three Render variables together for automatic email:
   `RESEND_API_KEY`, `ACCESS_EMAIL_FROM`, and `BETA_ADMIN_EMAIL`.
3. Confirm the Base sender has gas and its private key is entered directly in
   Render—not source or chat.
4. Preserve the final mission, ACP job, verification, Sibyl, and optional Base
   transaction identifiers.

The application workflow is implemented and deployed. Until those external
activation steps produce receipts, do not claim a fully funded end-to-end run.

## 16. Final screen-recording order

1. Show the public landing page and submit a prepared beta request.
2. Open protected Beta Access administration and show the pending request.
3. Approve it as a Judge sandbox and show that spending is forced off.
4. Accept the invite, enter `/portal`, create a sandbox mission, and run
   no-spend discovery.
5. Show that no paid controls are available to the judge.
6. Switch to a prepared customer owner account.
7. Show workspace caps, roles, team invitation, and one-time payment policy.
8. Create the prefilled demonstration mission.
9. Run no-spend discovery and pause on the real compatible offering.
10. Show the funded ACP balance without exposing credentials.
11. Run the mission and pause at `AWAITING_FUNDING_APPROVAL`.
12. Approve the exact one-time ACP proposal.
13. Refresh until the provider result and verification `PASS` appear.
14. If requested, approve Base settlement once and show its explorer receipt.
15. End in public Judge Mode on the completed causal evidence chain.

Do not record tokens, invitation URLs, passwords, keys, wallet IDs, OAuth data,
environment variables, or browser developer storage.
