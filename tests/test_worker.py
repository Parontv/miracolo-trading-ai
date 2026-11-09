import tempfile
import unittest
from pathlib import Path

from miracolo_trading.journal import Journal
from miracolo_trading.strategy import crossover_signal, ema
from miracolo_trading.worker import run_worker


class StrategyTests(unittest.TestCase):
    def test_ema_requires_enough_values(self):
        self.assertEqual(ema([1, 2, 3], 4), [])
        self.assertEqual(len(ema(list(range(1, 30)), 9)), 21)

    def test_no_signal_for_flat_market(self):
        bars = [{"c": "100", "t": f"2026-01-01T00:{i:02d}:00Z"} for i in range(30)]
        self.assertIsNone(crossover_signal(bars))

    def test_requires_sufficient_history(self):
        self.assertIsNone(crossover_signal([{"c": "100", "t": "now"}] * 10))


class JournalTests(unittest.TestCase):
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
