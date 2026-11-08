# Miracolo read-only Condor adapter

Miracolo talks to Condor's authenticated web API, not directly to exchange
credentials. The first integration surface is deliberately GET-only:

- `GET /api/v1/servers` lists servers available to the authenticated Condor user.
- `GET /api/v1/servers/{name}/status` reads the server health state.
- `GET /api/v1/servers/{name}/portfolio` reads cached portfolio balances.

The adapter never calls refresh endpoints, bot start/stop endpoints, executor
endpoints, order endpoints, or any POST/PUT/PATCH/DELETE operation.

## Configuration

Set these variables only in the backend runtime, never in browser JavaScript:

```bash
CONDOR_API_URL=http://127.0.0.1:8088
CONDOR_API_TOKEN=<short-lived Condor API bearer token>
CONDOR_API_TIMEOUT=5
```

The token must be a Condor web-session/API token issued by the running Condor
instance. Do not reuse exchange API keys here. Do not commit tokens to Git.

For remote access, use a private authenticated network (for example Tailscale)
and HTTPS. Do not expose Condor's unauthenticated local dashboard or API to the
public Internet.

## Current boundary

This is a backend library adapter and unit-tested contract, not yet a deployed
service or browser-to-backend connection. Condor remains responsible for its
own authentication and Hummingbot API server management. Miracolo remains
PAPER-only; LIVE execution is not implemented.
