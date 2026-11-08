"""Same-origin WSGI API: read-only Condor plus authenticated Alpaca PAPER routes."""
from __future__ import annotations

import hmac
import json
import os
from ipaddress import ip_address
from urllib.parse import parse_qs, unquote

from .alpaca_paper import AlpacaError, AlpacaPaperClient, AlpacaPaperConfig
from .condor_readonly import CondorReadOnlyClient, CondorReadOnlyConfig


def create_app(client: CondorReadOnlyClient | None = None,
               alpaca: AlpacaPaperClient | None = None):
    """Create a WSGI app. Alpaca routes are Paper-only and separately authenticated."""
    condor = client or CondorReadOnlyClient(CondorReadOnlyConfig.from_env())
    paper = alpaca or AlpacaPaperClient(AlpacaPaperConfig.from_env())

    def app(environ, start_response):
        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO", "/")
        query = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=False)
        status = "200 OK"
        headers = [("Content-Type", "application/json; charset=utf-8"),
                   ("Cache-Control", "no-store"),
                   ("X-Content-Type-Options", "nosniff")]
        try:
            is_loopback = ip_address(environ.get("REMOTE_ADDR", "")).is_loopback
        except ValueError:
            is_loopback = False

        def authorized():
            expected = os.getenv("MIRACOLO_API_TOKEN", "")
            supplied = environ.get("HTTP_AUTHORIZATION", "")
            return bool(expected and supplied.startswith("Bearer ")
                        and hmac.compare_digest(supplied[7:], expected))

        try:
            if not is_loopback:
                status, payload = "403 Forbidden", {"ok": False, "error": "loopback_access_only"}
            elif path.startswith("/api/alpaca/"):
                if not authorized():
                    status, payload = "401 Unauthorized", {"ok": False, "error": "authentication_required"}
                    headers.append(("WWW-Authenticate", "Bearer"))
                elif not paper.configured:
                    status, payload = "503 Service Unavailable", {"ok": False, "error": "alpaca_credentials_missing"}
                elif method == "GET" and path == "/api/alpaca/status":
                    account = paper.account()
                    payload = {"ok": True, "mode": "PAPER", "live_enabled": False,
                               "account": account}
                elif method == "GET" and path == "/api/alpaca/assets":
                    payload = {"ok": True, "mode": "PAPER", "assets": paper.assets()}
                elif method == "GET" and path == "/api/alpaca/orders":
                    payload = {"ok": True, "mode": "PAPER", "orders": paper.orders()}
                elif method == "GET" and path == "/api/alpaca/positions":
                    payload = {"ok": True, "mode": "PAPER", "positions": paper.positions()}
                elif method == "POST" and path == "/api/alpaca/orders":
                    try:
                        length = int(environ.get("CONTENT_LENGTH") or "0")
                    except ValueError:
                        length = -1
                    if length < 2 or length > 4096:
                        status, payload = "400 Bad Request", {"ok": False, "error": "invalid_body_size"}
                    else:
                        try:
                            body = json.loads(environ["wsgi.input"].read(length).decode("utf-8"))
                            if not isinstance(body, dict):
                                raise ValueError()
                        except (KeyError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
                            status, payload = "400 Bad Request", {"ok": False, "error": "invalid_json"}
                        else:
                            result = paper.submit_market_order(
                                symbol=body.get("symbol"),
                                side=body.get("side"),
                                notional=body.get("notional"),
                                qty=body.get("qty"),
                                client_order_id=body.get("client_order_id"),
                            )
                            payload = {"ok": True, "mode": "PAPER", "order": result}
                else:
                    status, payload = "405 Method Not Allowed", {"ok": False, "error": "method_not_allowed"}
                    headers.append(("Allow", "GET, POST"))
            elif method != "GET":
                status, payload = "405 Method Not Allowed", {"ok": False, "error": "method_not_allowed"}
                headers.append(("Allow", "GET"))
            elif path == "/api/health":
                payload = {"ok": True, "service": "miracolo", "mode": "PAPER", "live_enabled": False}
            elif path == "/api/condor/servers":
                payload = condor.servers()
                if isinstance(payload, dict) and payload.get("connected") is False:
                    status = "503 Service Unavailable"
            elif path.startswith("/api/condor/servers/"):
                tail = path[len("/api/condor/servers/"):]
                parts = tail.split("/")
                if not parts[0]:
                    status, payload = "404 Not Found", {"ok": False, "error": "not_found"}
                elif len(parts) == 2 and parts[1] in {"status", "portfolio", "bots", "positions"}:
                    name = unquote(parts[0])
                    readers = {"status": condor.server_status, "portfolio": condor.portfolio,
                               "bots": condor.bots, "positions": condor.positions}
                    payload = readers[parts[1]](name)
                elif len(parts) == 3 and parts[1:] == ["market", "venues"]:
                    payload = condor.market_venues(unquote(parts[0]))
                elif len(parts) == 3 and parts[1:] == ["market", "tickers"]:
                    connector = query.get("connector", [""])[0]
                    if not connector or len(connector) > 80:
                        status, payload = "400 Bad Request", {"ok": False, "error": "connector_required"}
                    else:
                        payload = condor.market_tickers(unquote(parts[0]), connector)
                else:
                    status, payload = "404 Not Found", {"ok": False, "error": "not_found"}
                if isinstance(payload, dict) and payload.get("connected") is False:
                    status = "503 Service Unavailable"
            else:
                status, payload = "404 Not Found", {"ok": False, "error": "not_found"}
        except AlpacaError as exc:
            status = f"{exc.status} " + {400: "Bad Request", 409: "Conflict", 502: "Bad Gateway", 503: "Service Unavailable"}.get(exc.status, "Error")
            payload = {"ok": False, "error": str(exc), "mode": "PAPER"}
        except Exception:
            # Do not leak credentials, upstream bodies, or stack traces to clients.
            status, payload = "502 Bad Gateway", {"ok": False, "error": "internal_error"}

        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        headers.append(("Content-Length", str(len(body))))
        start_response(status, headers)
        return [body]

    return app
