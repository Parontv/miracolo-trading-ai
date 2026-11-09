"""Restart-safe 24/7 market scanner. PAPER order execution is deliberately gated off."""
from __future__ import annotations
import logging
import os
import signal
import time
from .journal import Journal
from .market_data import AlpacaCryptoData, CRYPTO_SYMBOLS
from .strategy import crossover_signal

LOG = logging.getLogger("miracolo.worker")
POLL_SECONDS = max(15, int(os.getenv("MIRACOLO_POLL_SECONDS", "60")))
STOP = False

def _stop(*_args):
    global STOP
    STOP = True

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
                for symbol in CRYPTO_SYMBOLS:
                    signal_data = crossover_signal(market.get(symbol, []))
                    if signal_data and state.record_signal(
                        symbol, signal_data["side"], signal_data["bar_time"],
                        signal_data["price"], signal_data["fast_ema"], signal_data["slow_ema"]
                    ):
                        new_signals += 1
                state.heartbeat("MONITORING",
                    f"Scansione completata; nuovi segnali: {new_signals}; esecuzione ordini disabilitata",
                    cycle=True)
                LOG.info("market scan completed; new_signals=%s; execution=disabled", new_signals)
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
