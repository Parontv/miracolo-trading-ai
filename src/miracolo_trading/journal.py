"""Durable local journal for worker heartbeat and deduplicated market signals."""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


class Journal:
    def __init__(self, path: str | None = None):
        self.path = path or os.getenv("MIRACOLO_STATE_DB", "./data/miracolo.sqlite3")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS worker_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    status TEXT NOT NULL,
                    last_heartbeat TEXT NOT NULL,
                    last_cycle TEXT,
                    message TEXT
                );
                CREATE TABLE IF NOT EXISTS signals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    signal_key TEXT NOT NULL UNIQUE,
                    symbol TEXT NOT NULL,
                    side TEXT NOT NULL,
                    bar_time TEXT NOT NULL,
                    price REAL NOT NULL,
                    fast_ema REAL NOT NULL,
                    slow_ema REAL NOT NULL,
                    created_at TEXT NOT NULL,
                    payload TEXT NOT NULL
                );
            """)

    def _connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    @staticmethod
    def now():
        return datetime.now(timezone.utc).isoformat()

    def heartbeat(self, status: str, message: str = "", cycle: bool = False):
        now = self.now()
        with self._connect() as db:
            db.execute("""
                INSERT INTO worker_state(id,status,last_heartbeat,last_cycle,message)
                VALUES(1,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                    status=excluded.status,
                    last_heartbeat=excluded.last_heartbeat,
                    last_cycle=COALESCE(excluded.last_cycle,worker_state.last_cycle),
                    message=excluded.message
            """, (status, now, now if cycle else None, message[:240]))

    def record_signal(self, symbol: str, side: str, bar_time: str,
                      price: float, fast_ema: float, slow_ema: float) -> bool:
        key = f"{symbol}:{side}:{bar_time}"
        payload = json.dumps({"symbol": symbol, "side": side, "bar_time": bar_time,
                              "price": price, "fast_ema": fast_ema, "slow_ema": slow_ema})
        with self._connect() as db:
            cur = db.execute("""
                INSERT OR IGNORE INTO signals
                (signal_key,symbol,side,bar_time,price,fast_ema,slow_ema,created_at,payload)
                VALUES(?,?,?,?,?,?,?,?,?)
            """, (key, symbol, side, bar_time, price, fast_ema, slow_ema, self.now(), payload))
            return cur.rowcount == 1

    def status(self):
        with self._connect() as db:
            row = db.execute("SELECT * FROM worker_state WHERE id=1").fetchone()
            count = db.execute("SELECT COUNT(*) AS n FROM signals").fetchone()["n"]
        if row is None:
            return {"status": "NOT_STARTED", "last_heartbeat": None,
                    "last_cycle": None, "message": "Worker non ancora avviato",
                    "signals_recorded": count}
        return {"status": row["status"], "last_heartbeat": row["last_heartbeat"],
                "last_cycle": row["last_cycle"], "message": row["message"] or "",
                "signals_recorded": count}

    def recent_signals(self, limit: int = 20):
        with self._connect() as db:
            rows = db.execute(
                "SELECT symbol,side,bar_time,price,fast_ema,slow_ema,created_at "
                "FROM signals ORDER BY id DESC LIMIT ?", (max(1, min(limit, 100)),)
            ).fetchall()
        return [dict(row) for row in rows]
