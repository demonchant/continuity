# Base Sepolia Configuration Checklist

This checklist contains names and read locations only. Never commit or print secret values.

| Variable                    | Purpose                                                                                                              | Where it is read                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | PostgreSQL connection required to start the backend and persist missions/transactions.                               | `backend/prisma/schema.prisma`; `backend/src/config/environment.ts`; `backend/src/config/index.ts`; `backend/src/server.ts`                               |
| `BASE_ENABLED=true`         | Enables construction of the real Base viem adapter, payment service, routes, and economic/runner wiring.             | `backend/src/config/environment.ts`; `backend/src/config/index.ts`; `backend/src/server.ts`                                                               |
| `BASE_NETWORK=base-sepolia` | Selects Base Sepolia and chain metadata.                                                                             | `backend/src/config/environment.ts`; `backend/src/config/index.ts`; `backend/src/integrations/base/base-viem-adapter.ts`                                  |
| `BASE_RPC_URL`              | Optional RPC endpoint. If omitted, configuration defaults to `https://sepolia.base.org` for Base Sepolia.            | `backend/src/config/index.ts`; passed to `BaseViemAdapter.create()` in `backend/src/server.ts`                                                            |
| `BASE_PRIVATE_KEY`          | Dedicated signing key for the server-side demo wallet.                                                               | `backend/src/config/environment.ts`; `backend/src/config/index.ts`; `backend/src/server.ts`; `backend/src/integrations/base/base-viem-adapter.ts`         |
| `BASE_PAYMENT_RECIPIENT`    | Valid destination address and configured payment allowlist target.                                                   | `backend/src/config/environment.ts`; `backend/src/config/index.ts`; `BasePaymentService` constructor; mission/economic runner recipient checks            |
| `BASE_PAYMENT_ASSET=ETH`    | Asset transferred by the payment service. `ETH` is the simplest Base Sepolia smoke path.                             | `backend/src/config/environment.ts`; `backend/src/config/index.ts`; `backend/src/integrations/base/base-payment-service.ts`                               |
| `BASE_TOKEN_ADDRESS`        | Required when using `USDC`; configuration supplies the Base Sepolia USDC default if omitted.                         | `backend/src/config/index.ts`; `BasePaymentService` constructor; `BaseViemAdapter.sendTokenTransfer()`                                                    |
| `BASE_MAX_PAYMENT_AMOUNT`   | Upper bound for one Base payment; default is `0.001` in the configured asset units.                                  | `backend/src/config/environment.ts`; `backend/src/config/index.ts`; `BasePaymentService`                                                                  |
| `BASE_CONFIRMATIONS`        | Number of confirmations awaited before `CONFIRMED`; default is `1`.                                                  | `backend/src/config/environment.ts`; `backend/src/config/index.ts`; `BasePaymentService`; `BaseViemAdapter.waitForConfirmation()`                         |
| `BASE_RPC_TIMEOUT_MS`       | RPC request timeout; default is `10000` ms.                                                                          | `backend/src/config/environment.ts`; `backend/src/config/index.ts`; `BaseViemAdapter.create()`                                                            |
| `BASE_RPC_RETRY_COUNT`      | RPC transport retry count; default is `2`.                                                                           | `backend/src/config/environment.ts`; `backend/src/config/index.ts`; `BaseViemAdapter.create()`                                                            |
| `BASE_OPERATOR_TOKEN`       | Bearer token required by the `/api/v1/base/*` routes and directly required by `backend/scripts/base-live-smoke.mjs`. | `backend/scripts/base-live-smoke.mjs`; `backend/src/integrations/base/base-routes.ts`; `backend/src/config/environment.ts`; `backend/src/config/index.ts` |
| `BASE_ALLOW_MAINNET`        | Must be `true` only for `BASE_NETWORK=base`; leave `false` for Base Sepolia.                                         | `backend/src/config/environment.ts`                                                                                                                       |
| `BASE_LIVE_AMOUNT`          | Optional smoke amount; defaults to `0.000001`. It becomes the mission budget and payment amount.                     | `backend/scripts/base-live-smoke.mjs`                                                                                                                     |
| `BASE_LIVE_AGENT_ID`        | Optional smoke metadata identifier; defaults to `continuity-live-agent`. It is not a wallet or recipient address.    | `backend/scripts/base-live-smoke.mjs`                                                                                                                     |
| `CONTINUITY_URL`            | Optional smoke API base URL; defaults to `http://127.0.0.1:3000`.                                                    | `backend/scripts/base-live-smoke.mjs`                                                                                                                     |

## Chain And Funding

- Base Sepolia chain ID: **84532**.
- For `BASE_PAYMENT_ASSET=ETH`, fund the dedicated `BASE_PRIVATE_KEY` wallet with a small amount of Base Sepolia ETH. It pays both gas and the transfer amount.
- For `BASE_PAYMENT_ASSET=USDC`, fund the wallet with Base Sepolia ETH for gas and enough Base Sepolia USDC for the transfer. The configured token address must be the intended Base Sepolia USDC contract.
- `BASE_PAYMENT_RECIPIENT` must be a valid `0x` address. For the direct smoke script it is the destination used by `BasePaymentService`. For the mission runner/economic path it is also an allowlist: the selected external Virtuals candidate's `externalId` must exactly match it case-insensitively, or the runner rejects the action.

## Smoke Command

From the repository root:

```powershell
npm.cmd --prefix backend run base:smoke
```

Equivalent:

```powershell
Set-Location backend
npm.cmd run base:smoke
```

The script creates a mission through the running API, posts `/api/v1/base/payments` with the bearer token, and requires `CONFIRMED` plus a transaction hash. It prints the mission ID, hash, network, amount, status, and explorer URL.

## Does The Smoke Test Need `DATABASE_URL`?

The smoke script itself does not read `DATABASE_URL`. The running backend does: `DATABASE_URL` is mandatory in the environment schema and Prisma schema, and the server needs it to persist the created mission and Base transaction. Therefore it is required for a real smoke run even though it is not a variable read by `base-live-smoke.mjs`.

## Does The Smoke Test Need `BASE_OPERATOR_TOKEN`?

Yes. `base-live-smoke.mjs` exits immediately when `BASE_OPERATOR_TOKEN` is absent and sends it as `Authorization: Bearer ...`. The Base router validates it for both payment creation and transaction reads. It is not a blockchain signing secret; `BASE_PRIVATE_KEY` remains server-side.

## Required Local Inputs Before A Real Run

Provide locally, without committing them:

1. A running PostgreSQL instance and valid `DATABASE_URL`.
2. A running backend configured with `BASE_ENABLED=true`, `BASE_NETWORK=base-sepolia`, a funded dedicated `BASE_PRIVATE_KEY`, a valid `BASE_PAYMENT_RECIPIENT`, and a `BASE_OPERATOR_TOKEN` of at least 20 characters.
3. Base Sepolia ETH funding for gas and the configured ETH payment amount, or ETH plus USDC if using `BASE_PAYMENT_ASSET=USDC`.
4. Optional overrides only if needed: `BASE_RPC_URL`, `BASE_LIVE_AMOUNT`, `BASE_LIVE_AGENT_ID`, `CONTINUITY_URL`, timeout/retry/confirmation settings.

No live transaction was attempted or verified by this inspection.
