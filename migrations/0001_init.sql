CREATE TABLE IF NOT EXISTS worker_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL,
  message TEXT,
  last_heartbeat TEXT,
  last_cycle TEXT
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_key TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  bar_time TEXT NOT NULL,
  price REAL NOT NULL,
  fast_ema REAL NOT NULL,
  slow_ema REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at DESC);
