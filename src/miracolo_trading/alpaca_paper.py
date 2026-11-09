"""Fail-closed Alpaca crypto adapter. Trading host is permanently PAPER-only."""
from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


PAPER_BASE_URL = "https://paper-api.alpaca.markets"
ALLOWED_SYMBOLS = frozenset({"BTC/USD", "ETH/USD", "QNT/USD"})
MAX_ORDER_NOTIONAL_USD = 100.0
MAX_OPEN_POSITIONS = 3
CLIENT_ORDER_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,48}$")


class AlpacaError(RuntimeError):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class AlpacaPaperConfig:
    key_id: str
    secret_key: str
    timeout_seconds: float = 8.0

    @classmethod
    def from_env(cls) -> "AlpacaPaperConfig":
        return cls(
            key_id=os.getenv("APCA_API_KEY_ID", "").strip(),
            secret_key=os.getenv("APCA_API_SECRET_KEY", "").strip(),
            timeout_seconds=float(os.getenv("ALPACA_API_TIMEOUT", "8")),
        )


class AlpacaPaperClient:
    """Minimal REST client that cannot be configured to use Alpaca LIVE."""

    def __init__(self, config: AlpacaPaperConfig, opener=None):
        self.config = config
        self._opener = opener or urlopen

    @property
    def configured(self) -> bool:
        return bool(self.config.key_id and self.config.secret_key)

    def _request(self, method: str, path: str, payload=None):
        if not self.configured:
            raise AlpacaError("alpaca_credentials_missing", 503)
        if not path.startswith("/v2/") or ".." in path:
            raise AlpacaError("invalid_api_path", 400)
        data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
        request = Request(
            PAPER_BASE_URL + path,
            data=data,
            method=method,
            headers={
                "Accept": "application/json",
                "APCA-API-KEY-ID": self.config.key_id,
                "APCA-API-SECRET-KEY": self.config.secret_key,
                **({"Content-Type": "application/json"} if data is not None else {}),
            },
        )
        try:
            with self._opener(request, timeout=self.config.timeout_seconds) as response:
                raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
        except HTTPError as exc:
            # Never echo Alpaca response bodies: they may contain account details.
            raise AlpacaError(f"alpaca_http_{exc.code}", 502) from None
        except (URLError, TimeoutError, OSError):
            raise AlpacaError("alpaca_unreachable", 503) from None
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise AlpacaError("alpaca_invalid_response", 502) from None

    def account(self):
        return self._request("GET", "/v2/account")

    def assets(self):
        assets = self._request("GET", "/v2/assets?asset_class=crypto")
        if not isinstance(assets, list):
            raise AlpacaError("alpaca_assets_invalid", 502)
        return [
            {"symbol": item.get("symbol"), "tradable": bool(item.get("tradable")),
             "status": item.get("status"), "fractionable": bool(item.get("fractionable")),
             "min_order_size": item.get("min_order_size"),
             "min_trade_increment": item.get("min_trade_increment"),
             "price_increment": item.get("price_increment")}
            for item in assets if item.get("symbol") in ALLOWED_SYMBOLS
        ]

    def orders(self):
        return self._request("GET", "/v2/orders?" + urlencode({"status": "open", "limit": 100}))

    def positions(self):
        return self._request("GET", "/v2/positions")

    def get_order(self, order_id: str):
        if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", order_id):
            raise AlpacaError("invalid_order_id", 400)
        return self._request("GET", "/v2/orders/" + quote(order_id, safe=""))

    def cancel_order(self, order_id: str):
        if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", order_id):
            raise AlpacaError("invalid_order_id", 400)
        return self._request("DELETE", "/v2/orders/" + quote(order_id, safe=""))

    def submit_stop_limit_order(self, symbol: str, qty, stop_price, limit_price,
                                client_order_id: str):
        if symbol not in ALLOWED_SYMBOLS:
            raise AlpacaError("symbol_not_allowed", 400)
        if not CLIENT_ORDER_ID_RE.fullmatch(client_order_id):
            raise AlpacaError("invalid_client_order_id", 400)
        try:
            quantity, stop, limit = float(qty), float(stop_price), float(limit_price)
        except (TypeError, ValueError):
            raise AlpacaError("invalid_stop_order_values", 400) from None
        if quantity <= 0 or stop <= 0 or limit <= 0 or limit >= stop:
            raise AlpacaError("invalid_stop_limit_relationship", 400)
        asset = self._request("GET", "/v2/assets/" + quote(symbol, safe=""))
        if (asset.get("class") != "crypto" or asset.get("tradable") is not True
                or asset.get("status") != "active"):
            raise AlpacaError("asset_not_tradable", 409)
        positions = self.positions()
        held = next((p for p in positions if p.get("symbol") == symbol), None)
        if not held or quantity > float(held.get("qty", 0)):
            raise AlpacaError("stop_quantity_exceeds_position", 409)
        payload = {
            "symbol": symbol, "side": "sell", "type": "stop_limit",
            "time_in_force": "gtc", "qty": str(quantity),
            "stop_price": str(stop), "limit_price": str(limit),
            "client_order_id": client_order_id,
        }
        return self._request("POST", "/v2/orders", payload)

    def submit_market_order(self, symbol: str, side: str, notional=None, qty=None,
                            client_order_id: str | None = None):
        if symbol not in ALLOWED_SYMBOLS:
            raise AlpacaError("symbol_not_allowed", 400)
        if side not in {"buy", "sell"}:
            raise AlpacaError("side_not_allowed", 400)
        if (notional is None) == (qty is None):
            raise AlpacaError("provide_exactly_one_of_notional_or_qty", 400)
        if side == "buy" and notional is None:
            raise AlpacaError("buy_orders_require_usd_notional", 400)
        if side == "sell" and qty is None:
            raise AlpacaError("sell_orders_require_position_quantity", 400)
        try:
            amount = float(notional if notional is not None else qty)
        except (TypeError, ValueError):
            raise AlpacaError("invalid_order_size", 400) from None
        if amount <= 0:
            raise AlpacaError("invalid_order_size", 400)
        if notional is not None and amount > MAX_ORDER_NOTIONAL_USD:
            raise AlpacaError("order_limit_exceeded", 400)
        if client_order_id is None:
            client_order_id = "ml-" + uuid.uuid4().hex[:32]
        if not CLIENT_ORDER_ID_RE.fullmatch(client_order_id):
            raise AlpacaError("invalid_client_order_id", 400)

        # Verify the pair is currently active and tradable for this Paper account.
        asset = self._request("GET", "/v2/assets/" + quote(symbol, safe=""))
        if (asset.get("class") != "crypto" or asset.get("tradable") is not True
                or asset.get("status") != "active"):
            raise AlpacaError("asset_not_tradable", 409)

        if side == "sell":
            positions = self.positions()
            held = next((p for p in positions if p.get("symbol") == symbol), None)
            if not held:
                raise AlpacaError("no_long_position_to_sell", 409)
            held_qty = float(held.get("qty", 0))
            if qty is None or amount > held_qty:
                raise AlpacaError("sell_quantity_exceeds_position", 400)

        open_orders = self.orders()
        if not isinstance(open_orders, list):
            raise AlpacaError("alpaca_orders_invalid", 502)
        if len(open_orders) >= 10:
            raise AlpacaError("open_order_limit_reached", 409)
        if side == "buy":
            positions = self.positions()
            if not isinstance(positions, list):
                raise AlpacaError("alpaca_positions_invalid", 502)
            if not any(p.get("symbol") == symbol for p in positions) and len(positions) >= MAX_OPEN_POSITIONS:
                raise AlpacaError("open_position_limit_reached", 409)

        payload = {
            "symbol": symbol,
            "side": side,
            "type": "market",
            "time_in_force": "gtc",
            "client_order_id": client_order_id,
        }
        payload["notional" if notional is not None else "qty"] = str(amount)
        return self._request("POST", "/v2/orders", payload)
