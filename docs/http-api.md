# Miracolo HTTP API

The WSGI service exposes a small same-origin API.

## Public status

- `GET /api/health`: service status, fixed PAPER mode, LIVE flag, broker name, whether Alpaca credentials are configured, and execution-enabled flag. It never returns account details or secrets.

## Private Alpaca read routes

All `/api/alpaca/*` routes require a loopback request and `Authorization: Bearer <MIRACOLO_API_TOKEN>`.

- `GET /api/alpaca/status`: Alpaca PAPER account.
- `GET /api/alpaca/assets`: allowlisted assets and tradability.
- `GET /api/alpaca/orders`: open orders.
- `GET /api/alpaca/positions`: open positions.

`POST /api/alpaca/orders` returns `423 Locked` until the Risk Gateway, persistent worker, idempotency journal, and end-to-end PAPER validation are complete.

## Local runtime

Run the WSGI application bound to loopback:

```bash
python -c "from wsgiref.simple_server import make_server; from miracolo_trading.http_api import create_app; make_server('127.0.0.1', 8090, create_app()).serve_forever()"
```

The WSGI app independently rejects requests whose `REMOTE_ADDR` is not a loopback address. Keep the service behind an authenticated private proxy and HTTPS. Never put broker credentials or the API token in browser code, URLs, or Git.
