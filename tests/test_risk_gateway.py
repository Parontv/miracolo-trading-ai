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

    def test_pending_buys_count_toward_position_limit(self):
        self.assertTrue(self.gateway.reserve(self.intent, self.snapshot, now=1000)[0])
        second = OrderIntent("miracolo-test-002", "ETH/USD", "BUY", 50, 100, 95)
        self.assertTrue(self.gateway.reserve(second, self.snapshot, now=1061)[0])
        third = OrderIntent("miracolo-test-003", "QNT/USD", "BUY", 50, 100, 95)
        snapshot = RiskSnapshot(open_positions=1, open_orders=0, daily_pnl_usd=0)
        self.assertEqual(self.gateway.reserve(third, snapshot, now=1122),
                         (False, "Maximum open positions reached."))

    def test_rejects_nan_order_values(self):
        invalid = OrderIntent("miracolo-test-004", "BTC/USD", "BUY", float("nan"), 100, 95)
        self.assertFalse(self.gateway.reserve(invalid, self.snapshot, now=1000)[0])
        invalid_pnl = RiskSnapshot(0, 0, float("nan"))
        valid = OrderIntent("miracolo-test-005", "BTC/USD", "BUY", 50, 100, 95)
        self.assertFalse(self.gateway.reserve(valid, invalid_pnl, now=1000)[0])

    def test_reduce_only_sell_remains_available_with_kill_switch_and_daily_loss_limit(self):
        intent = OrderIntent(
            "miracolo-sell-001", "BTC/USD", "SELL", 1, 100, None,
            quantity=0.01, reduce_only=True,
        )
        snapshot = RiskSnapshot(
            open_positions=None, open_orders=2, daily_pnl_usd=None,
            kill_switch=None, open_position_symbols=("BTC/USD",), held_quantity=0.01, held_symbol="BTC/USD",
        )
        self.assertTrue(self.gateway.reserve(intent, snapshot, now=1000)[0])

    def test_sell_requires_reduce_only_and_cannot_exceed_held_quantity(self):
        not_reduce_only = OrderIntent(
            "miracolo-sell-002", "BTC/USD", "SELL", 50, 100, None,
            quantity=0.01, reduce_only=False,
        )
        snapshot = RiskSnapshot(1, 0, 0, open_position_symbols=("BTC/USD",), held_quantity=0.01, held_symbol="BTC/USD")
        self.assertEqual(self.gateway.reserve(not_reduce_only, snapshot, now=1000),
                         (False, "Sell orders must be reduce-only."))
        oversized = OrderIntent(
            "miracolo-sell-003", "BTC/USD", "SELL", 50, 100, None,
            quantity=0.02, reduce_only=True,
        )
        self.assertEqual(self.gateway.reserve(oversized, snapshot, now=1000),
                         (False, "Sell quantity exceeds the held position."))

    def test_sell_requires_confirmed_matching_position_symbol(self):
        intent = OrderIntent(
            "miracolo-sell-006", "BTC/USD", "SELL", 1, 100, None,
            quantity=0.01, reduce_only=True,
        )
        snapshot = RiskSnapshot(1, 0, 0, open_position_symbols=("ETH/USD",), held_quantity=0.01, held_symbol="ETH/USD")
        self.assertEqual(self.gateway.reserve(intent, snapshot, now=1000),
                         (False, "Sell position symbol is not confirmed."))

    def test_reduce_only_sell_notional_must_match_quantity_and_reference_price(self):
        intent = OrderIntent(
            "miracolo-sell-005", "BTC/USD", "SELL", 50, 100, None,
            quantity=0.01, reduce_only=True,
        )
        snapshot = RiskSnapshot(1, 0, 0, open_position_symbols=("BTC/USD",), held_quantity=0.01, held_symbol="BTC/USD")
        self.assertEqual(self.gateway.reserve(intent, snapshot, now=1000),
                         (False, "Sell notional does not match the bounded position quantity."))

    def test_reduce_only_sell_is_not_blocked_by_buy_order_rate_limit(self):
        first = OrderIntent("miracolo-buy-101", "BTC/USD", "BUY", 50, 100, 95)
        second = OrderIntent("miracolo-buy-102", "ETH/USD", "BUY", 50, 100, 95)
        self.assertTrue(self.gateway.reserve(first, self.snapshot, now=1000)[0])
        self.assertTrue(self.gateway.reserve(second, self.snapshot, now=1020)[0])
        sell = OrderIntent(
            "miracolo-sell-004", "BTC/USD", "SELL", 1, 100, None,
            quantity=0.01, reduce_only=True,
        )
        snapshot = RiskSnapshot(1, 2, -20, open_position_symbols=("BTC/USD",), held_quantity=0.01, held_symbol="BTC/USD")
        self.assertTrue(self.gateway.reserve(sell, snapshot, now=1025)[0])

    def test_boolean_notional_is_not_accepted_as_a_number(self):
        intent = OrderIntent("miracolo-bool-001", "BTC/USD", "BUY", True, 100, 95)
        self.assertEqual(
            self.gateway.reserve(intent, self.snapshot, now=1000),
            (False, "Order notional is outside the allowed range."),
        )

    def test_unknown_kill_switch_and_invalid_position_counts_fail_closed(self):
        self.assertEqual(
            self.gateway.reserve(self.intent, RiskSnapshot(1, 0, 0, kill_switch=None), now=1000),
            (False, "Kill switch state is unknown."),
        )
        self.assertEqual(
            self.gateway.reserve(self.intent, RiskSnapshot(-1, 0, 0), now=1000),
            (False, "Open position count is invalid."),
        )

    def test_mark_submitted_only_once(self):
        self.gateway.reserve(self.intent, self.snapshot, now=1000)
        self.assertTrue(self.gateway.mark_submitted(self.intent.client_order_id))
        self.assertFalse(self.gateway.mark_submitted(self.intent.client_order_id))


if __name__ == "__main__":
    unittest.main()
