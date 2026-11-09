import sqlite3
import unittest
from pathlib import Path


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        migration_dir = Path(__file__).resolve().parents[1] / "migrations"
        for migration in sorted(migration_dir.glob("*.sql")):
            self.db.executescript(migration.read_text(encoding="utf-8"))

    def tearDown(self):
        self.db.close()

    def test_journal_tables_and_index_exist(self):
        rows = self.db.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'index')"
        ).fetchall()
        names = {row[0] for row in rows}
        self.assertIn("worker_status", names)
        self.assertIn("signals", names)
        self.assertIn("scan_cursors", names)
        self.assertIn("risk_reservations", names)
        self.assertIn("order_journal", names)
        self.assertIn("idx_signals_created_at", names)
        self.assertIn("idx_order_journal_state_updated", names)

    def test_signal_key_is_unique_and_side_is_constrained(self):
        values = ("BTC/USD:BUY:2026-11-09T10:00:00Z", "BTC/USD", "BUY",
                  "2026-11-09T10:00:00Z", 100.0, 99.0, 98.0,
                  "2026-11-09T10:00:01Z")
        insert = (
            "INSERT INTO signals (signal_key, symbol, side, bar_time, price, "
            "fast_ema, slow_ema, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        self.db.execute(insert, values)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(insert, values)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(insert, ("bad-side", "BTC/USD", "HOLD",
                                     values[3], 100.0, 99.0, 98.0, values[7]))

    def test_cursor_is_unique_per_symbol_and_can_advance(self):
        self.db.execute(
            "INSERT INTO scan_cursors (symbol, last_bar_time, updated_at) "
            "VALUES (?, ?, ?)",
            ("BTC/USD", "2026-11-09T10:00:00Z", "2026-11-09T10:00:01Z"),
        )
        self.db.execute(
            "INSERT INTO scan_cursors (symbol, last_bar_time, updated_at) "
            "VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET "
            "last_bar_time=excluded.last_bar_time, updated_at=excluded.updated_at",
            ("BTC/USD", "2026-11-09T10:01:00Z", "2026-11-09T10:01:01Z"),
        )
        row = self.db.execute(
            "SELECT last_bar_time FROM scan_cursors WHERE symbol = ?",
            ("BTC/USD",),
        ).fetchone()
        self.assertEqual(row[0], "2026-11-09T10:01:00Z")

    def test_order_journal_is_idempotent_and_state_is_constrained(self):
        values = (
            "client-1", "signal-1", "BTC/USD", "BUY", "NEW",
            "2026-11-09T10:00:00Z", "2026-11-09T10:00:00Z",
        )
        insert = (
            "INSERT INTO order_journal "
            "(client_order_id, signal_key, symbol, side, state, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        self.db.execute(insert, values)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(insert, values)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO order_journal "
                "(client_order_id, signal_key, symbol, side, state, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("client-2", "signal-2", "BTC/USD", "BUY", "UNKNOWN",
                 values[5], values[6]),
            )

    def test_risk_reservation_signal_key_is_unique(self):
        values = ("client-1", "signal-1", "BTC/USD", "BUY", 50.0,
                  "RESERVED", "2026-11-09T10:00:00Z", "2026-11-09T10:00:00Z")
        insert = (
            "INSERT INTO risk_reservations "
            "(client_order_id, signal_key, symbol, side, notional_usd, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        self.db.execute(insert, values)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(insert, ("client-2", *values[1:]))


if __name__ == "__main__":
    unittest.main()
