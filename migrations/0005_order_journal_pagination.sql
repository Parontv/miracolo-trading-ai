-- Stable keyset pagination for the read-only broker reconciliation journal scan.
CREATE INDEX IF NOT EXISTS idx_order_journal_created_client
  ON order_journal(created_at DESC, client_order_id DESC);
