import unittest

from miracolo_trading.safety import RiskPolicy, TradeIntent, approve_intent


class SafetyPolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = RiskPolicy()
        self.intent = TradeIntent("strategy", "BUY", 50, True)
        self.state = dict(
            trades_today=0,
            open_positions=0,
            orders_last_minute=0,
            daily_pnl_usd=0,
        )

    def test_allows_valid_paper_crypto_intent(self):
        self.assertEqual(approve_intent(self.intent, self.policy, **self.state),
                         (True, "Approved for PAPER routing only."))

    def test_daily_trade_cap_is_three(self):
        state = {**self.state, "trades_today": 3}
        self.assertFalse(approve_intent(self.intent, self.policy, **state)[0])

    def test_blocks_non_crypto_assets(self):
        intent = TradeIntent("manual", "BUY", 50, True, asset_class="STOCK")
        self.assertFalse(approve_intent(intent, self.policy, **self.state)[0])

    def test_blocks_order_rate_limit(self):
        state = {**self.state, "orders_last_minute": 2}
        self.assertFalse(approve_intent(self.intent, self.policy, **state)[0])

    def test_blocks_missing_stop_loss(self):
        intent = TradeIntent("manual", "BUY", 50, False)
        self.assertFalse(approve_intent(intent, self.policy, **self.state)[0])

    def test_blocks_ai_direct_execution_by_default(self):
        intent = TradeIntent("AI", "BUY", 50, True, is_ai_generated=True)
        self.assertFalse(approve_intent(intent, self.policy, **self.state)[0])

    def test_blocks_live_mode(self):
        policy = RiskPolicy(trading_mode="LIVE")
        self.assertFalse(approve_intent(self.intent, policy, **self.state)[0])

    def test_blocks_daily_loss_limit(self):
        state = {**self.state, "daily_pnl_usd": -15}
        self.assertFalse(approve_intent(self.intent, self.policy, **state)[0])

    def test_blocks_too_many_open_positions_for_buy(self):
        state = {**self.state, "open_positions": 3}
        self.assertFalse(approve_intent(self.intent, self.policy, **state)[0])

    def test_does_not_block_sell_when_position_limit_reached(self):
        intent = TradeIntent("risk", "SELL", 50, True)
        state = {**self.state, "open_positions": 3}
        self.assertTrue(approve_intent(intent, self.policy, **state)[0])

    def test_blocks_order_above_notional_cap(self):
        intent = TradeIntent("manual", "BUY", 101, True)
        self.assertFalse(approve_intent(intent, self.policy, **self.state)[0])


if __name__ == "__main__":
    unittest.main()
