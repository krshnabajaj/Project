-- Business rules 9-11: history must never be overwritten.
-- daily_updates and audit_logs are append-only at the database level, so no
-- application bug (or direct SQL by a normal app role) can rewrite history.
CREATE OR REPLACE FUNCTION reject_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER daily_updates_append_only
  BEFORE UPDATE OR DELETE ON daily_updates
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();

-- Progress must stay within 0..100
ALTER TABLE orders ADD CONSTRAINT orders_progress_range CHECK (progress_percentage BETWEEN 0 AND 100);
ALTER TABLE daily_updates ADD CONSTRAINT daily_updates_progress_range CHECK (progress BETWEEN 0 AND 100);

-- Fast case-insensitive global search
CREATE INDEX orders_po_number_lower_idx ON orders (lower(po_number));
CREATE INDEX customers_name_lower_idx ON customers (lower(name));
