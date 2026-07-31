-- ============================================================
-- 005_audit_trail_schema.sql
-- Adds snapshot-before-update audit trail for production_logs.
-- See AUDIT_TRAIL_PLAN.md for the full design + backend service logic
-- that goes with this.
--
-- Safe to run once against production Neon:
--   - ADD COLUMN ... DEFAULT 1 backfills all existing rows automatically
--   - CREATE TABLE only fails if it already exists (not idempotent —
--     don't re-run after it succeeds once)
-- ============================================================

ALTER TABLE production_logs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE production_log_history (
  id                 SERIAL PRIMARY KEY,
  production_log_id  INTEGER NOT NULL
    REFERENCES production_logs(id) ON DELETE CASCADE,
  snapshot           JSONB NOT NULL,
  version            INTEGER NOT NULL,
  edited_by          VARCHAR(100) NOT NULL,
  edit_reason        TEXT,
  edited_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_history_log_id ON production_log_history(production_log_id);
CREATE INDEX idx_history_edited_at ON production_log_history(edited_at);
