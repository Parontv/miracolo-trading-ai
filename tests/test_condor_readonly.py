import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from miracolo_trading.condor_readonly import (
    CondorReadOnlyClient,
    CondorReadOnlyConfig,
)


class Response:
    def __init__(self, payload):
        self.payload = payload
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return self.payload


class CondorReadOnlyTests(unittest.TestCase):
    def test_missing_token_fails_closed(self):
        client = CondorReadOnlyClient(CondorReadOnlyConfig("http://localhost:8088"))
        self.assertEqual(client.servers(), {"connected": False, "reason": "missing_api_token"})

    def test_only_api_paths_are_allowed(self):
        client = CondorReadOnlyClient(CondorReadOnlyConfig("http://localhost:8088", "token"))
        with self.assertRaises(ValueError):
            client._get("/api/v1/../orders")

    @patch("miracolo_trading.condor_readonly.urlopen")
    def test_servers_uses_get_and_bearer_auth(self, mocked):
        mocked.return_value = Response(b'[{"name":"paper","online":true}]')
        client = CondorReadOnlyClient(CondorReadOnlyConfig("http://localhost:8088", "secret"))
        self.assertEqual(client.servers(), [{"name": "paper", "online": True}])
        request = mocked.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")

    @patch("miracolo_trading.condor_readonly.urlopen", side_effect=TimeoutError)
    def test_timeout_reports_unreachable(self, _):
        client = CondorReadOnlyClient(CondorReadOnlyConfig("http://localhost:8088", "secret"))
        self.assertEqual(client.servers(), {"connected": False, "reason": "api_unreachable"})

    @patch("miracolo_trading.condor_readonly.urlopen")
    def test_local_mode_mints_session_jwt_and_reads_servers(self, mocked):
        mocked.side_effect = [
            Response(b'{"token":"local-session-jwt","user":{"id":1}}'),
            Response(b'[{"name":"paper","online":true}]'),
        ]
        client = CondorReadOnlyClient(CondorReadOnlyConfig(
            "http://127.0.0.1:8088", auth_mode="local"
        ))
        self.assertEqual(client.servers(), [{"name": "paper", "online": True}])
        login, read = mocked.call_args_list[0].args[0], mocked.call_args_list[1].args[0]
        self.assertEqual(login.full_url, "http://127.0.0.1:8088/api/v1/auth/local-login")
        self.assertEqual(login.get_method(), "POST")
        self.assertEqual(read.get_method(), "GET")
        self.assertEqual(read.get_header("Authorization"), "Bearer local-session-jwt")

    @patch("miracolo_trading.condor_readonly.urlopen")
    def test_local_mode_renews_expired_jwt_after_401(self, mocked):
        unauthorized = HTTPError("http://127.0.0.1:8088/api/v1/servers", 401, "expired", {}, None)
        mocked.side_effect = [
            unauthorized,
            Response(b'{"token":"renewed-jwt"}'),
            Response(b'[{"name":"paper","online":true}]'),
        ]
        client = CondorReadOnlyClient(CondorReadOnlyConfig(
            "http://127.0.0.1:8088", token="expired-jwt", auth_mode="local"
        ))
        self.assertEqual(client.servers(), [{"name": "paper", "online": True}])
        self.assertEqual(mocked.call_count, 3)
        self.assertEqual(mocked.call_args_list[1].args[0].full_url,
                         "http://127.0.0.1:8088/api/v1/auth/local-login")
        self.assertEqual(mocked.call_args_list[2].args[0].get_header("Authorization"),
                         "Bearer renewed-jwt")

    @patch("miracolo_trading.condor_readonly.urlopen")
    def test_local_mode_refuses_non_loopback_host(self, mocked):
        client = CondorReadOnlyClient(CondorReadOnlyConfig(
            "https://condor.example.com", auth_mode="local"
        ))
        self.assertEqual(client.servers(), {"connected": False, "reason": "missing_api_token"})
        mocked.assert_not_called()

    @patch("miracolo_trading.condor_readonly.urlopen")
    def test_market_tickers_are_read_only_and_encode_connector(self, mocked):
        mocked.return_value = Response(b'{"connector":"binance spot","tickers":[]}')
        client = CondorReadOnlyClient(CondorReadOnlyConfig(
            "http://localhost:8088", token="session"
        ))
        self.assertEqual(client.market_tickers("paper", "binance spot"),
                         {"connector": "binance spot", "tickers": []})
        request = mocked.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertIn("connector=binance+spot", request.full_url)

    def test_invalid_auth_mode_fails_closed(self):
        client = CondorReadOnlyClient(CondorReadOnlyConfig(
            "http://127.0.0.1:8088", auth_mode="none"
        ))
        self.assertEqual(client.servers(), {"connected": False, "reason": "invalid_auth_mode"})


if __name__ == "__main__":
    unittest.main()
