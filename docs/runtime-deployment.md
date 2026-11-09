# Runtime deployment (Linux host)

This deployment serves the Miracolo dashboard and its Python API on one origin, through an outbound Cloudflare Tunnel.

## Requirements

- An always-on Linux machine or VPS with Docker Engine and Docker Compose.
- A Cloudflare account with Zero Trust, a tunnel and an Access application.
- Alpaca PAPER credentials configured only on the runtime host.

## One-time Cloudflare setup

1. In Cloudflare Zero Trust, open **Networks > Tunnels** and create a tunnel.
2. Add a **Public Hostname** such as `miracolo.your-domain.example` and route it to `http://localhost:8080`.
3. In **Access > Applications**, create a self-hosted application for that exact hostname.
4. Add an allow policy limited to your own email address. Do not leave the hostname publicly accessible.
5. Copy the tunnel connector token into `CLOUDFLARE_TUNNEL_TOKEN` in the host's `.env.runtime` file.

The Cloudflare Tunnel connector makes an outbound connection. The deployment does not publish ports 8080 or 8090 to the public Internet.

## Start

```bash
cp .env.runtime.example .env.runtime
# Edit .env.runtime and add the Cloudflare tunnel token.
# Add Alpaca PAPER credentials only when ready; never use LIVE keys.
docker compose -f compose.runtime.yml config
docker compose -f compose.runtime.yml up -d --build
docker compose -f compose.runtime.yml ps
curl --fail http://127.0.0.1:8090/api/health
curl --fail http://127.0.0.1:8080/api/health
```

The API binds to `127.0.0.1:8090`; Caddy binds to `127.0.0.1:8080`, serves `web/`, and proxies `/api/*` to the API. The `miracolo-worker` service scans Alpaca crypto 1-minute bars every 60 seconds, calculates EMA 9/21 crossover signals and writes them to a shared SQLite journal. API and worker share a named persistent volume. The `cloudflared` service maintains the outbound tunnel. This compose file is intended for Linux Docker hosts with host networking. It is not a Cloudflare Worker deployment.

## Verify

```bash
docker compose -f compose.runtime.yml logs --tail=100 miracolo-api
docker compose -f compose.runtime.yml logs --tail=100 miracolo-web
docker compose -f compose.runtime.yml logs --tail=100 cloudflared
curl --fail http://127.0.0.1:8080/api/health
```

Then open the configured HTTPS hostname in a private browser session. Cloudflare Access should require authentication before showing the app. After login, the dashboard must load and show the runtime state. A successful static page load alone is not sufficient: verify `/api/health` and that the bot status endpoint responds.

The health endpoint reports service status, PAPER mode, whether Alpaca credentials are configured, worker state, last scan time and signal count. `GET /api/bot/status` and `GET /api/bot/signals` expose scanner status and recorded signals. It does not return account information or secrets. Private Alpaca read endpoints require the server token, which Caddy injects server-side. Order submission is deliberately locked until the Risk Gateway, persistent worker, journal, and end-to-end PAPER tests are complete.

## 24/7 operation and safety

A browser tab and Cloudflare Worker are not a persistent Python trading process. Continuous operation requires an always-on Linux host. Keep the host behind authenticated Cloudflare Access and do not expose the API directly to the public Internet.

LIVE remains disabled. No orders are submitted by this development branch.
