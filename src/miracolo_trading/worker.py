"""Restart-safe 24/7 market scanner. PAPER order execution is deliberately gated off."""
from __future__ import annotations

import logging
import math
import os
import signal
import time
from datetime import datetime, timedelta, timezone

from .journal import Journal
from .market_data import AlpacaCryptoData, CRYPTO_SYMBOLS
from .strategy import crossover_signals

LOG = logging.getLogger("miracolo.worker")
POLL_SECONDS = max(15, int(os.getenv("MIRACOLO_POLL_SECONDS", "60")))
STOP = False


def _stop(*_args):
    global STOP
    STOP = True


def _parse_time(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def closed_fresh_bars(bars, now=None, stale_seconds=180):
    """Keep valid, fully closed one-minute bars and reject stale market data."""
    now = now or datetime.now(timezone.utc)
    unique = {}
    for bar in bars or []:
        try:
            if isinstance(bar["c"], bool):
                continue
            close = float(bar["c"])
            bar_time = _parse_time(bar["t"])
        except (KeyError, TypeError, ValueError):
            continue
        if not math.isfinite(close) or close <= 0 or bar_time is None:
            continue
        if bar_time + timedelta(minutes=1) > now:
            continue
        canonical_time = bar_time.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
        unique[bar_time] = {**bar, "t": canonical_time}
    result = [unique[key] for key in sorted(unique)]
    if len(result) < 30:
        return [], "history_insufficient"
    latest_time = _parse_time(result[-1]["t"])
    if (now - latest_time).total_seconds() > stale_seconds:
        return [], "stale_market_data"
    return result, None


def run_worker(data_client=None, journal=None, sleep=time.sleep, max_cycles=None):
    data = data_client or AlpacaCryptoData.from_env()
    state = journal or Journal()
    cycles = 0
    while not STOP:
        if not data.configured:
            state.heartbeat("WAITING_CREDENTIALS", "Credenziali Alpaca PAPER non configurate")
        else:
            try:
                market = data.latest_bars(CRYPTO_SYMBOLS, limit=100)
                new_signals = 0
                issues = []
                for symbol in CRYPTO_SYMBOLS:
                    bars, problem = closed_fresh_bars(market.get(symbol, []))
                    if problem:
                        issues.append(f"{symbol}:{problem}")
                        continue

                    cursor = state.scan_cursor(symbol)
                    if cursor:
                        cursor_time = _parse_time(cursor)
                        first_time = _parse_time(bars[0]["t"])
                        last_time = _parse_time(bars[-1]["t"])
                        if cursor_time is None:
                            issues.append(f"{symbol}:invalid_scan_cursor")
                            continue
                        if cursor_time > last_time:
                            issues.append(f"{symbol}:cursor_ahead_of_market_data")
                            continue
                        if cursor_time < first_time:
                            issues.append(f"{symbol}:history_gap")
                        after_time = cursor
                    else:
                        # On first boot, evaluate only the newest closed bar. Never
                        # replay old historical signals as if they were fresh entries.
                        after_time = bars[-2]["t"]

                    for signal_data in crossover_signals(bars, after_time=after_time):
                        if state.record_signal(
                            symbol, signal_data["side"], signal_data["bar_time"],
                            signal_data["price"], signal_data["fast_ema"], signal_data["slow_ema"]
                        ):
                            new_signals += 1
                    state.update_scan_cursor(symbol, bars[-1]["t"])

                message = (
                    f"Scansione parziale: {', '.join(issues)}. Nuovi segnali: {new_signals}; "
                    "esecuzione ordini disabilitata"
                    if issues else
                    f"Scansione completata; nuovi segnali: {new_signals}; esecuzione ordini disabilitata"
                )
                state.heartbeat("DEGRADED" if issues else "MONITORING", message, cycle=True)
                LOG.info("market scan completed; new_signals=%s; issues=%s; execution=disabled",
                         new_signals, issues)
            except Exception as exc:
                state.heartbeat("DEGRADED", f"Errore scansione: {type(exc).__name__}")
                LOG.exception("market scan failed")
        cycles += 1
        if max_cycles is not None and cycles >= max_cycles:
            break
        sleep(POLL_SECONDS)


def main():
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    run_worker()


if __name__ == "__main__":
    main()
