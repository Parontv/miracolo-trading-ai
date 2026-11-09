"""Small deterministic EMA crossover signal detector. It never places orders."""
from __future__ import annotations

def ema(values: list[float], period: int) -> list[float]:
    if period < 1:
        raise ValueError("period must be positive")
    if len(values) < period:
        return []
    alpha = 2.0 / (period + 1)
    result = [sum(values[:period]) / period]
    for value in values[period:]:
        result.append(alpha * value + (1 - alpha) * result[-1])
    return result

def crossover_signal(bars: list[dict], fast_period: int = 9, slow_period: int = 21) -> dict | None:
    if fast_period >= slow_period or len(bars) < slow_period + 1:
        return None
    try:
        closes = [float(bar["c"]) for bar in bars]
        bar_time = str(bars[-1]["t"])
    except (KeyError, TypeError, ValueError):
        return None
    if any(value <= 0 for value in closes):
        return None
    fast, slow = ema(closes, fast_period), ema(closes, slow_period)
    if len(fast) < 2 or len(slow) < 2:
        return None
    # Compare both EMAs at the same final two source bars.
    fast_prev, fast_now = fast[-2], fast[-1]
    slow_prev, slow_now = slow[-2], slow[-1]
    side = None
    if fast_prev <= slow_prev and fast_now > slow_now:
        side = "BUY"
    elif fast_prev >= slow_prev and fast_now < slow_now:
        side = "SELL"
    if side is None:
        return None
    return {"side": side, "bar_time": bar_time, "price": closes[-1],
            "fast_ema": fast_now, "slow_ema": slow_now}
