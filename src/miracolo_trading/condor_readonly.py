"""Read-only client for the Condor web API.

This adapter deliberately exposes GET-only operations. It never forwards order,
trade, executor, or configuration mutations to Condor or Hummingbot.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class CondorReadOnlyConfig:
    base_url: str
    token: str
    timeout_seconds: float = 5.0

    @classmethod
    def from_env(cls) -> "CondorReadOnlyConfig":
        return cls(
            base_url=os.getenv("CONDOR_API_URL", "http://127.0.0.1:8088").rstrip("/"),
            token=os.getenv("CONDOR_API_TOKEN", ""),
            timeout_seconds=float(os.getenv("CONDOR_API_TIMEOUT", "5")),
        )


class CondorReadOnlyClient:
    """Minimal GET-only adapter for authenticated Condor API endpoints."""

    def __init__(self, config: CondorReadOnlyConfig):
        self.config = config

    def _get(self, path: str):
        if not self.config.token:
            return {"connected": False, "reason": "missing_api_token"}
        if not path.startswith("/api/v1/") or ".." in path:
            raise ValueError("Only approved Condor API paths are allowed")
        request = Request(
            self.config.base_url + path,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self.config.token}",
            },
            method="GET",
        )
        try:
            with urlopen(request, timeout=self.config.timeout_seconds) as response:
                payload = response.read()
                return json.loads(payload.decode("utf-8")) if payload else {}
        except HTTPError as exc:
            return {"connected": False, "reason": f"http_{exc.code}"}
        except (URLError, TimeoutError, OSError):
            return {"connected": False, "reason": "api_unreachable"}
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {"connected": False, "reason": "invalid_api_response"}

    def servers(self):
        """List only the Condor servers visible to the authenticated user."""
        return self._get("/api/v1/servers")

    def server_status(self, name: str):
        """Read one server's connection status."""
        return self._get(f"/api/v1/servers/{quote(name, safe='')}/status")

    def portfolio(self, name: str):
        """Read portfolio balances; never refreshes or mutates exchange state."""
        return self._get(f"/api/v1/servers/{quote(name, safe='')}/portfolio")
