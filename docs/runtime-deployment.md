# Cloudflare Workers deployment

Miracolo is deployed as a Cloudflare Worker with static assets, a one-minute Cron Trigger and a D1 journal. It does not require a continuously running Linux server or an open browser tab.

## First deployment

1. In the Cloudflare dashboard, create a D1 database named `miracolo-trading-ai`. Copy its database UUID.
2. Create a Cloudflare API Token with Workers Scripts:Edit and D1:Edit permissions. Copy your Cloudflare Account ID.
3. In GitHub repository Settings > Secrets and variables > Actions, add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `D1_DATABASE_ID` (the D1 UUID)
4. Push to `main` or manually run the `Deploy Cloudflare` workflow. It substitutes the D1 ID at deploy time, applies the D1 migration and deploys the Worker plus `web/` assets. The ID is not written back into the repository.

## Protect the application and connect Alpaca

After the first deployment:

1. In Cloudflare Workers & Pages, open the `miracolo-trading-ai` Worker and select **Access > Protect this Worker behind Access**.
2. Require sign-in and create an Allow policy restricted to your own email address. Protect production traffic, not only previews.
3. Copy the Access application's Audience (AUD) tag and your Zero Trust team domain.
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
- `GET /api/alpaca/reconciliation` performs a read-only comparison of recent Alpaca orders and positions against the D1 order journal. It flags untracked positions/orders and filled entries without an active stop; it never modifies broker state.

A successful page render alone is not sufficient verification. Check API health and the worker heartbeat as well.

## Execution safety

The scanner queries each configured crypto pair separately, uses only closed one-minute bars, rejects stale market data, and stores a per-symbol cursor in D1. If a Cron run is delayed, it replays the unprocessed bars still available in the recent history window; if the cursor falls outside that window, it recovers from the available EMA history and marks that cycle degraded. The scanner only records EMA 9/21 signals. It does not submit orders. The Cloudflare Risk Gateway policy and a guarded order lifecycle state machine are implemented and unit-tested, but are not connected to order submission. A read-only reconciliation endpoint compares the D1 journal with Alpaca orders and positions. The end-to-end execution engine, atomic reservations, fill polling, protective stop placement, emergency exit and broker reconciliation loop must be implemented and tested before enabling PAPER execution. LIVE remains disabled.
