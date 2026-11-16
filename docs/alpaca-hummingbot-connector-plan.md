# Alpaca PAPER connector for Hummingbot: implementation plan

## Decision

A repository audit of the pinned Hummingbot source found no Alpaca connector. The official Hummingbot connector list also does not list Alpaca. Condor can run and display the original dashboard, but Alpaca PAPER order execution cannot be claimed as a native Condor/Hummingbot capability.

To keep the user's two constraints together (original Condor/Hummingbot and Alpaca PAPER only), the missing component is a dedicated **Hummingbot spot connector for Alpaca crypto PAPER**. Do not create a parallel Miracolo trading engine as a shortcut.

## Upstream contract

Follow the official connector architecture and development checklist:
- https://hummingbot.org/connectors/connectors/architecture/
- https://hummingbot.org/connectors/connectors/build/
- https://hummingbot.org/connectors/connectors/

Implement the standard Hummingbot connector lifecycle, not a thin REST proxy:
- Authentication and endpoint configuration.
- Trading rules, symbol mapping, minimum order size and precision.
- Order book snapshots/diffs and market-data freshness.
- Private user stream or a verified REST polling fallback for balances, order updates and fills.
- In-flight order tracking, idempotent client order IDs, cancel and status reconciliation.
- Fee calculation, balance updates and correct terminal states for partial fills, rejects and cancellations.

The connector must be discoverable through the Hummingbot API used by Condor. The API/runtime image must include the connector; a connector file in the Miracolo web Worker is not sufficient.

## PAPER-only security boundary

- Trade requests must use exactly `https://paper-api.alpaca.markets/v2`.
- Market data uses the appropriate Alpaca market-data host; never send trade credentials to an untrusted host.
- No LIVE endpoint, LIVE key or fallback is allowed.
- Fail closed if the configured endpoint, account mode, asset status, clock, buying power or market data cannot be verified.
- Secrets must be stored in the Hummingbot API/runtime secret store, never in Condor frontend settings, the browser or Git.
- Preserve the existing Cloudflare D1 database for Miracolo state. Hummingbot API's own persistence requirements are separate and must not replace D1.

## Implementation sequence

1. Freeze the Alpaca crypto PAPER API contract and inspect current Hummingbot connector interfaces at the pinned Hummingbot version.
2. Implement the connector in an isolated Hummingbot fork/patch or supported extension point. Keep upstream Condor unchanged.
3. Add mocked unit tests for authentication, trading rules, order creation/cancel, websocket/polling, partial fills, reconnect and duplicate submissions.
4. Build a custom Hummingbot API runtime image containing the connector and verify `GET /connectors/` lists it.
5. Connect Condor to that API and verify the original dashboard displays the Alpaca account, balances, positions, bots and orders correctly.
6. Run controlled PAPER tests: small order, partial/full fill handling, cancel, restart/reconnect, journal reconciliation and protective exit.
7. Only after all tests pass, consider enabling PAPER order submission. LIVE remains permanently disabled for this integration.

## Reuse from the previous Miracolo Lab

The old Alpaca adapter and executor are reference material for API authentication, PAPER endpoint enforcement and risk checks. They are not themselves a Hummingbot connector. See [alpaca-paper-reuse.md](alpaca-paper-reuse.md) for the audit findings and migration gaps.

## Current status

**Not implemented.** No order execution is enabled. This document is the acceptance plan for the missing connector, not a claim that it exists.
