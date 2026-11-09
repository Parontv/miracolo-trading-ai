"""Deterministic, fail-closed risk policy for crypto-only PAPER trade intents."""
from dataclasses import dataclass


@dataclass(frozen=True)
class RiskPolicy:
    trading_mode: str = "PAPER"
    market_scope: str = "CRYPTO_ONLY"
    live_trading_allowed: bool = False
    # None means there is no daily trade-count cap. Risk is controlled by
    # exposure, order-rate, loss and per-order limits instead.
    max_new_trades_per_day: int | None = None
    max_open_positions: int = 3
    max_orders_per_minute: int = 2
    max_daily_loss_usd: float = 15.0
    max_order_notional_usd: float = 100.0
    require_stop_loss: bool = True
    ai_agents_can_place_orders: bool = False


@dataclass(frozen=True)
class TradeIntent:
    source: str
    side: str
    notional_usd: float
    has_stop_loss: bool
    is_ai_generated: bool = False
    asset_class: str = "CRYPTO"


def approve_intent(
    intent: TradeIntent,
    policy: RiskPolicy,
    *,
    trades_today: int,
    open_positions: int,
    orders_last_minute: int,
    daily_pnl_usd: float,
) -> tuple[bool, str]:
    """Approve safe crypto PAPER intents without a daily trade-count cap."""
    if policy.trading_mode != "PAPER":
        return False, "Only PAPER mode is enabled."
    if policy.market_scope != "CRYPTO_ONLY" or intent.asset_class.upper() != "CRYPTO":
        return False, "Only crypto markets are enabled."
    if policy.live_trading_allowed:
        return False, "Live trading must remain disabled in this release."
    if intent.is_ai_generated and not policy.ai_agents_can_place_orders:
        return False, "AI-generated intents cannot submit orders directly."
    if intent.side.upper() not in {"BUY", "SELL"}:
        return False, "Unsupported order side."
    if intent.notional_usd <= 0 or intent.notional_usd > policy.max_order_notional_usd:
        return False, "Order notional is outside the allowed range."
    if policy.max_new_trades_per_day is not None and trades_today >= policy.max_new_trades_per_day:
        return False, "Daily trade limit reached."
    if intent.side.upper() == "BUY" and open_positions >= policy.max_open_positions:
        return False, "Maximum open positions reached."
    if orders_last_minute >= policy.max_orders_per_minute:
        return False, "Order rate limit reached."
    if daily_pnl_usd <= -abs(policy.max_daily_loss_usd):
        return False, "Daily loss limit reached."
    if policy.require_stop_loss and not intent.has_stop_loss:
        return False, "A stop loss is required."
    return True, "Approved for PAPER routing only."
