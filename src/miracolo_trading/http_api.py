"""Small same-origin WSGI API exposing safe, read-only Condor diagnostics."""
from __future__ import annotations

import json
from urllib.parse import unquote

from .condor_readonly import CondorReadOnlyClient, CondorReadOnlyConfig


def create_app(client: CondorReadOnlyClient | None = None):
    """Create a WSGI app. No mutation or order-routing routes are registered."""
    condor = client or CondorReadOnlyClient(CondorReadOnlyConfig.from_env())

    def app(environ, start_response):
        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO", "/")
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
            if len(parts) != 2 or parts[1] not in {"status", "portfolio"} or not parts[0]:
                status = "404 Not Found"
                payload = {"ok": False, "error": "not_found"}
            else:
                name = unquote(parts[0])
                payload = (condor.server_status(name) if parts[1] == "status"
                           else condor.portfolio(name))
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
