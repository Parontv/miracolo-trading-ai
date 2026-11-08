"""Fail-closed safety policy for proposed PAPER trade intents."""
from dataclasses import dataclass

@dataclass(frozen=True)
class RiskPolicy:
    trading_mode: str = "PAPER"
    live_trading_allowed: bool = False
    max_new_trades_per_day: int = 3
    max_open_positions: int = 3
    max_daily_loss_usd: float = 15.0
    require_stop_loss: bool = True
    ai_agents_can_place_orders: bool = False

@dataclass(frozen=True)
class TradeIntent:
    source: str
    side: str
    notional_usd: float
    has_stop_loss: bool
    is_ai_generated: bool = False

def approve_intent(intent: TradeIntent, policy: RiskPolicy, *, trades_today: int, open_positions: int, daily_pnl_usd: float) -> tuple[bool, str]:
    """Return (approved, reason); reject by default when a guardrail fails."""
    if policy.trading_mode != "PAPER": return False, "Only PAPER mode is enabled."
    if policy.live_trading_allowed: return False, "Live trading must remain disabled in this release."
    if intent.is_ai_generated and policy.ai_agents_can_place_orders: return False, "AI agents cannot submit orders directly."
    if intent.side.upper() not in {"BUY", "SELL"}: return False, "Unsupported order side."
    if intent.notional_usd <= 0: return False, "Order notional must be positive."
    if trades_today >= policy.max_new_trades_per_day: return False, "Daily trade limit reached."
    if open_positions >= policy.max_open_positions: return False, "Maximum open positions reached."
    if daily_pnl_usd <= -abs(policy.max_daily_loss_usd): return False, "Daily loss limit reached."
    if policy.require_stop_loss and not intent.has_stop_loss: return False, "A stop loss is required."
    return True, "Approved for PAPER routing only."
