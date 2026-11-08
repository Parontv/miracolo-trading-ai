import unittest
from miracolo_trading.safety import RiskPolicy, TradeIntent, approve_intent

class SafetyPolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = RiskPolicy()
        self.intent = TradeIntent("manual", "BUY", 50, True)
        self.state = dict(trades_today=0, open_positions=0, daily_pnl_usd=0)

    def test_approves_valid_paper_intent(self):
        self.assertTrue(approve_intent(self.intent, self.policy, **self.state)[0])

    def test_blocks_fourth_daily_trade(self):
        state = {**self.state, "trades_today": 3}
        self.assertFalse(approve_intent(self.intent, self.policy, **state)[0])

    def test_blocks_missing_stop_loss(self):
        intent = TradeIntent("manual", "BUY", 50, False)
        self.assertFalse(approve_intent(intent, self.policy, **self.state)[0])

    def test_blocks_ai_direct_execution(self):
        policy = RiskPolicy(ai_agents_can_place_orders=True)
        intent = TradeIntent("TradingAgents", "BUY", 50, True, is_ai_generated=True)
        self.assertFalse(approve_intent(intent, policy, **self.state)[0])

    def test_blocks_live_mode(self):
        policy = RiskPolicy(trading_mode="LIVE")
        self.assertFalse(approve_intent(self.intent, policy, **self.state)[0])

    def test_blocks_daily_loss_limit(self):
        state = {**self.state, "daily_pnl_usd": -15}
        self.assertFalse(approve_intent(self.intent, self.policy, **state)[0])

if __name__ == "__main__": unittest.main()
