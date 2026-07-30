-- ============================================================
-- 004_reset_reference_data.sql
-- Full wipe + reseed, used before re-running migrate-gsheet-history.ts
-- from a clean slate.
--
-- WHY RESTART IDENTITY matters: frontend/lib/employees.ts and the
-- MACHINES/KNIVES consts in frontend/app/start/page.tsx hardcode specific
-- ids (see MANAGER_GUIDE.md — "Reference data has no admin API"). Re-seeding
-- employees/machines/knives in this exact order after a RESTART IDENTITY
-- wipe reproduces the original ids (employees 1-5, machines 1-2, knives
-- 1-3) so those hardcoded frontend arrays stay valid. If you insert them in
-- a different order, or skip RESTART IDENTITY, the ids will drift and the
-- frontend dropdowns will silently attribute work orders to the wrong
-- person/machine.
--
-- Deliberately NOT reseeded here:
--   - production_logs / defect_entries / stone_changes / tune_rounds sample
--     rows from 002_seed_data.sql — those were practice/example data, not
--     meant to coexist with the real migrated history.
--   - item_master placeholder rows from 003_inventory_schema.sql (STONE-380
--     etc.) — that file's own comment says to replace them with the real
--     items from the sheet; migrate-gsheet-history.ts creates the real ones
--     (SGW, VB) directly.
-- ============================================================

TRUNCATE TABLE
  defect_entries, stone_changes, tune_rounds, machine_owners,
  withdrawal_log, receipt_log,
  production_logs, item_master,
  employees, machines, knives, defect_types
RESTART IDENTITY CASCADE;

-- ---------- defect_types (from 001_init_schema.sql) ----------
INSERT INTO defect_types (code, name_th, display_order) VALUES
  ('H01', 'ลับบาง-หนา (R)', 1),
  ('H02', 'ลับบาง-บาง (R)', 2),
  ('H03', 'ลับบาง-บาง', 3),
  ('H04', 'ลับบางเล็ก', 4),
  ('H05', 'ลับบาง-ใหญ่', 5),
  ('H06', 'ลับบางซ้อน', 6),
  ('H07', 'ลับบาง 2 ข้างไม่เท่ากัน', 7),
  ('H08', 'ลับบางเป็นคลื่น', 8),
  ('H09', 'ลับบางลาย', 9),
  ('H10', 'ลับบางไหม้', 10),
  ('H11', 'ใบมีดงอ', 11),
  ('H12', 'ลองหิน', 12),
  ('H13', 'ลับบางเอียง', 13),
  ('H14', 'ลับบางหยาบ', 14),
  ('H15', 'อื่นๆ', 15);

-- ---------- machines (from 002_seed_data.sql) — must land as id 1, 2 ----------
INSERT INTO machines (code) VALUES
  ('SG-01'),
  ('SG-02');

-- ---------- knives (from 002_seed_data.sql) — must land as id 1, 2, 3 ----------
-- migrate-gsheet-history.ts will create the other codes it finds in the CSV
-- (476, 477, 479, 147) automatically on top of these.
INSERT INTO knives (code) VALUES
  ('474'),
  ('475'),
  ('476'),
  ('477'),
  ('478'),
  ('479'),
  ('830'),
  ('146');
  ('147');
-- ---------- employees (from 002_seed_data.sql) — must land as id 1-5 ----------
-- migrate-gsheet-history.ts will create the rest (ปรียะดา, ภาวิณี, ปิยะดา,
-- ป้อม, เดือน, เพชร, ดรีม, แอดมิน A) automatically on top of these.
INSERT INTO employees (name, role) VALUES
  ('สุชาดา', 'operator'),
  ('เต้', 'operator'),
  ('ภาวิณี', 'operator'),
  ('ศักดิ์สิทธิ์', 'supervisor'),
  ('ภาณุวัชร', 'supervisor');

-- ---------- machine_owners (from 002_seed_data.sql) ----------
INSERT INTO machine_owners (machine_id, operator_id) VALUES
  (1, 2),  -- SG-01 -> เต้
  (2, 3);  -- SG-02 -> ภาวิณี
