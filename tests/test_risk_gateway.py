import tempfile
import unittest
from pathlib import Path

from miracolo_trading.risk_gateway import OrderIntent, RiskGateway, RiskSnapshot


class RiskGatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.gateway = RiskGateway(str(Path(self.temp.name) / "risk.sqlite3"))
        self.snapshot = RiskSnapshot(open_positions=0, open_orders=0, daily_pnl_usd=0)
        self.intent = OrderIntent("miracolo-test-001", "BTC/USD", "BUY", 50, 100, 95)

    def tearDown(self):
        self.temp.cleanup()

    def test_reserves_valid_paper_order(self):
        self.assertEqual(self.gateway.reserve(self.intent, self.snapshot, now=1000),
                         (True, "Reserved for PAPER routing only."))

    def test_no_daily_trade_count_cap(self):
        for index in range(8):
            intent = OrderIntent(f"miracolo-{index:04d}", "BTC/USD", "BUY", 50, 100, 95)
            ok, reason = self.gateway.reserve(intent, self.snapshot, now=1000 + index * 61)
            self.assertTrue(ok, reason)

    def test_idempotency_blocks_duplicate(self):
        self.gateway.reserve(self.intent, self.snapshot, now=1000)
        self.assertEqual(self.gateway.reserve(self.intent, self.snapshot, now=1061),
                         (False, "Duplicate order intent."))

    def test_kill_switch_blocks(self):
        snapshot = RiskSnapshot(0, 0, 0, kill_switch=True)
        self.assertFalse(self.gateway.reserve(self.intent, snapshot, now=1000)[0])

    def test_daily_loss_blocks(self):
        snapshot = RiskSnapshot(0, 0, -15)
        self.assertEqual(self.gateway.reserve(self.intent, snapshot, now=1000),
                         (False, "Daily loss limit reached."))

    def test_requires_valid_stop_loss_for_buy(self):
        intent = OrderIntent("miracolo-test-002", "BTC/USD", "BUY", 50, 100, None)
        self.assertFalse(self.gateway.reserve(intent, self.snapshot, now=1000)[0])

    def test_blocks_position_limit_and_non_crypto(self):
        snapshot = RiskSnapshot(3, 0, 0)
        self.assertFalse(self.gateway.reserve(self.intent, snapshot, now=1000)[0])
        intent = OrderIntent("miracolo-test-003", "AAPL", "BUY", 50, 100, 95)
        self.assertFalse(self.gateway.reserve(intent, self.snapshot, now=1000)[0])

    def test_rate_limit_is_persistent(self):
        self.assertTrue(self.gateway.reserve(self.intent, self.snapshot, now=1000)[0])
        second = OrderIntent("miracolo-test-002", "ETH/USD", "BUY", 50, 100, 95)
        self.assertTrue(self.gateway.reserve(second, self.snapshot, now=1020)[0])
        third = OrderIntent("miracolo-test-003", "QNT/USD", "BUY", 50, 100, 95)
        self.assertEqual(self.gateway.reserve(third, self.snapshot, now=1025),
                         (False, "Order rate limit reached."))

    def test_mark_submitted_only_once(self):
        self.gateway.reserve(self.intent, self.snapshot, now=1000)
        self.assertTrue(self.gateway.mark_submitted(self.intent.client_order_id))
        self.assertFalse(self.gateway.mark_submitted(self.intent.client_order_id))


if __name__ == "__main__":
    unittest.main()
