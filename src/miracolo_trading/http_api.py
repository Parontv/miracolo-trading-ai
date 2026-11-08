"""Small same-origin WSGI API exposing safe, read-only Condor diagnostics."""
from __future__ import annotations

import json
from urllib.parse import parse_qs, unquote

from .condor_readonly import CondorReadOnlyClient, CondorReadOnlyConfig


def create_app(client: CondorReadOnlyClient | None = None):
    """Create a WSGI app. No mutation or order-routing routes are registered."""
    condor = client or CondorReadOnlyClient(CondorReadOnlyConfig.from_env())

    def app(environ, start_response):
        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO", "/")
        query = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=False)
        status = "200 OK"
        headers = [("Content-Type", "application/json; charset=utf-8"),
                   ("Cache-Control", "no-store"),
                   ("X-Content-Type-Options", "nosniff")]

        if method != "GET":
            status = "405 Method Not Allowed"
            payload = {"ok": False, "error": "method_not_allowed"}
            headers.append(("Allow", "GET"))
        elif path == "/api/health":
            payload = {"ok": True, "service": "miracolo", "mode": "PAPER",
                       "live_enabled": False}
        elif path == "/api/condor/servers":
            payload = condor.servers()
            if isinstance(payload, dict) and payload.get("connected") is False:
                status = "503 Service Unavailable"
        elif path.startswith("/api/condor/servers/"):
            tail = path[len("/api/condor/servers/"):]
            parts = tail.split("/")
            if not parts[0]:
                status = "404 Not Found"
                payload = {"ok": False, "error": "not_found"}
            elif len(parts) == 2 and parts[1] in {"status", "portfolio", "bots", "positions"}:
                name = unquote(parts[0])
                readers = {
                    "status": condor.server_status,
                    "portfolio": condor.portfolio,
                    "bots": condor.bots,
                    "positions": condor.positions,
                }
                payload = readers[parts[1]](name)
            elif len(parts) == 3 and parts[1:] == ["market", "venues"]:
                payload = condor.market_venues(unquote(parts[0]))
            elif len(parts) == 3 and parts[1:] == ["market", "tickers"]:
                connector = query.get("connector", [""])[0]
                if not connector or len(connector) > 80:
                    status = "400 Bad Request"
                    payload = {"ok": False, "error": "connector_required"}
                else:
                    payload = condor.market_tickers(unquote(parts[0]), connector)
            else:
                status = "404 Not Found"
                payload = {"ok": False, "error": "not_found"}
            if isinstance(payload, dict) and payload.get("connected") is False:
                status = "503 Service Unavailable"
        else:
            status = "404 Not Found"
            payload = {"ok": False, "error": "not_found"}

        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        headers.append(("Content-Length", str(len(body))))
        start_response(status, headers)
        return [body]

    return app
