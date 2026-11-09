import json
import unittest
from urllib.parse import urlparse, parse_qs

from miracolo_trading.market_data import AlpacaCryptoData, DATA_BASE_URL


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return self.payload


class MarketDataTests(unittest.TestCase):
    def test_fetches_each_symbol_separately_with_history_window(self):
        calls = []
        def opener(request, timeout):
            calls.append(request)
            query = parse_qs(urlparse(request.full_url).query)
            symbol = query["symbols"][0]
            return FakeResponse({"bars": {symbol: [{"c": 100, "t": "2026-11-09T00:00:00Z"}]}})
        client = AlpacaCryptoData("paper-key", "paper-secret", opener=opener)
        bars = client.latest_bars(("BTC/USD", "ETH/USD", "QNT/USD"), limit=100)
        self.assertEqual(set(bars), {"BTC/USD", "ETH/USD", "QNT/USD"})
        self.assertEqual(len(calls), 3)
        for request in calls:
            self.assertTrue(request.full_url.startswith(DATA_BASE_URL + "/v1beta3/crypto/us/bars?"))
            query = parse_qs(urlparse(request.full_url).query)
            self.assertEqual(query["timeframe"], ["1Min"])
            self.assertEqual(query["limit"], ["100"])
            self.assertIn("start", query)
            self.assertEqual(request.get_header("Apca-api-key-id"), "paper-key")

    def test_missing_credentials_fail_closed(self):
        client = AlpacaCryptoData("", "")
        with self.assertRaisesRegex(Exception, "alpaca_credentials_missing"):
            client.latest_bars()

    def test_rejects_invalid_limit(self):
        client = AlpacaCryptoData("key", "secret")
        with self.assertRaisesRegex(Exception, "invalid_bar_limit"):
            client.latest_bars(limit=10)


if __name__ == "__main__":
    unittest.main()
