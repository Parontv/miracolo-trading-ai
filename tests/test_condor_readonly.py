import unittest
from unittest.mock import patch

from miracolo_trading.condor_readonly import (
    CondorReadOnlyClient,
    CondorReadOnlyConfig,
)


class CondorReadOnlyTests(unittest.TestCase):
    def test_missing_token_fails_closed(self):
        client = CondorReadOnlyClient(CondorReadOnlyConfig("http://localhost:8088", ""))
        self.assertEqual(client.servers(), {"connected": False, "reason": "missing_api_token"})

    def test_only_api_paths_are_allowed(self):
        client = CondorReadOnlyClient(CondorReadOnlyConfig("http://localhost:8088", "token"))
        with self.assertRaises(ValueError):
            client._get("/api/v1/../orders")

    @patch("miracolo_trading.condor_readonly.urlopen")
    def test_servers_uses_get_and_bearer_auth(self, mocked):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return b'[{"name":"paper","online":true}]'
        mocked.return_value = Response()
        client = CondorReadOnlyClient(CondorReadOnlyConfig("http://localhost:8088", "secret"))
        self.assertEqual(client.servers(), [{"name": "paper", "online": True}])
        request = mocked.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")

    @patch("miracolo_trading.condor_readonly.urlopen", side_effect=TimeoutError)
    def test_timeout_reports_unreachable(self, _):
        client = CondorReadOnlyClient(CondorReadOnlyConfig("http://localhost:8088", "secret"))
        self.assertEqual(client.servers(), {"connected": False, "reason": "api_unreachable"})


if __name__ == "__main__":
    unittest.main()
