import json
import unittest
from io import BytesIO

from miracolo_trading.http_api import create_app


class FakeCondor:
    def servers(self):
        return [{"name": "paper", "online": True}]

    def server_status(self, name):
        return {"name": name, "connected": True}

    def portfolio(self, name):
        return {"balances": []}

    def market_venues(self, name):
        return {"venues": [{"name": "binance", "hummingbot_market_data": True}]}

    def market_tickers(self, name, connector):
        return {"connector": connector, "tickers": []}

    def bots(self, name):
        return {"server_online": True, "bots": [{"name": "paper-bot", "status": "running"}]}

    def positions(self, name):
        return {"executor_positions": [], "bot_positions": []}


class HttpApiTests(unittest.TestCase):
    def request(self, path, method="GET", query=""):
        captured = {}
        def start_response(status, headers):
            captured["status"] = status
            captured["headers"] = dict(headers)
        app = create_app(FakeCondor())
        environ = {"REQUEST_METHOD": method, "PATH_INFO": path, "QUERY_STRING": query,
                   "wsgi.input": BytesIO(), "CONTENT_LENGTH": "0"}
        body = b"".join(app(environ, start_response))
        return captured, json.loads(body)

    def test_health_is_paper_only(self):
        response, body = self.request("/api/health")
        self.assertEqual(response["status"], "200 OK")
        self.assertEqual(body["mode"], "PAPER")
        self.assertFalse(body["live_enabled"])
        self.assertEqual(response["headers"]["Cache-Control"], "no-store")

    def test_lists_condor_servers_read_only(self):
        response, body = self.request("/api/condor/servers")
        self.assertEqual(response["status"], "200 OK")
        self.assertEqual(body[0]["name"], "paper")

    def test_reads_status_and_portfolio(self):
        _, status = self.request("/api/condor/servers/paper/status")
        _, portfolio = self.request("/api/condor/servers/paper/portfolio")
        self.assertTrue(status["connected"])
        self.assertEqual(portfolio["balances"], [])

    def test_condor_connection_failure_is_service_unavailable(self):
        class OfflineCondor(FakeCondor):
            def servers(self):
                return {"connected": False, "reason": "missing_api_token"}
        captured = {}
        def start_response(status, headers):
            captured["status"] = status
        app = create_app(OfflineCondor())
        body = b"".join(app({"REQUEST_METHOD": "GET", "PATH_INFO": "/api/condor/servers",
                             "wsgi.input": BytesIO(), "CONTENT_LENGTH": "0"}, start_response))
        self.assertEqual(captured["status"], "503 Service Unavailable")
        self.assertEqual(json.loads(body)["reason"], "missing_api_token")

    def test_reads_market_venues_and_tickers(self):
        _, venues = self.request("/api/condor/servers/paper/market/venues")
        _, tickers = self.request(
            "/api/condor/servers/paper/market/tickers", query="connector=binance"
        )
        self.assertTrue(venues["venues"][0]["hummingbot_market_data"])
        self.assertEqual(tickers["connector"], "binance")

    def test_reads_bot_and_position_status(self):
        _, bots = self.request("/api/condor/servers/paper/bots")
        _, positions = self.request("/api/condor/servers/paper/positions")
        self.assertEqual(bots["bots"][0]["status"], "running")
        self.assertEqual(positions["executor_positions"], [])

    def test_tickers_require_connector(self):
        response, body = self.request("/api/condor/servers/paper/market/tickers")
        self.assertEqual(response["status"], "400 Bad Request")
        self.assertEqual(body["error"], "connector_required")

    def test_unknown_route_is_not_found(self):
        response, _ = self.request("/api/orders")
        self.assertEqual(response["status"], "404 Not Found")

    def test_mutations_are_rejected(self):
        response, body = self.request("/api/condor/servers", method="POST")
        self.assertEqual(response["status"], "405 Method Not Allowed")
        self.assertEqual(body["error"], "method_not_allowed")


if __name__ == "__main__":
    unittest.main()
