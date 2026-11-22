# Cloudflare Workers deployment

This deployment hosts the Miracolo web dashboard, edge API, scheduled market-data scanner and D1 journal. The browser does not need to remain open. This Cloudflare deployment is **not** a Condor/Hummingbot runtime: those upstream services require a persistent host and Hummingbot API/Docker. Until that runtime is deliberately provided, the Cloudflare app is limited to dashboard, market monitoring and read-only Alpaca PAPER checks. Do not describe the complete Condor/Hummingbot trading system as 24/7 operational on Workers alone.

## Deploy using the existing D1 database

1. **Do not create another D1 database.** In Cloudflare, locate the existing `miracolo-trading-ai` database and verify its UUID and account.
2. In GitHub repository Settings > Secrets and variables > Actions, verify these existing secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `D1_DATABASE_ID` (must be the UUID of the existing database)
3. The deploy workflow substitutes that UUID into the temporary Wrangler config, applies the repository's pending D1 migrations, then deploys the Worker and `web/` assets. It does not create a new database or write the UUID into Git.
4. Preserve the existing D1 binding name `DB`. Do not delete, replace, or recreate the database to resolve a configuration error. If the secret does not match the existing database, stop and correct the secret before deploying.

The workflow requires a Cloudflare API token with Workers Scripts:Edit and D1:Edit permissions. Never paste the database UUID or any credentials into source files or chat.

## Connect the original Condor dashboard

1. Install and run the official Condor application on a persistent Linux/WSL2 host, together with Hummingbot API and its Docker services as required by the upstream setup.
2. Keep Condor bound to localhost. **Preferred private access:** install Tailscale on the host and the Android phone, connect both to the same tailnet, then run `tailscale serve --bg 8088` on the host (or on Windows if WSL2 localhost forwarding exposes Condor there). Tailscale Serve provides an HTTPS `.ts.net` URL reachable only from the tailnet. Do not use Tailscale Funnel.
3. If a public hostname is specifically required, use Cloudflare Tunnel with a Cloudflare Access Allow policy in front of Condor. Never publish port 8088 or Hummingbot API port 8000 directly.
4. Add the resulting HTTPS dashboard URL as the GitHub Actions secret `CONDOR_WEB_URL`. The deploy workflow uploads it as a Worker secret. The Miracolo sidebar entry `Condor` redirects to that original dashboard in a new tab. The Worker rejects non-HTTPS destinations.
5. Keep Tailscale connected on the phone when using the private `.ts.net` URL. Verify the dashboard and Hummingbot API health separately; a successful redirect alone does not prove that Condor or its bots are healthy.

The Cloudflare Worker and D1 database remain the Miracolo web/API layer. They do not run Condor or Hummingbot containers.

## Protect the application and connect Alpaca

After the first deployment:

1. In Cloudflare Zero Trust, open **Access > Applications** and create a **Self-hosted** application for the production hostname path `/api/alpaca/*`. Do not select **Protect this Worker behind Access** for the whole Worker: the public health endpoint and unauthenticated deployment smoke test must remain reachable.
2. Require sign-in and create an Allow policy restricted to your own email address. The path-specific application protects the private Alpaca API routes while leaving `/api/health` and the diagnostic dashboard public.
3. Copy this path-specific Access application's Audience (AUD) tag and your Zero Trust team domain.
4. Add these GitHub repository secrets:
   - `APCA_API_KEY_ID` (Alpaca PAPER key only)
   - `APCA_API_SECRET_KEY` (Alpaca PAPER secret only)
   - `ACCESS_TEAM_DOMAIN` (team name only, without `.cloudflareaccess.com`)
   - `ACCESS_AUD` (Access application's audience tag)
5. Run the `Deploy Cloudflare` workflow again. The workflow uploads the secrets to the Worker and deploys the protected version.

Do not add LIVE credentials. Do not paste any secret into source code, issues, or chat.

## Verify after deployment

- Open the production HTTPS hostname in a private browser session. Cloudflare Access must request authentication.
- `GET /api/health` must return `ok: true`, `mode: PAPER`, `live_enabled: false`.
- `GET /api/bot/status` must show `MONITORING` after the first successful scheduled scan, or `WAITING_CREDENTIALS` if Alpaca PAPER secrets are missing.
- `GET /api/bot/signals` returns only signals persisted in D1.
- `/api/alpaca/*` endpoints reject requests without a valid Cloudflare Access JWT.
- `GET /api/alpaca/reconciliation` performs a read-only comparison of Alpaca orders and positions against the D1 order journal. It verifies broker order IDs against the journal symbol and side, flags still-active entry orders with partial exposure and lifecycle states without confirmed fills, compares broker entry fills, normal and emergency exit fills, stop fills, remaining position quantities and remaining protective-stop quantities; it flags missing entry/exit/stop/emergency-exit references, active normal/emergency exit quantities exceeding remaining exposure, simultaneous active exit/stop orders, missing/inactive/undersized/oversized stops and untracked positions/orders. Broker orders are read in pages of up to 500 and journal rows in pages of 200 using an immutable created-at/client-id keyset cursor and a supporting index, with a bounded page count. If either history reaches that bound, reconciliation returns `REVIEW_REQUIRED` rather than claiming `IN_SYNC`. It never modifies broker state.

A successful page render alone is not sufficient verification. Check API health and the worker heartbeat as well.

## Execution safety

The Cloudflare scanner queries each configured crypto pair separately, uses only closed one-minute bars, rejects stale market data, and stores a per-symbol cursor in D1. The persistent Python scanner applies the same closed-bar and freshness checks, stores per-symbol cursors in its local SQLite journal, evaluates only the latest closed bar on first boot, and replays missed crossovers after a saved cursor when bars remain in the retained history window; a history gap or cursor/data inconsistency marks the worker DEGRADED. If a Cron run is delayed, it replays the unprocessed bars still available in the recent history window; if the cursor falls outside that window, it recovers from the available EMA history and marks that cycle degraded. The scanner only records EMA 9/21 signals. It does not submit orders. The Cloudflare Risk Gateway policy and a guarded order lifecycle state machine are implemented and unit-tested, but are not connected to order submission. The lifecycle requires a terminal broker entry status before finalizing a fill or starting an emergency exit, and a broker-confirmed protective-stop cancellation (or confirmation that no stop exists) before normal/emergency exits can be submitted, and a terminal stop state before a position can be marked closed. The gateway fails closed when pending buy reservations are unknown; its per-minute rate limit constrains new BUY exposure, while bounded reduce-only SELL exits require a matching confirmed position symbol, held quantity and notional and remain available as risk-reducing actions even when kill-switch telemetry is unavailable. A read-only reconciliation endpoint compares the D1 journal with Alpaca orders and positions. The Python Alpaca adapter also rejects protective stops that do not exactly cover the held position and refuses a new stop or market exit while another active sell order exists for the same symbol; an orchestrator must resolve/cancel the existing sell order and confirm broker state before retrying. The end-to-end execution engine, atomic reservations, fill polling, protective stop placement, emergency exit and broker reconciliation loop must be implemented and tested before enabling PAPER execution. LIVE remains disabled.
