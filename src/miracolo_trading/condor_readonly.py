"""Read-only client for Condor; only local-mode login may use POST."""
from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class CondorReadOnlyConfig:
    base_url: str
    token: str = ""
    timeout_seconds: float = 5.0
    auth_mode: str = "bearer"

    @classmethod
    def from_env(cls) -> "CondorReadOnlyConfig":
        return cls(
            base_url=os.getenv("CONDOR_API_URL", "http://127.0.0.1:8088").rstrip("/"),
            token=os.getenv("CONDOR_API_TOKEN", ""),
            timeout_seconds=float(os.getenv("CONDOR_API_TIMEOUT", "5")),
            auth_mode=os.getenv("CONDOR_AUTH_MODE", "bearer").strip().lower(),
        )


class CondorReadOnlyClient:
    """GET-only Condor data adapter with optional loopback local-mode login."""

    def __init__(self, config: CondorReadOnlyConfig):
        self.config = config
        self._token = config.token
        self._auth_lock = threading.Lock()

    def _local_login(self) -> str | None:
        parsed = urlsplit(self.config.base_url)
        if self.config.auth_mode != "local" or parsed.hostname not in {
            "localhost", "127.0.0.1", "::1"
        }:
            return None
        request = Request(
            self.config.base_url + "/api/v1/auth/local-login",
            data=b"{}",
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.config.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
            token = payload.get("token") if isinstance(payload, dict) else None
            if isinstance(token, str) and token:
                self._token = token
                return token
        except (HTTPError, URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
            return None
        return None

    def _get(self, path: str):
        if not path.startswith("/api/v1/") or ".." in path:
            raise ValueError("Only approved Condor API paths are allowed")
        if self.config.auth_mode not in {"bearer", "local"}:
            return {"connected": False, "reason": "invalid_auth_mode"}

        token = self._token
        if not token and self.config.auth_mode == "local":
            with self._auth_lock:
                token = self._token or self._local_login()
        if not token:
            return {"connected": False, "reason": "missing_api_token"}

        def request_data(bearer: str):
            request = Request(
                self.config.base_url + path,
                headers={"Accept": "application/json", "Authorization": f"Bearer {bearer}"},
                method="GET",
            )
            with urlopen(request, timeout=self.config.timeout_seconds) as response:
                payload = response.read()
            return json.loads(payload.decode("utf-8")) if payload else {}

        try:
            return request_data(token)
        except HTTPError as exc:
            if exc.code == 401 and self.config.auth_mode == "local":
                with self._auth_lock:
                    self._token = ""
                    renewed = self._local_login()
                if renewed:
                    try:
                        return request_data(renewed)
                    except HTTPError as retry_exc:
                        return {"connected": False, "reason": f"http_{retry_exc.code}"}
                    except (URLError, TimeoutError, OSError):
                        return {"connected": False, "reason": "api_unreachable"}
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        return {"connected": False, "reason": "invalid_api_response"}
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
        """Read cached balances; never forces an exchange refresh."""
        return self._get(f"/api/v1/servers/{quote(name, safe='')}/portfolio")

    def market_venues(self, name: str):
        """Read Condor's supported market venues and their read-only flags."""
        return self._get(f"/api/v1/servers/{quote(name, safe='')}/market/venues")

    def market_tickers(self, name: str, connector: str):
        """Read cached market tickers for one validated connector."""
        query = urlencode({"connector": connector})
        return self._get(
            f"/api/v1/servers/{quote(name, safe='')}/market/tickers?{query}"
        )

    def bots(self, name: str):
        """Read bot and controller status without issuing control commands."""
        return self._get(f"/api/v1/servers/{quote(name, safe='')}/bots")

    def positions(self, name: str):
        """Read consolidated open-position snapshots."""
        return self._get(f"/api/v1/servers/{quote(name, safe='')}/positions")
