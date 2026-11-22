-- Track broker emergency-exit orders independently from normal exits.
ALTER TABLE order_journal ADD COLUMN emergency_exit_order_id TEXT;
