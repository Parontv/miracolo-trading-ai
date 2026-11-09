CREATE TABLE IF NOT EXISTS risk_reservations (
  client_order_id TEXT PRIMARY KEY,
  signal_key TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  notional_usd REAL NOT NULL CHECK (notional_usd > 0),
  status TEXT NOT NULL CHECK (status IN ('RESERVED', 'SUBMITTED', 'RELEASED', 'REJECTED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_risk_reservations_status_created
  ON risk_reservations(status, created_at);

CREATE TABLE IF NOT EXISTS order_journal (
  client_order_id TEXT PRIMARY KEY,
  signal_key TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  state TEXT NOT NULL CHECK (state IN (
    'NEW',
    'RISK_RESERVED',
    'ENTRY_SUBMITTED',
    'ENTRY_PARTIALLY_FILLED',
    'ENTRY_FILLED',
    'PROTECTION_SUBMITTED',
    'PROTECTED',
    'EXIT_SUBMITTED',
    'EMERGENCY_EXIT_REQUIRED',
    'EMERGENCY_EXIT_SUBMITTED',
    'CLOSED',
    'REJECTED',
    'CANCELLED',
    'FAILED'
  )),
  entry_order_id TEXT,
  entry_status TEXT,
  filled_qty REAL NOT NULL DEFAULT 0 CHECK (filled_qty >= 0),
  avg_fill_price REAL,
  stop_order_id TEXT,
  stop_status TEXT,
  stop_qty REAL NOT NULL DEFAULT 0 CHECK (stop_qty >= 0),
  stop_price REAL,
  stop_limit_price REAL,
  exit_order_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_journal_state_updated
  ON order_journal(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_order_journal_symbol_created
  ON order_journal(symbol, created_at);
