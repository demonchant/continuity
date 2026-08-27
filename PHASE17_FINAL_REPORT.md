# Phase 17 Final Verification Report

Phase 18 was not started. This report covers only the remaining durable PostgreSQL restart/recovery gate.

## Diagnosis of the previous no-output command

The command as originally shown did not set `TEST_DATABASE_URL`. The recovery suite uses:

```ts
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
```

Therefore `DATABASE_URL` alone is insufficient and a bare invocation can only skip the suite. The root Vitest configuration supplies a placeholder `DATABASE_URL`, but it does not supply `TEST_DATABASE_URL`.

The earlier sandboxed attempt also could not read the repository/Vitest configuration and failed before test execution. A later elevated attempt was canceled before its process result was returned. Safe diagnostics found no remaining Vitest/Node process, PostgreSQL session, lock, or stopped fixture. The no-output/hang behavior could not be reproduced once both URLs were explicitly propagated: the final command completed normally in 3.29 seconds of Vitest time (6.93 seconds wall time).

## Fixture diagnostics

| Check                           | Actual result                                                                                               | Result   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| PostgreSQL at `127.0.0.1:55439` | `continuity-phase17-postgres` was running with `55439 -> 5432`; `pg_isready` reported accepting connections | PASS     |
| Database                        | Authenticated connection returned `continuity_phase17`                                                      | PASS     |
| Credentials                     | TCP password authentication returned database/user `continuity_phase17                                      | phase17` | PASS |
| Prisma deployment               | Four completed migrations were present                                                                      | PASS     |
| Environment propagation         | Final process received both `TEST_DATABASE_URL` and `DATABASE_URL`; no secret was logged                    | PASS     |
| Test discovery                  | Vitest discovered exactly one selected file and one test                                                    | PASS     |
| Open database connection/hang   | Zero other sessions existed before execution; both test workers explicitly disconnect                       | PASS     |
| Environment guard               | Guard confirmed; it skips when `TEST_DATABASE_URL` is absent, and ran when it was present                   | PASS     |
| Canceled-command residue        | No relevant Node/Vitest process or PostgreSQL session remained                                              | PASS     |

## Test result

### 1. Test name

`Prisma recovery restart and idempotency > recovers in a new OS process and returns the prior action receipt`

### 2. Purpose

Prove that mission checkpoint and critical-action state survive application-process termination, that a distinct process can recover and resume the mission, and that retrying the completed action does not repeat its side effect.

### 3. Environment

- Windows host
- PostgreSQL 16 Alpine in local Docker container `continuity-phase17-postgres`
- Host endpoint `127.0.0.1:55439`
- Database `continuity_phase17`, user `phase17`
- Prisma schema with all four repository migrations deployed
- Vitest 3.2.7, one worker
- Test-only memory adapter; production Sibyl integration was not changed

### 4. Command

The password-bearing URL was supplied through process environment variables and is intentionally redacted here:

```powershell
$env:TEST_DATABASE_URL='<redacted PostgreSQL URL for 127.0.0.1:55439/continuity_phase17>'
$env:DATABASE_URL=$env:TEST_DATABASE_URL
npm.cmd test -- --run backend/tests/integration/recovery-database.test.ts --maxWorkers=1 --reporter=verbose
```

### 5. Expected result

1. Session A starts a mission.
2. Session A durably writes two checkpoint versions and one completed action receipt.
3. Session A disconnects and its Node process exits.
4. Session B starts in a distinct Node process.
5. Session B recovers checkpoint state `VERIFYING`, version 2.
6. It recognizes that `agent-job` already completed as `job-db-1` and must not be repeated.
7. Recovery reports `verify-result` remains and permits safe resume.
8. The resume callback executes.
9. A duplicate action request returns the original receipt without invoking the side-effect callback.
10. The durable action attempt count remains 1.

### 6. Actual result

All expectations executed successfully. Vitest reported:

```text
Test Files  1 passed (1)
Tests       1 passed (1)
Duration    3.29s
```

The test asserts different Session A and Session B process IDs, recovered PostgreSQL state, `canSafelyResume: true`, `resumeCalled: true`, `duplicateDeduplicated: true`, `duplicateSideEffectCalled: false`, the original `job-db-1` receipt, and `actionAttempts: 1`.

### 7. Result

**PASS**

The post-change TypeScript typecheck also passed. Formatting was applied to the two test-only files.

### 8. Skipped external tests

No test in the selected recovery suite was skipped. Other database suites and live Sibyl, Virtuals, and Base provider executions were not rerun by this scoped command; their previously reported verification status is unchanged.

### 9. Known limitations

- The test restarts the application boundary as two real Node processes while deliberately keeping PostgreSQL running; it does not restart the PostgreSQL server itself.
- The critical side effect is a deterministic test callback with a durable provider receipt, not a live Virtuals job or Base transaction. Live provider behavior is outside this recovery-only gate.
- Recovery checkpoint writes use the test-only memory adapter so this test remains isolated from Sibyl credentials. Production memory code and integration were not modified.

## Exact verification files

- Recovery integration assertion: `backend/tests/integration/recovery-database.test.ts`
- Separate-process test worker: `backend/tests/support/recovery-process-worker.ts`
- Production recovery orchestration exercised by the test: `backend/src/recovery/recovery-service.ts`
- PostgreSQL persistence exercised by the test: `backend/src/recovery/prisma-recovery-repository.ts`
