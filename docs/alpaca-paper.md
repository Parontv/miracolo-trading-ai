# Alpaca Paper integration

The Alpaca adapter is deliberately pinned to `https://paper-api.alpaca.markets`.
There is no configurable trading host and no LIVE switch in this application.

## Server configuration

Set these only on the Linux runtime host in the untracked `.env.runtime` file:

```dotenv
APCA_API_KEY_ID=<Paper API key ID>
APCA_API_SECRET_KEY=<Paper secret key>
ALPACA_API_TIMEOUT=8
MIRACOLO_API_TOKEN=<long random private API token>
```

Do not put credentials or `MIRACOLO_API_TOKEN` in GitHub Actions variables,
the frontend, localStorage, a URL, or chat. GitHub repository Actions secrets
are available to workflows only; they are not automatically injected into the
separate Linux runtime. Use the runtime host's secret manager or its protected
environment file with restrictive permissions (for example `chmod 600 .env.runtime`).

Restart the API after configuring the host:

```bash
docker compose -f compose.runtime.yml up -d --build
docker compose -f compose.runtime.yml logs --tail=80 miracolo-api
```

## Private endpoints

Every `/api/alpaca/*` route requires a loopback request and
`Authorization: Bearer <MIRACOLO_API_TOKEN>`. Keep the API behind the existing
Caddy loopback binding and Cloudflare Access. Do not expose the API port.

- `GET /api/alpaca/status`: account status and balance, explicitly labelled PAPER.
- `GET /api/alpaca/assets`: allowlisted crypto pairs and current tradability.
- `GET /api/alpaca/orders`: open orders.
- `GET /api/alpaca/positions`: open positions.
- `POST /api/alpaca/orders`: market order with exactly one of `notional` or `qty`.

Order guardrails: only BTC/USD, ETH/USD and QNT/USD; asset must be active and
tradable; buys are capped at USD 100 per order; at most three open positions and
ten open orders; sells require an existing long position and cannot exceed its
quantity. Each order receives a unique client order ID. Crypto orders use GTC.

QNT is not assumed to be supported: it appears in the asset list only if Alpaca
confirms it is tradable for the connected account. Binance's QNT/USDT feed is
not interchangeable with Alpaca's QNT/USD pair.

## Current boundary

The adapter and authenticated backend endpoints are implemented, but the static
Githack frontend does not receive the private API token and must never be given
it. A browser-session authentication handoff is still required before wiring
the web UI to order submission. Until that is implemented, do not expose the
order endpoint to the public browser and do not describe the browser bot as
executing Alpaca orders. The existing browser bot remains a separate local
simulator and pauses when its page is hidden.
