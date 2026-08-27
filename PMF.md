# Continuity Product-Market Evidence Log

This document records evidence; it does not calculate or claim a product-market-fit score. Empty sections are intentionally empty until a real person or durable signup provides evidence.

Last reviewed: 2026-08-27

## Target audience

### Primary

- AI agent developers who choose between models, tools, or external agents at runtime.
- Autonomous-agent builders responsible for retries, verification, recovery, and cost controls.
- Teams building multi-agent workflows where task-specific reliability matters more than a static capability label.

### Problem hypothesis to validate

Builders lack a practical way to turn prior agent outcomes—including failed verification—into evidence that changes later agent selection and recovery. The hypothesis is not evidence until interviews, observed workflows, or usage confirm it.

### Strong qualification signals

- Operates two or more agents, models, providers, or execution paths.
- Has repeated or comparable missions rather than one-off prompts.
- Currently reviews logs, spreadsheets, traces, or dashboards to decide what to retry.
- Has experienced a repeated failure, duplicate side effect, or avoidable agent cost.
- Can describe an upcoming workflow where memory-driven selection could be tested.

## Interview questions

Ask for a recent concrete example before showing Continuity.

1. Walk me through the last time an agent result failed or needed a retry. What happened next?
2. How do you choose an agent, model, or provider for a task today?
3. What information from prior runs is available at selection time? Who looks at it?
4. When the same kind of task runs again, how does the system avoid repeating a known failure?
5. How do you decide whether an agent result is actually successful?
6. What is the cost of a bad selection in time, money, or operator attention?
7. How do you recover after an interrupted run? Which actions must never be repeated?
8. Show me the logs, traces, or records you use for one recent decision, if you can safely do so.
9. Which part of the workflow is painful enough that you have already tried to fix it?
10. After seeing Continuity, where would it fit—or fail to fit—in your architecture?
11. What evidence would you need before allowing historical outcomes to affect agent selection?
12. Would you test this on one real workflow in the next 30 days? What would block that test?
13. Who else is involved in approving or operating that workflow?
14. May we follow up? Separately, may any specific feedback be quoted publicly with your name?

Avoid asking “Would you use this?” without a concrete workflow, timeline, and next action.

## User feedback

No verified user interview feedback has been recorded yet.

When feedback is collected, add one row per session. Paraphrases remain private unless the participant separately approves a specific public quote.

| Evidence ID     | Date | Participant ID | Audience fit | Current workflow | Observed problem | Objection | Adoption signal | Follow-up | Evidence location |
| --------------- | ---- | -------------- | ------------ | ---------------- | ---------------- | --------- | --------------- | --------- | ----------------- |
| _None recorded_ | —    | —              | —            | —                | —                | —         | —               | —         | —                 |

## Actual testers

No external tester has been verified yet. The project team and automated test suite are not counted as user evidence.

| Tester ID       | First test date | Audience fit | Real workflow tested | Sessions completed | Result/evidence | Follow-up committed | Public attribution permission |
| --------------- | --------------- | ------------ | -------------------- | ------------------ | --------------- | ------------------- | ----------------------------- |
| _None recorded_ | —               | —            | —                    | —                  | —               | —                   | —                             |

## Actual design partners

No design partner has been verified yet. A conversation, waitlist signup, or generic expression of interest is not labeled a design partnership. Record a partner only after a named team commits to review or test a concrete workflow.

| Partner ID      | Organization | Named workflow | Commitment | Owner | Next milestone/date | Evidence location | Public attribution permission |
| --------------- | ------------ | -------------- | ---------- | ----- | ------------------- | ----------------- | ----------------------------- |
| _None recorded_ | —            | —              | —          | —     | —                   | —                 | —                             |

## Waitlist data

Verified waitlist entries documented here: **0**.

The landing page writes private-beta requests to the PostgreSQL `BetaSignup` table through `POST /api/v1/beta-signups`. It does not expose a public count, and an email can occupy only one row. Repeat submissions update that row rather than increasing the count.

Before changing the number above, query the deployed production database and record the query date and environment. Do not paste email addresses into this document.

