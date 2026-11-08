# Miracolo read-only HTTP service

The WSGI application in `src/miracolo_trading/http_api.py` provides a same-origin
backend boundary for the browser. It exposes only:

- `GET /api/health`: application status and PAPER/LIVE safety flags.
- `GET /api/condor/servers`: Condor server list.
- `GET /api/condor/servers/{name}/status`: server connection status.
- `GET /api/condor/servers/{name}/portfolio`: cached portfolio balances.

All other routes return 404. Every non-GET request returns 405. No order,
executor, bot-control, refresh, or exchange mutation route exists.

## Run locally

With the package installed, run the WSGI application behind a local reverse
proxy or a production WSGI server, binding to loopback only:

```bash
python -c "from wsgiref.simple_server import make_server; from miracolo_trading.http_api import create_app; make_server('127.0.0.1', 8090, create_app()).serve_forever()"
```

Configure `CONDOR_API_URL`, `CONDOR_API_TOKEN`, and optional
`CONDOR_API_TIMEOUT` in the backend environment. Never put the token in
browser code, a URL, or Git. Do not expose this development server directly
to the public Internet.

The API deliberately has no permissive CORS headers. Serve the web UI and API
under the same authenticated origin. The local development server is not a
24/7 deployment.
