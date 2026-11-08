# Miracolo read-only HTTP service

The WSGI application in \`src/miracolo_trading/http_api.py\` provides the
same-origin backend boundary for the browser. It exposes only:

- \`GET /api/health\`: application status and PAPER/LIVE safety flags.
- \`GET /api/condor/servers\`: Condor server list.
- \`GET /api/condor/servers/{name}/status\`: server connection status.
- \`GET /api/condor/servers/{name}/portfolio\`: cached portfolio balances.
- \`GET /api/condor/servers/{name}/market/venues\`: available market venues.
- \`GET /api/condor/servers/{name}/market/tickers?connector=...\`: market tickers.
- \`GET /api/condor/servers/{name}/bots\`: bot/controller status.
- \`GET /api/condor/servers/{name}/positions\`: consolidated open positions.

All non-GET application requests return 405. Unknown routes return 404. The
only POST performed by the adapter is the exact Condor local-login endpoint
when Local mode is explicitly enabled; it is sent directly to Condor on
loopback, never exposed as a Miracolo route. No order, executor, bot-control,
refresh, credential, or exchange mutation route exists.

## Local runtime

With the package installed, run the WSGI application bound to loopback:

\`\`\`bash
python -c "from wsgiref.simple_server import make_server; from miracolo_trading.http_api import create_app; make_server('127.0.0.1', 8090, create_app()).serve_forever()"
\`\`\`

The WSGI app independently rejects requests whose \`REMOTE_ADDR\` is not a
loopback address. It ignores forwarded-IP headers. This is defense in depth,
not a substitute for proxy authentication.

Configure \`CONDOR_API_URL\`, \`CONDOR_AUTH_MODE\`, and optional
\`CONDOR_API_TOKEN\` / \`CONDOR_API_TIMEOUT\` in the backend environment. Never
put the Condor JWT in browser code, a URL, or Git.

## Reverse proxy and remote access

The reverse proxy must route the UI and \`/api/*\` to the appropriate services
under one origin and enforce authentication for remote users. The proxy should
connect to the WSGI service over loopback. Use a private authenticated network
and HTTPS; do not expose the WSGI service, Condor dashboard, or Hummingbot API
directly to the public Internet.

The local development server is not a 24/7 deployment.
