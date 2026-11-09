"""Same-origin WSGI API for the Alpaca PAPER-only runtime."""
from __future__ import annotations

import hmac
import json
import os
from ipaddress import ip_address

from .alpaca_paper import AlpacaError, AlpacaPaperClient, AlpacaPaperConfig


def create_app(alpaca: AlpacaPaperClient | None = None):
    """Create a fail-closed API. Order execution stays disabled until risk gateway is complete."""
    paper = alpaca or AlpacaPaperClient(AlpacaPaperConfig.from_env())

    def app(environ, start_response):
        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO", "/")
        status = "200 OK"
        headers = [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Cache-Control", "no-store"),
            ("X-Content-Type-Options", "nosniff"),
        ]
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
            elif path == "/api/health" and method == "GET":
                payload = {
                    "ok": True,
                    "service": "miracolo",
                    "mode": "PAPER",
                    "live_enabled": False,
                    "broker": "alpaca",
                    "alpaca_configured": paper.configured,
                    "execution_enabled": False,
                }
            elif path.startswith("/api/alpaca/"):
                if not authorized():
                    status, payload = "401 Unauthorized", {"ok": False, "error": "authentication_required"}
                    headers.append(("WWW-Authenticate", "Bearer"))
                elif not paper.configured:
                    status, payload = "503 Service Unavailable", {"ok": False, "error": "alpaca_credentials_missing"}
                elif method == "GET" and path == "/api/alpaca/status":
                    payload = {"ok": True, "mode": "PAPER", "live_enabled": False, "account": paper.account()}
                elif method == "GET" and path == "/api/alpaca/assets":
                    payload = {"ok": True, "mode": "PAPER", "assets": paper.assets()}
                elif method == "GET" and path == "/api/alpaca/orders":
                    payload = {"ok": True, "mode": "PAPER", "orders": paper.orders()}
                elif method == "GET" and path == "/api/alpaca/positions":
                    payload = {"ok": True, "mode": "PAPER", "positions": paper.positions()}
                elif path == "/api/alpaca/orders" and method == "POST":
                    status, payload = "423 Locked", {
                        "ok": False,
                        "mode": "PAPER",
                        "error": "execution_disabled_until_risk_gateway_and_worker_are_ready",
                    }
                    headers.append(("Allow", "GET"))
                else:
                    status, payload = "404 Not Found", {"ok": False, "error": "not_found"}
            elif method != "GET":
                status, payload = "405 Method Not Allowed", {"ok": False, "error": "method_not_allowed"}
                headers.append(("Allow", "GET"))
            else:
                status, payload = "404 Not Found", {"ok": False, "error": "not_found"}
        except AlpacaError as exc:
            reason = {400: "Bad Request", 409: "Conflict", 502: "Bad Gateway", 503: "Service Unavailable"}.get(exc.status, "Error")
            status = f"{exc.status} {reason}"
            payload = {"ok": False, "error": str(exc), "mode": "PAPER"}
        except Exception:
            status, payload = "502 Bad Gateway", {"ok": False, "error": "internal_error"}

        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        headers.append(("Content-Length", str(len(body))))
        start_response(status, headers)
        return [body]

    return app
