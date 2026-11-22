import tempfile
import sqlite3
from datetime import datetime, timedelta, timezone
import unittest
from pathlib import Path

from miracolo_trading.journal import Journal
from miracolo_trading.strategy import crossover_signal, crossover_signals, ema
from miracolo_trading.worker import closed_fresh_bars, run_worker


class StrategyTests(unittest.TestCase):
    def test_ema_requires_enough_values(self):
        self.assertEqual(ema([1, 2, 3], 4), [])
        self.assertEqual(len(ema(list(range(1, 30)), 9)), 21)

    def test_no_signal_for_flat_market(self):
        bars = [{"c": "100", "t": f"2026-01-01T00:{i:02d}:00Z"} for i in range(30)]
        self.assertIsNone(crossover_signal(bars))

    def test_detects_buy_and_sell_crossovers(self):
        rising = [{"c": "100", "t": f"2026-01-01T00:{i:02d}:00Z"} for i in range(29)]
        rising.append({"c": "200", "t": "2026-01-01T00:29:00Z"})
        falling = [{"c": "100", "t": f"2026-01-01T00:{i:02d}:00Z"} for i in range(29)]
        falling.append({"c": "1", "t": "2026-01-01T00:29:00Z"})
        self.assertEqual(crossover_signal(rising)["side"], "BUY")
        self.assertEqual(crossover_signal(falling)["side"], "SELL")

    def test_replays_every_crossover_after_the_saved_cursor(self):
        values = [100] * 30 + [120] * 10 + [80] * 10 + [120] * 10
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        bars = [
            {"c": str(value), "t": (start + timedelta(minutes=index)).isoformat().replace("+00:00", "Z")}
            for index, value in enumerate(values)
        ]
        signals = crossover_signals(bars, after_time=bars[0]["t"])
        self.assertEqual([item["side"] for item in signals], ["BUY", "SELL", "BUY"])
        self.assertEqual(len(crossover_signals(bars, after_time=signals[0]["bar_time"])), 2)

    def test_strategy_rejects_boolean_close_values(self):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        bars = [
            {"c": "100", "t": (start + timedelta(minutes=index)).isoformat().replace("+00:00", "Z")}
            for index in range(30)
        ]
        bars[-1]["c"] = True
        self.assertEqual(crossover_signals(bars), [])

    def test_crossover_compares_same_bar_indices(self):
        bars = [{"c": str(100 + i), "t": f"2026-01-01T00:{i:02d}:00Z"} for i in range(30)]
        self.assertIsNone(crossover_signal(bars))

    def test_requires_sufficient_history(self):
        self.assertIsNone(crossover_signal([{"c": "100", "t": "now"}] * 10))


class MarketBarFilterTests(unittest.TestCase):
    def test_open_bars_are_excluded_and_stale_bars_are_rejected(self):
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        closed = [
            {"c": "100", "t": (now - timedelta(minutes=30 - index)).isoformat().replace("+00:00", "Z")}
            for index in range(30)
        ]
        closed[-1]["t"] = (now - timedelta(minutes=1)).astimezone(
            timezone(timedelta(hours=1))
        ).isoformat()
        open_bar = {"c": "200", "t": now.isoformat().replace("+00:00", "Z")}
        malformed = [
            {"c": True, "t": closed[0]["t"]},
            {"c": [100], "t": closed[0]["t"]},
        ]
        result, issue = closed_fresh_bars(closed + malformed + [open_bar], now=now)
        self.assertIsNone(issue)
        self.assertEqual(len(result), 30)
        self.assertEqual(result[-1]["c"], "100")
        self.assertTrue(result[-1]["t"].endswith("Z"))

        stale, issue = closed_fresh_bars(closed, now=now + timedelta(minutes=10))
        self.assertEqual(stale, [])
        self.assertEqual(issue, "stale_market_data")


