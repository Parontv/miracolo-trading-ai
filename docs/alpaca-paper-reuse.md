# Reuse the existing Alpaca PAPER integration

The earlier repository `Parontv/Miracolo-lab` already contains a working Alpaca PAPER adapter and an order executor. Do not start a second Alpaca integration from scratch.

Reference files in that repository:
- `alpaca-paper.js`: PAPER-only API adapter for account, clock, positions, orders, order submission and position close.
- `bot-paper-executor.js`: canonical PAPER order executor, including preflight checks, bounded notional, bracket protection for equities and crypto protection monitoring.
- `bot-paper-auto.js`: strategy decision and gated execution flow.
- `bot-position-risk.js`: verifies that active native stop orders cover full open position quantities.
- `alpaca-crypto-paper-test.js`: one-shot $10 BTC/USD round-trip smoke test. This is a test utility, not a production startup action.

## What to reuse

Reuse the server-side request pattern, strict PAPER endpoint validation, order payload handling, client order IDs, broker preflight, position reconciliation and protective-order logic. Keep credentials in Cloudflare Worker Secrets only.

## Required adaptation

The current `miracolo-trading-ai` Worker uses `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY`, while the older application uses `ALPACA_API_KEY` and `ALPACA_API_SECRET`. Choose one canonical naming scheme for this repository and map it explicitly. Never duplicate secrets or put them in the browser.

The current Worker intentionally exposes Alpaca read endpoints only and reports `execution_enabled: false`. Do not connect the old executor directly to an API route or enable automatic execution as part of this UI/Condor change.

Before enabling PAPER orders in this repository, port and test the complete safety path as one unit:
1. Confirm the configured endpoint is exactly `https://paper-api.alpaca.markets/v2`.
2. Validate account state, tradable asset, buying power, existing positions and open orders.
3. Reserve risk and prevent duplicate client order IDs.
4. Submit entry orders and verify fills from Alpaca, including partial fills.
5. Place and verify protective stop orders for the entire filled quantity. Crypto protection must be monitored and reconciled continuously.
6. Handle cancel/replace, timeouts, worker restarts, stale data and emergency exits.
7. Reconcile the D1 journal against Alpaca positions and open/closed orders.
8. Run automated tests and a controlled PAPER smoke test, then verify the account is flat or explicitly report residual exposure.

The older code is the proven starting point, not a reason to skip integration tests. No LIVE endpoint or credential is permitted.
