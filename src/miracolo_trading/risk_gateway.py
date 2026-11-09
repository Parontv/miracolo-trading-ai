"""Persistent fail-closed Risk Gateway for crypto PAPER order reservations."""
from __future__ import annotations

import re
import sqlite3
from contextlib import contextmanager
import time
from dataclasses import dataclass
from pathlib import Path

from .alpaca_paper import ALLOWED_SYMBOLS
from .safety import RiskPolicy


ORDER_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,48}$")


@dataclass(frozen=True)
class OrderIntent:
    client_order_id: str
    symbol: str
    side: str
    notional_usd: float
    reference_price: float
    stop_loss_price: float | None
    source: str = "strategy"
    ai_generated: bool = False


@dataclass(frozen=True)
class RiskSnapshot:
    open_positions: int
    open_orders: int
    daily_pnl_usd: float
    trading_mode: str = "PAPER"
    kill_switch: bool = False


class RiskGateway:
    """Atomically reserve intents and enforce limits across worker restarts."""

    def __init__(self, db_path: str, policy: RiskPolicy | None = None):
        self.db_path = db_path
        self.policy = policy or RiskPolicy()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS risk_reservations (
                    client_order_id TEXT PRIMARY KEY,
                    symbol TEXT NOT NULL,
                    side TEXT NOT NULL,
                    notional_usd REAL NOT NULL,
                    created_at REAL NOT NULL,
                    status TEXT NOT NULL
                )
            """)
            db.execute("CREATE INDEX IF NOT EXISTS idx_risk_reservations_created ON risk_reservations(created_at)")

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.db_path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    def reserve(self, intent: OrderIntent, snapshot: RiskSnapshot,
                now: float | None = None) -> tuple[bool, str]:
        now = time.time() if now is None else now
        policy = self.policy
        if not ORDER_ID_RE.fullmatch(intent.client_order_id):
            return False, "Invalid idempotency key."
        if snapshot.kill_switch:
            return False, "Kill switch is active."
        if snapshot.trading_mode != "PAPER" or policy.trading_mode != "PAPER":
            return False, "Only PAPER mode is enabled."
        if policy.live_trading_allowed:
            return False, "LIVE mode must remain disabled."
        if intent.symbol not in ALLOWED_SYMBOLS:
            return False, "Asset is not allowlisted."
        if intent.side not in {"BUY", "SELL"}:
            return False, "Unsupported order side."
        if intent.notional_usd <= 0 or intent.notional_usd > policy.max_order_notional_usd:
            return False, "Order notional is outside the allowed range."
        if intent.ai_generated and not policy.ai_agents_can_place_orders:
            return False, "AI-generated intents cannot submit orders directly."
        if intent.side == "BUY":
            if snapshot.open_positions >= policy.max_open_positions:
                return False, "Maximum open positions reached."
            if policy.require_stop_loss:
                if (intent.stop_loss_price is None or intent.reference_price <= 0
                        or intent.stop_loss_price <= 0
                        or intent.stop_loss_price >= intent.reference_price):
                    return False, "A valid protective stop price below the entry reference is required."
        if snapshot.daily_pnl_usd <= -abs(policy.max_daily_loss_usd):
            return False, "Daily loss limit reached."

        with self._connect() as db:
            try:
                db.execute("BEGIN IMMEDIATE")
                duplicate = db.execute(
                    "SELECT status FROM risk_reservations WHERE client_order_id=?",
                    (intent.client_order_id,),
                ).fetchone()
                if duplicate:
                    db.rollback()
                    return False, "Duplicate order intent."
                recent = db.execute(
                    "SELECT COUNT(*) AS n FROM risk_reservations WHERE created_at>=?",
                    (now - 60,),
                ).fetchone()["n"]
                if recent >= policy.max_orders_per_minute:
                    db.rollback()
                    return False, "Order rate limit reached."
                db.execute("""
                    INSERT INTO risk_reservations
                    (client_order_id,symbol,side,notional_usd,created_at,status)
                    VALUES(?,?,?,?,?,'RESERVED')
                """, (intent.client_order_id, intent.symbol, intent.side,
                      intent.notional_usd, now))
                db.commit()
                return True, "Reserved for PAPER routing only."
            except sqlite3.IntegrityError:
                db.rollback()
                return False, "Duplicate order intent."

    def mark_submitted(self, client_order_id: str):
        with self._connect() as db:
            cur = db.execute(
                "UPDATE risk_reservations SET status='SUBMITTED' WHERE client_order_id=? AND status='RESERVED'",
                (client_order_id,),
            )
            return cur.rowcount == 1
