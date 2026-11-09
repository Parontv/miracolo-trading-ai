CREATE TABLE IF NOT EXISTS scan_cursors (
  symbol TEXT PRIMARY KEY,
  last_bar_time TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
