# Runtime deployment (Linux host)

This deployment serves the Miracolo dashboard and its Python API on one origin.

## Requirements

- An always-on Linux machine or VPS with Docker Engine and Docker Compose.
- A protected private access layer such as Cloudflare Tunnel + Cloudflare Access.
- Alpaca PAPER credentials configured only on the runtime host.

## Start

```bash
cp .env.runtime.example .env.runtime
docker compose -f compose.runtime.yml up -d --build
docker compose -f compose.runtime.yml ps
curl --fail http://127.0.0.1:8090/api/health
curl --fail http://127.0.0.1:8080/api/health
```

The API binds to `127.0.0.1:8090`; Caddy binds to `127.0.0.1:8080`, serves `web/`, and proxies `/api/*` to the API. A separate `miracolo-worker` service scans Alpaca crypto 1-minute bars every 60 seconds, calculates EMA 9/21 crossover signals and writes them to a shared SQLite journal. API and worker share a named persistent volume. This compose file is intended for Linux Docker hosts with host networking. It is not a Cloudflare Worker deployment.

## Verify

```bash
docker compose -f compose.runtime.yml logs --tail=100 miracolo-api
docker compose -f compose.runtime.yml logs --tail=100 miracolo-web
curl --fail http://127.0.0.1:8080/api/health
```

The health endpoint reports service status, PAPER mode, whether Alpaca credentials are configured, worker state, last scan time and signal count. `GET /api/bot/status` and `GET /api/bot/signals` expose the scanner status and recorded signals. It does not return account information or secrets. Private Alpaca read endpoints require the server token. Order submission is deliberately locked until the Risk Gateway, persistent worker, journal, and end-to-end PAPER tests are complete.

## 24/7 operation and safety

A browser tab and Cloudflare Worker are not a persistent Python trading process. Continuous operation requires an always-on Linux host. Keep the host behind authenticated private access and do not expose the API directly to the public Internet.

LIVE remains disabled. No orders are submitted by this development branch.