```sql
SELECT COUNT(*) AS consented_beta_signups
FROM "BetaSignup"
WHERE "consentToContact" = true;
```

| Snapshot date | Environment                   | Consented unique signups | Audience-qualified after review | Interviews completed | Evidence owner |
| ------------- | ----------------------------- | -----------------------: | ------------------------------: | -------------------: | -------------- |
| 2026-08-22    | No public production snapshot |                        0 |                               0 |                    0 | Project owner  |

## Product changes made from feedback

No product change has yet been attributed to external user feedback. The current landing page, interview guide, and signup instrumentation are validation infrastructure, not proof of demand.

Record only shipped or explicitly scheduled changes that map to traceable feedback.

| Change ID       | Feedback evidence IDs | Repeated signal | Decision | Product change | Shipped date | Validation result |
| --------------- | --------------------- | --------------- | -------- | -------------- | ------------ | ----------------- |
| _None recorded_ | —                     | —               | —        | —              | —            | —                 |

## Attribution and consent

- Contact consent and public attribution permission are separate fields.
- The signup form states that attribution permission does not grant blanket permission to quote a submission.
- Before publishing a quote, capture the exact approved wording, display name, organization (if any), approval date, and durable evidence location.
- Never publish an email address, private interview note, company name, logo, or partnership claim without explicit permission.
- A participant may revoke attribution; record the request and remove the public claim.

| Consent record  | Participant ID | Exact approved material | Approved display name | Organization permission | Approval date | Evidence location | Revoked date |
| --------------- | -------------- | ----------------------- | --------------------- | ----------------------- | ------------- | ----------------- | ------------ |
| _None recorded_ | —              | —                       | —                     | —                       | —             | —                 | —            |

## Evidence collection cadence

1. Recruit from the named audience, not a general consumer audience.
2. Conduct the interview around a recent failure or selection event.
3. Ask for a concrete test workflow and next date.
4. Record the evidence ID and private source location immediately.
5. Update only aggregate waitlist counts in this document.
6. Review weekly for repeated problems, objections, and committed tests.
7. Change the product only when the evidence and decision are traceable in the table above.

## Two-minute tester workflow

Use the public Judge Mode; do not require an operator token and do not let the tester trigger economic actions.

1. Read the one-sentence product claim and the causal banner.
2. Open one completed mission receipt.
3. Identify the previous verified failure and its Sibyl record ID.
4. Compare the candidate prices, compatibility, historical evidence, and scores.
5. Explain in the tester's own words why the selected agent received the job.
6. Inspect the verification result and the new Sibyl outcome record.
7. Answer whether this evidence would improve a real workflow they operate.

If no completed public mission exists, use a screen-shared controlled Sibyl proof and label the simulated agent results. That session can validate comprehension and pain, but it is not product-usage evidence.

## Dated tester evidence form

Create one durable record per real external participant. Keep contact details private; publish only consented material.

| Field                      | Required evidence                                                  |
| -------------------------- | ------------------------------------------------------------------ |
| Evidence ID                | Stable, non-identifying ID such as `PMF-2026-08-27-01`             |
| Date and timezone          | ISO date/time                                                      |
| Tester type                | Role and relevant agent workflow                                   |
| Workflow                   | Concrete task the person currently performs                        |
| Problem encountered        | Recent failure, retry, cost, or selection problem                  |
| Continuity result observed | Mission/record IDs or recording URL, if safe                       |
| Useful?                    | Yes/no plus the participant's reason                               |
| Requested improvement      | Specific objection or requested change                             |
| Next commitment            | None, follow-up, test date, pilot, or design-partner commitment    |
| Attribution consent        | Private only, anonymous public summary, or exact named attribution |
| Evidence location          | Durable private source and optional public URL                     |

## Product decision log

Only decisions backed by external evidence belong here. Internal hypotheses and automated test results are not PMF evidence.

| Decision ID     | Date | Evidence IDs | Decision | Product impact | Verification date/result |
| --------------- | ---- | ------------ | -------- | -------------- | ------------------------ |
| _None recorded_ | -    | -            | -        | -              | -                        |