class JournalTests(unittest.TestCase):
    def test_stale_worker_heartbeat_is_detected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "state.sqlite3")
            journal = Journal(path)
            journal.heartbeat("MONITORING", "ok", cycle=True)
            stale = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
            with sqlite3.connect(path) as db:
                db.execute("UPDATE worker_state SET last_heartbeat=?", (stale,))
            self.assertEqual(journal.status()["status"], "STALE")

    def test_scan_cursor_is_persistent_and_never_moves_backwards(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = Journal(str(Path(folder) / "state.sqlite3"))
            journal.update_scan_cursor("BTC/USD", "2026-01-01T00:02:00Z")
            journal.update_scan_cursor("BTC/USD", "2026-01-01T00:01:00Z")
            self.assertEqual(journal.scan_cursor("BTC/USD"), "2026-01-01T00:02:00Z")
            journal.update_scan_cursor("BTC/USD", "2026-01-01T00:03:00Z")
            self.assertEqual(journal.scan_cursor("BTC/USD"), "2026-01-01T00:03:00Z")

    def test_signal_deduplication_and_heartbeat(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = Journal(str(Path(folder) / "state.sqlite3"))
            self.assertTrue(journal.record_signal("BTC/USD", "BUY", "2026-01-01T00:00:00Z", 100, 101, 100))
            self.assertFalse(journal.record_signal("BTC/USD", "BUY", "2026-01-01T00:00:00Z", 100, 101, 100))
            journal.heartbeat("MONITORING", "ok", cycle=True)
            status = journal.status()
            self.assertEqual(status["status"], "MONITORING")
            self.assertEqual(status["signals_recorded"], 1)
            self.assertIsNotNone(status["last_cycle"])


class WorkerTests(unittest.TestCase):
    def test_worker_scans_and_persists_a_new_signal(self):
        class FakeData:
            configured = True
            def latest_bars(self, symbols, limit):
                now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
                last_closed = now - timedelta(minutes=1)
                times = [
                    (last_closed - timedelta(minutes=29 - index)).isoformat().replace("+00:00", "Z")
                    for index in range(30)
                ]
                rising = [{"c": "100", "t": times[index]} for index in range(29)]
                rising.append({"c": "200", "t": times[-1]})
                flat = [{"c": "100", "t": bar_time} for bar_time in times]
                return {"BTC/USD": rising, "ETH/USD": flat, "QNT/USD": flat}
        with tempfile.TemporaryDirectory() as folder:
            journal = Journal(str(Path(folder) / "state.sqlite3"))
            run_worker(data_client=FakeData(), journal=journal,
                       sleep=lambda _seconds: None, max_cycles=1)
            self.assertEqual(journal.status()["status"], "MONITORING")
            self.assertEqual(journal.status()["signals_recorded"], 1)

    def test_worker_replays_missed_bars_after_the_saved_cursor(self):
        scan_start = datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(minutes=60)

        class FakeData:
            configured = True
            def latest_bars(self, symbols, limit):
                values = [100] * 30 + [120] * 10 + [80] * 10 + [120] * 10
                bars = [
                    {"c": str(value), "t": (scan_start + timedelta(minutes=index)).isoformat().replace("+00:00", "Z")}
                    for index, value in enumerate(values)
                ]
                flat = [{"c": "100", "t": bar["t"]} for bar in bars]
                return {"BTC/USD": bars, "ETH/USD": flat, "QNT/USD": flat}

        with tempfile.TemporaryDirectory() as folder:
            journal = Journal(str(Path(folder) / "state.sqlite3"))
            first_bar = scan_start.isoformat().replace("+00:00", "Z")
            journal.update_scan_cursor("BTC/USD", first_bar)
            run_worker(data_client=FakeData(), journal=journal,
                       sleep=lambda _seconds: None, max_cycles=1)
            self.assertEqual(journal.status()["signals_recorded"], 3)
            self.assertEqual(journal.status()["status"], "MONITORING")

    def test_worker_waits_for_credentials_and_stops_after_one_cycle(self):
        class NoCredentials:
            configured = False
        with tempfile.TemporaryDirectory() as folder:
            journal = Journal(str(Path(folder) / "state.sqlite3"))
            run_worker(data_client=NoCredentials(), journal=journal,
                       sleep=lambda _seconds: None, max_cycles=1)
            self.assertEqual(journal.status()["status"], "WAITING_CREDENTIALS")


if __name__ == "__main__":
    unittest.main()
