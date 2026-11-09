# Cloudflare Workers deployment

Miracolo is deployed as a Cloudflare Worker with static assets, a one-minute Cron Trigger and a D1 journal. It does not require a continuously running Linux server or an open browser tab.

## First deployment

1. Create a D1 database named `miracolo-trading-ai`:
   ```bash
   npx wrangler@4 d1 create miracolo-trading-ai
   ```
2. Copy the returned database UUID into `database_id` in `wrangler.jsonc`.
3. Create a Cloudflare API Token with Workers Scripts:Edit and D1:Edit permissions.
4. Add these two GitHub repository secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
5. Push to `main` or manually run the `Deploy Cloudflare` workflow. It applies the D1 migration and deploys the Worker plus `web/` assets.

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
5. Push a small commit to `main` or run `Deploy Cloudflare` again. The workflow uploads the secrets to the Worker and deploys the protected version.

Do not add LIVE credentials. Do not paste any secret into source code, issues, or chat.

## Verify after deployment

- Open the production HTTPS hostname in a private browser session. Cloudflare Access must request authentication.
- `GET /api/health` must return `ok: true`, `mode: PAPER`, `live_enabled: false`.
- `GET /api/bot/status` must show `MONITORING` after the first successful scheduled scan, or `WAITING_CREDENTIALS` if Alpaca PAPER secrets are missing.
- `GET /api/bot/signals` returns only signals persisted in D1.
- `/api/alpaca/*` endpoints reject requests without a valid Cloudflare Access JWT.

A successful page render alone is not sufficient verification. Check API health and the worker heartbeat as well.

## Execution safety

The scanner only records EMA 9/21 signals. It does not submit orders. The Risk Gateway and the full order-fill-stop-loss-reconciliation lifecycle must be implemented and tested before enabling PAPER execution. LIVE remains disabled.
