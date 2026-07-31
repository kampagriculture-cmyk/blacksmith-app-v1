-- ============================================================
-- 006_production_log_deletions.sql
-- Hard-delete support for production_logs, with a snapshot kept for recovery.
--
-- Deliberately NOT a FK to production_logs(id) — the row this references will
-- no longer exist after the delete, and a FK with ON DELETE CASCADE (the pattern
-- production_log_history uses) would destroy the very snapshot inserted moments
-- earlier in the same transaction. production_log_id here is just a plain integer
-- for lookup/audit purposes, not a live reference.
--
-- snapshot includes the full production_logs row PLUS its cascade-deleted
-- children (defect_entries, stone_changes, tune_rounds) and any prior
-- production_log_history rows for it — everything that would otherwise be lost
-- when the row and its children are removed.
-- ============================================================

CREATE TABLE production_log_deletions (
  id                 SERIAL PRIMARY KEY,
  production_log_id  INTEGER NOT NULL,
  snapshot           JSONB NOT NULL,
  deleted_by         VARCHAR(100) NOT NULL,
  delete_reason      TEXT,
  deleted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deletions_log_id ON production_log_deletions(production_log_id);
CREATE INDEX idx_deletions_deleted_at ON production_log_deletions(deleted_at);
