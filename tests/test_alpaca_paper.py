import json
import os
import unittest
from io import BytesIO
from unittest.mock import patch

from miracolo_trading.alpaca_paper import (
    ALLOWED_SYMBOLS, PAPER_BASE_URL, AlpacaError, AlpacaPaperClient, AlpacaPaperConfig,
)
from miracolo_trading.http_api import create_app


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return self.payload


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def opener(request, timeout):
            self.calls.append(request)
            path = request.full_url.removeprefix(PAPER_BASE_URL)
            if path.startswith("/v2/assets/BTC"):
                return FakeResponse({"class": "crypto", "tradable": True, "status": "active"})
            if path.startswith("/v2/orders?"):
                return FakeResponse([])
            if path == "/v2/positions":
                return FakeResponse([])
            if path == "/v2/orders":
                return FakeResponse({"id": "paper-order", "symbol": "BTC/USD"})
            return FakeResponse({"status": "ACTIVE", "cash": "1000"})
        self.client = AlpacaPaperClient(AlpacaPaperConfig("paper-key", "paper-secret"), opener)

    def test_paper_host_is_fixed_and_headers_are_server_side(self):
        self.client.account()
        request = self.calls[0]
        self.assertEqual(request.full_url, PAPER_BASE_URL + "/v2/account")
        self.assertEqual(request.get_header("Apca-api-key-id"), "paper-key")
        self.assertEqual(request.get_header("Apca-api-secret-key"), "paper-secret")
        self.assertNotIn("api.alpaca.markets/v2", request.full_url.replace("paper-api.", ""))

    def test_only_allowlisted_symbols(self):
        with self.assertRaisesRegex(AlpacaError, "symbol_not_allowed"):
            self.client.submit_market_order("QNT/USDT", "buy", notional=20)
        self.assertEqual(self.calls, [])

    def test_order_is_market_gtc_with_client_id_and_size_cap(self):
        result = self.client.submit_market_order(
            "BTC/USD", "buy", notional=50, client_order_id="miracolo-test-001"
        )
        self.assertEqual(result["id"], "paper-order")
        post = self.calls[-1]
        body = json.loads(post.data)
        self.assertEqual(post.method, "POST")
        self.assertEqual(body["type"], "market")
        self.assertEqual(body["time_in_force"], "gtc")
        self.assertEqual(body["client_order_id"], "miracolo-test-001")
        self.assertEqual(body["notional"], "50.0")
        with self.assertRaisesRegex(AlpacaError, "order_limit_exceeded"):
            self.client.submit_market_order("BTC/USD", "buy", notional=101)

    def test_sell_requires_existing_long_position(self):
        with self.assertRaisesRegex(AlpacaError, "no_long_position_to_sell"):
            self.client.submit_market_order("BTC/USD", "sell", qty=0.001)

    def test_buy_requires_usd_notional_to_enforce_cap(self):
        with self.assertRaisesRegex(AlpacaError, "buy_orders_require_usd_notional"):
            self.client.submit_market_order("BTC/USD", "buy", qty=1)

    def test_missing_credentials_fail_closed(self):
        client = AlpacaPaperClient(AlpacaPaperConfig("", ""))
        with self.assertRaisesRegex(AlpacaError, "alpaca_credentials_missing"):
            client.account()

    def test_symbol_allowlist_is_crypto_only(self):
        self.assertEqual(ALLOWED_SYMBOLS, {"BTC/USD", "ETH/USD", "QNT/USD"})
        self.assertTrue(PAPER_BASE_URL.startswith("https://paper-api."))


class FakeAlpaca:
    configured = True
    def __init__(self): self.submitted = []
    def account(self): return {"status": "ACTIVE", "cash": "1000"}
    def assets(self): return [{"symbol": "BTC/USD", "tradable": True}]
    def orders(self): return []
    def positions(self): return []
    def submit_market_order(self, **kwargs):
        self.submitted.append(kwargs)
        return {"id": "paper-order", **kwargs}


class ApiAuthTests(unittest.TestCase):
    def setUp(self):
        self.paper = FakeAlpaca()
        self.app = create_app(alpaca=self.paper)

    def request(self, path, method="GET", payload=None, token=None):
        body = b"" if payload is None else json.dumps(payload).encode()
        captured = {}
        def start(status, headers): captured["status"] = status
        env = {
            "REQUEST_METHOD": method, "PATH_INFO": path, "QUERY_STRING": "",
            "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body),
            "REMOTE_ADDR": "127.0.0.1",
        }
        if token:
            env["HTTP_AUTHORIZATION"] = "Bearer " + token
        with patch.dict(os.environ, {"MIRACOLO_API_TOKEN": "test-session-token"}):
            raw = b"".join(self.app(env, start))
        return captured["status"], json.loads(raw)

    def test_alpaca_routes_require_server_token(self):
        status, payload = self.request("/api/alpaca/status")
        self.assertEqual(status, "401 Unauthorized")
        self.assertEqual(payload["error"], "authentication_required")

    def test_authenticated_status_is_explicitly_paper(self):
        status, payload = self.request("/api/alpaca/status", token="test-session-token")
        self.assertEqual(status, "200 OK")
        self.assertEqual(payload["mode"], "PAPER")
        self.assertFalse(payload["live_enabled"])

    def test_authenticated_order_is_locked_until_risk_gateway_is_ready(self):
        status, payload = self.request(
            "/api/alpaca/orders", "POST",
            {"symbol": "BTC/USD", "side": "buy", "notional": 25},
            "test-session-token",
        )
        self.assertEqual(status, "423 Locked")
        self.assertEqual(payload["error"], "execution_disabled_until_risk_gateway_and_end_to_end_paper_validation")
        self.assertEqual(len(self.paper.submitted), 0)

    def test_non_loopback_is_blocked(self):
        body = b""
        captured = {}
        def start(status, headers): captured["status"] = status
        env = {"REQUEST_METHOD": "GET", "PATH_INFO": "/api/alpaca/status",
               "CONTENT_LENGTH": "0", "wsgi.input": BytesIO(body),
               "REMOTE_ADDR": "203.0.113.10",
               "HTTP_AUTHORIZATION": "Bearer test-session-token"}
        with patch.dict(os.environ, {"MIRACOLO_API_TOKEN": "test-session-token"}):
            response = b"".join(self.app(env, start))
        self.assertEqual(captured["status"], "403 Forbidden")
        self.assertIn(b"loopback_access_only", response)


if __name__ == "__main__":
    unittest.main()
