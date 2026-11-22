"""Small deterministic EMA crossover signal detector. It never places orders."""
from __future__ import annotations

import math
from datetime import datetime


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


def _parse_time(value: object) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed
    except (TypeError, ValueError):
        return None


def crossover_signals(
    bars: list[dict],
    fast_period: int = 9,
    slow_period: int = 21,
    after_time: str | None = None,
) -> list[dict]:
    """Return every EMA crossover after a cursor, using aligned source-bar indices."""
    if fast_period < 1 or slow_period < 1 or fast_period >= slow_period:
        return []
    if len(bars) < slow_period + 1:
        return []

    try:
        if any(isinstance(bar["c"], bool) for bar in bars):
            return []
        closes = [float(bar["c"]) for bar in bars]
        times = [_parse_time(bar["t"]) for bar in bars]
    except (KeyError, TypeError, ValueError):
        return []
    if any(not math.isfinite(value) or value <= 0 for value in closes):
        return []
    if any(value is None for value in times):
        return []
    if any(times[index] <= times[index - 1] for index in range(1, len(times))):
        return []

    cursor = _parse_time(after_time) if after_time is not None else None
    if after_time is not None and cursor is None:
        return []

    fast, slow = ema(closes, fast_period), ema(closes, slow_period)
    signals = []
    for index in range(slow_period, len(bars)):
        if cursor is not None and times[index] <= cursor:
            continue
        fast_previous = fast[index - fast_period]
        fast_current = fast[index - fast_period + 1]
        slow_previous = slow[index - slow_period]
        slow_current = slow[index - slow_period + 1]
        side = None
        if fast_previous <= slow_previous and fast_current > slow_current:
            side = "BUY"
        elif fast_previous >= slow_previous and fast_current < slow_current:
            side = "SELL"
        if side is not None:
            signals.append({
                "side": side,
                "bar_time": str(bars[index]["t"]),
                "price": closes[index],
                "fast_ema": fast_current,
                "slow_ema": slow_current,
            })
    return signals


def crossover_signal(bars: list[dict], fast_period: int = 9, slow_period: int = 21) -> dict | None:
    """Compatibility helper returning only the most recent crossover."""
    signals = crossover_signals(bars, fast_period, slow_period)
    return signals[-1] if signals else None
