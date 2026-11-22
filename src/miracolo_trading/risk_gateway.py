"""Persistent fail-closed Risk Gateway for crypto PAPER order reservations."""
from __future__ import annotations

import re
import math
import sqlite3
from contextlib import contextmanager
import time
from dataclasses import dataclass
from pathlib import Path

from .alpaca_paper import ALLOWED_SYMBOLS
from .safety import RiskPolicy


ORDER_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,48}$")


def _finite_number(value):
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


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
    quantity: float | None = None
    reduce_only: bool = False


@dataclass(frozen=True)
class RiskSnapshot:
    open_positions: int
    open_orders: int
    daily_pnl_usd: float
    trading_mode: str = "PAPER"
    kill_switch: bool = False
    open_position_symbols: tuple[str, ...] = ()
    held_quantity: float | None = None
    held_symbol: str | None = None


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
        if not isinstance(intent.client_order_id, str) or not ORDER_ID_RE.fullmatch(intent.client_order_id):
            return False, "Invalid idempotency key."
        if not isinstance(snapshot.kill_switch, bool) and not (
            intent.side == "SELL" and intent.reduce_only is True
        ):
            return False, "Kill switch state is unknown."
        if not isinstance(snapshot.open_position_symbols, (tuple, list, set)):
            return False, "Open position symbols are invalid."
        now_number = _finite_number(now)
        if now_number is None:
            return False, "Reservation timestamp is invalid."
        now = now_number
        if snapshot.kill_switch and not (intent.side == "SELL" and intent.reduce_only):
            return False, "Kill switch is active."
        if snapshot.trading_mode != "PAPER" or policy.trading_mode != "PAPER":
            return False, "Only PAPER mode is enabled."
        if policy.live_trading_allowed:
            return False, "LIVE mode must remain disabled."
        if intent.symbol not in ALLOWED_SYMBOLS:
            return False, "Asset is not allowlisted."
        if intent.side not in {"BUY", "SELL"}:
            return False, "Unsupported order side."
        if intent.side == "BUY" and (
            not isinstance(snapshot.open_positions, int) or
            isinstance(snapshot.open_positions, bool) or snapshot.open_positions < 0
        ):
            return False, "Open position count is invalid."
        notional = _finite_number(intent.notional_usd)
        if notional is None or notional <= 0 or notional > policy.max_order_notional_usd:
            return False, "Order notional is outside the allowed range."
        daily_pnl = _finite_number(snapshot.daily_pnl_usd) if intent.side == "BUY" else None
        if intent.side == "BUY" and daily_pnl is None:
            return False, "Daily P&L snapshot is invalid."
        if intent.ai_generated and not policy.ai_agents_can_place_orders:
            return False, "AI-generated intents cannot submit orders directly."
        if intent.side == "BUY":
            if policy.require_stop_loss:
                reference_price = _finite_number(intent.reference_price)
                stop_loss_price = _finite_number(intent.stop_loss_price)
                if (reference_price is None or stop_loss_price is None
                        or reference_price <= 0 or stop_loss_price <= 0
                        or stop_loss_price >= reference_price):
                    return False, "A valid protective stop price below the entry reference is required."
        if intent.side == "BUY" and daily_pnl <= -abs(policy.max_daily_loss_usd):
            return False, "Daily loss limit reached."
        if intent.side == "SELL":
            if intent.reduce_only is not True:
                return False, "Sell orders must be reduce-only."
            if intent.symbol not in snapshot.open_position_symbols or snapshot.held_symbol != intent.symbol:
                return False, "Sell position symbol is not confirmed."
            sell_quantity = _finite_number(intent.quantity)
            held_quantity = _finite_number(snapshot.held_quantity)
            if (sell_quantity is None or sell_quantity <= 0
                    or held_quantity is None or held_quantity <= 0):
                return False, "A valid held position quantity is required for reduce-only sells."
            if sell_quantity > held_quantity:
                return False, "Sell quantity exceeds the held position."
            reference_price = _finite_number(intent.reference_price)
            if reference_price is None or reference_price <= 0:
                return False, "A valid reference price is required for reduce-only sells."
            calculated_notional = sell_quantity * reference_price
            if (not math.isclose(notional, calculated_notional, rel_tol=1e-6, abs_tol=1e-6)
                    or calculated_notional > policy.max_order_notional_usd):
                return False, "Sell notional does not match the bounded position quantity."

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
                pending = db.execute(
                    "SELECT DISTINCT symbol FROM risk_reservations "
                    "WHERE side='BUY' AND status IN ('RESERVED','SUBMITTED')"
                ).fetchall()
                held_symbols = set(snapshot.open_position_symbols)
                pending_new_symbols = {row["symbol"] for row in pending
                                       if row["symbol"] not in held_symbols}
                if intent.side == "BUY" and intent.symbol not in held_symbols:
                    projected_positions = snapshot.open_positions + len(pending_new_symbols | {intent.symbol})
                    if projected_positions > policy.max_open_positions:
                        db.rollback()
                        return False, "Maximum open positions reached."
                recent = db.execute(
                    "SELECT COUNT(*) AS n FROM risk_reservations "
                    "WHERE created_at>=? AND side='BUY' AND status IN ('RESERVED','SUBMITTED')",
                    (now - 60,),
                ).fetchone()["n"]
                if intent.side == "BUY" and recent >= policy.max_orders_per_minute:
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
