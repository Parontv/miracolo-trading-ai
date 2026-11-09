"""Alpaca crypto market-data client, separate from the PAPER trading host."""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .alpaca_paper import AlpacaError

DATA_BASE_URL = "https://data.alpaca.markets"
CRYPTO_SYMBOLS = ("BTC/USD", "ETH/USD", "QNT/USD")


class AlpacaCryptoData:
    def __init__(self, key_id: str, secret_key: str, timeout: float = 8.0, opener=None):
        self.key_id = key_id
        self.secret_key = secret_key
        self.timeout = timeout
        self.opener = opener or urlopen

    @classmethod
    def from_env(cls):
        return cls(os.getenv("APCA_API_KEY_ID", "").strip(),
                   os.getenv("APCA_API_SECRET_KEY", "").strip(),
                   float(os.getenv("ALPACA_API_TIMEOUT", "8")))

    @property
    def configured(self):
        return bool(self.key_id and self.secret_key)

    def _get_bars_for_symbol(self, symbol: str, limit: int):
        end = datetime.now(timezone.utc)
        start = end - timedelta(hours=4)
        params = urlencode({
            "symbols": symbol,
            "timeframe": "1Min",
            "start": start.isoformat().replace("+00:00", "Z"),
            "end": end.isoformat().replace("+00:00", "Z"),
            "limit": str(limit),
            "sort": "asc",
        })
        request = Request(
            f"{DATA_BASE_URL}/v1beta3/crypto/us/bars?{params}",
            headers={"Accept": "application/json",
                     "APCA-API-KEY-ID": self.key_id,
                     "APCA-API-SECRET-KEY": self.secret_key},
        )
        try:
            with self.opener(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            raise AlpacaError(f"alpaca_data_http_{exc.code}", 502) from None
        except (URLError, TimeoutError, OSError):
            raise AlpacaError("alpaca_data_unreachable", 503) from None
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise AlpacaError("alpaca_data_invalid_response", 502) from None
        bars = payload.get("bars", {})
        if not isinstance(bars, dict) or not isinstance(bars.get(symbol, []), list):
            raise AlpacaError("alpaca_data_bars_invalid", 502)
        return bars.get(symbol, [])

    def latest_bars(self, symbols=CRYPTO_SYMBOLS, limit: int = 100):
        if not self.configured:
            raise AlpacaError("alpaca_credentials_missing", 503)
        if not 30 <= limit <= 1000:
            raise AlpacaError("invalid_bar_limit", 400)
        # Alpaca's limit is shared across all symbols, not per symbol.
        # Query each pair separately so BTC cannot consume ETH/QNT history.
        return {symbol: self._get_bars_for_symbol(symbol, limit) for symbol in symbols}
