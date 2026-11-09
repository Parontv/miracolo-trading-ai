# Cloudflare Workers deployment

Miracolo is deployed as a Cloudflare Worker with static assets, a one-minute Cron Trigger and a D1 journal. It does not require a continuously running Linux server or an open browser tab.

## Required one-time account setup

1. Install Node.js 22 and authenticate Wrangler with a Cloudflare API token that has Workers Scripts:Edit and D1:Edit permissions.
2. Create the D1 database:
   ```bash
   npx wrangler@4 d1 create miracolo-trading-ai
   ```
3. Copy the returned database UUID into `database_id` in `wrangler.jsonc`.
4. Create a Cloudflare Access self-hosted application for the Worker hostname. Restrict its Allow policy to your own email address. Copy the Access team domain and application audience tag.
5. Add these GitHub repository secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `APCA_API_KEY_ID` (Alpaca PAPER only)
   - `APCA_API_SECRET_KEY` (Alpaca PAPER only)
   - `ACCESS_TEAM_DOMAIN` (team name only, without `.cloudflareaccess.com`)
   - `ACCESS_AUD` (Cloudflare Access application audience tag)

## Automatic deployment

The `Deploy Cloudflare` GitHub Actions workflow runs on pushes to `main`. It applies D1 migrations, uploads secrets to the Worker, and deploys the Worker plus the `web/` static assets. Cloudflare assigns the final `workers.dev` hostname based on the account's workers.dev subdomain.

## Verify after deployment

- Open the production HTTPS hostname in a private browser session.
- Cloudflare Access must ask for authentication before displaying private account data.
- `GET /api/health` must return `ok: true`, `mode: PAPER`, `live_enabled: false`.
- `GET /api/bot/status` must show `MONITORING` after the first successful scheduled scan, or `WAITING_CREDENTIALS` if Alpaca PAPER secrets are missing.
- `GET /api/bot/signals` returns only signals persisted in D1.
- `/api/alpaca/*` endpoints must reject requests without a valid Cloudflare Access JWT.

A successful page render by itself is not sufficient verification. Check API health and the worker heartbeat as well.

## Execution safety

The scanner only records EMA 9/21 signals. It does not submit orders. The Risk Gateway and the full order-fill-stop-loss-reconciliation lifecycle must be implemented and tested before enabling PAPER execution. LIVE remains disabled.
