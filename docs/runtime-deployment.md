# Runtime deployment (Linux host)

This deployment package runs the read-only Miracolo API beside Condor and serves
the web UI through a same-origin Caddy reverse proxy.

## Requirements

- An always-on Linux machine or VPS with Docker Engine and the Docker Compose
  plugin.
- Condor already running on that same host, listening on
  `127.0.0.1:8088`, configured in **Local mode** with a valid administrator.
- The pinned Condor/Hummingbot services must be healthy before starting Miracolo.
- A Cloudflare Tunnel (or equivalent authenticated private access proxy) must
  target `http://127.0.0.1:8080`. Protect the public hostname with Cloudflare
  Access. Do not publish ports 8080, 8090, 8088, or Hummingbot API directly.

## Start

From the repository root on the Linux host:

```bash
cp .env.runtime.example .env.runtime
docker compose -f compose.runtime.yml up -d --build
docker compose -f compose.runtime.yml ps
curl --fail http://127.0.0.1:8090/api/health
curl --fail http://127.0.0.1:8080/api/health
```

The API container uses host networking so its loopback Local-mode login reaches
Condor on the same host. The API binds only to `127.0.0.1:8090`; Caddy binds
only to `127.0.0.1:8080`, serves `web/`, and proxies `/api/*` to the API.
This compose file is intended for Linux Docker hosts with host networking.
It is not a Cloudflare Worker deployment.

## Verify

```bash
docker compose -f compose.runtime.yml logs --tail=100 miracolo-api
docker compose -f compose.runtime.yml logs --tail=100 miracolo-web
curl --fail http://127.0.0.1:8080/api/health
curl --fail http://127.0.0.1:8080/api/condor/servers
```

The health route proves only that Miracolo responds. Alpaca endpoints additionally require `MIRACOLO_API_TOKEN` and are not yet wired to the static Githack UI. The Condor servers route
must also return the authorized server list to prove the Condor connection.
If it returns 503, inspect Condor Local mode, its administrator configuration,
and the API logs. Do not paste tokens into GitHub issues or chat.

## Safety boundary

This release is read-only. It does not submit, cancel, or modify orders.
PAPER is displayed as the environment label; a complete PAPER execution engine
has not yet been enabled. LIVE remains disabled. Keep Cloudflare Access enabled
for the UI hostname and do not expose Condor or Hummingbot directly.
