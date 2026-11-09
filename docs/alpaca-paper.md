# Alpaca Paper integration

The adapter is permanently pinned to `https://paper-api.alpaca.markets`. No LIVE host or mode is configurable.

## Server configuration

Set these only on the Linux runtime host in the untracked `.env.runtime` file:

```dotenv
APCA_API_KEY_ID=<Paper API key ID>
APCA_API_SECRET_KEY=<Paper secret key>
ALPACA_API_TIMEOUT=8
MIRACOLO_API_TOKEN=<long random private API token>
```

Never put credentials or tokens in Git, frontend code, localStorage, URLs, or chat.

## Private API proxy

The browser calls same-origin `/api/alpaca/*` endpoints without receiving the private token. Caddy injects `MIRACOLO_API_TOKEN` into the upstream request on the server. The WSGI API accepts the request only from loopback and validates the bearer token.

**Remote access must be protected by Cloudflare Access.** The Caddy listener binds to loopback only. Do not expose ports 8080 or 8090 directly, and do not publish the tunnel hostname without an Access policy. The token is available to the Caddy container only through the protected runtime environment.

- `GET /api/alpaca/status`: Alpaca Paper account.
- `GET /api/alpaca/assets`: allowlisted crypto assets and tradability.
- `GET /api/alpaca/orders`: open orders.
- `GET /api/alpaca/positions`: open positions.
- `POST /api/alpaca/orders`: intentionally locked (423) until the centralized Risk Gateway, persistent worker, idempotency journal, and end-to-end PAPER tests are complete.

The public `GET /api/health` endpoint reports only whether credentials are configured. It never returns account details or secrets.

## Guardrails already present in the adapter

Only BTC/USD, ETH/USD and QNT/USD are allowlisted; Alpaca must confirm each asset is active and tradable. Buy orders are capped at USD 100, open positions at three, open orders at ten, and sells are limited to an existing long position.

These adapter checks are not a substitute for the complete Risk Gateway. Order submission remains locked at the HTTP boundary until the gateway is implemented and tested.
