import json
import unittest
from io import BytesIO

from miracolo_trading.http_api import create_app


class FakeAlpaca:
    configured = True
    def account(self): return {"status": "ACTIVE", "cash": "1000"}
    def assets(self): return [{"symbol": "BTC/USD", "tradable": True}]
    def orders(self): return []
    def positions(self): return []


class HttpApiTests(unittest.TestCase):
    def request(self, path, method="GET", remote="127.0.0.1"):
        captured = {}
        def start(status, headers): captured["status"] = status
        app = create_app(alpaca=FakeAlpaca())
        env = {"REQUEST_METHOD": method, "PATH_INFO": path, "QUERY_STRING": "",
               "wsgi.input": BytesIO(), "CONTENT_LENGTH": "0", "REMOTE_ADDR": remote}
        body = b"".join(app(env, start))
        return captured["status"], json.loads(body)

    def test_health_is_paper_only_and_never_enables_execution(self):
        status, body = self.request("/api/health")
        self.assertEqual(status, "200 OK")
        self.assertEqual(body["mode"], "PAPER")
        self.assertFalse(body["live_enabled"])
        self.assertFalse(body["execution_enabled"])
        self.assertTrue(body["alpaca_configured"])

    def test_non_loopback_clients_are_blocked(self):
        status, body = self.request("/api/health", remote="203.0.113.10")
        self.assertEqual(status, "403 Forbidden")
        self.assertEqual(body["error"], "loopback_access_only")

    def test_unknown_route_is_not_found(self):
        status, body = self.request("/api/condor/servers")
        self.assertEqual(status, "404 Not Found")
        self.assertEqual(body["error"], "not_found")

    def test_mutations_outside_alpaca_are_rejected(self):
        status, body = self.request("/api/health", method="POST")
        self.assertEqual(status, "405 Method Not Allowed")
        self.assertEqual(body["error"], "method_not_allowed")


if __name__ == "__main__":
    unittest.main()
