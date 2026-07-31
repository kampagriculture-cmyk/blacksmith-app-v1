-- ============================================================
-- 001_init_schema.sql
-- Schema เริ่มต้นสำหรับ Production Logging System
-- แปลงมาจาก Google Sheet "Database" (39 คอลัมน์) + "MachineOwners"
-- ============================================================

-- ---------- 1. ตารางอ้างอิง (Reference tables) ----------
-- ข้อมูลนิ่ง ไม่ค่อยเปลี่ยน ตารางพวกนี้สร้างก่อนเสมอ
-- เพราะตารางอื่นจะ REFERENCES (ชี้ไปหา) ตารางเหล่านี้

CREATE TABLE machines (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL   -- 'SG-01', 'SG-02'
);

CREATE TABLE knives (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL   -- '474', '830' ฯลฯ
);

CREATE TABLE employees (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('operator', 'supervisor', 'qc')),
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE defect_types (
  code VARCHAR(10) PRIMARY KEY,      -- 'H01'...'H15' ใช้เป็น PK ตรงๆ
  name_th VARCHAR(100) NOT NULL,
  display_order SMALLINT NOT NULL
);

CREATE TABLE machine_owners (
  machine_id INTEGER PRIMARY KEY REFERENCES machines(id),
  operator_id INTEGER NOT NULL REFERENCES employees(id)
);

-- ---------- 2. ตารางหลัก (Core table) ----------

CREATE TABLE production_logs (
  id SERIAL PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  knife_id INTEGER NOT NULL REFERENCES knives(id),
  lot_no VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('in_progress', 'completed')),
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  total_qty INTEGER CHECK (total_qty >= 0),
  operator_id INTEGER NOT NULL REFERENCES employees(id),
  supervisor_id INTEGER REFERENCES employees(id),
  qc_approved BOOLEAN,
  remark TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);

-- Only one open ("in_progress") work order allowed per machine at a time.
-- Enforced at the DB level because the app's start-workOrder flow relies on
-- this constraint, not just the advisory lock, to prevent double-booking.
CREATE UNIQUE INDEX one_in_progress_per_machine ON production_logs (machine_id)
  WHERE status = 'in_progress';

-- ---------- 3. ตารางลูก (Sub-event tables) ----------
-- ผูกกับ production_logs ผ่าน FK
-- ON DELETE CASCADE = ลบ log แม่แล้ว ลูกที่ผูกอยู่ถูกลบตามอัตโนมัติ

CREATE TABLE stone_changes (
  id SERIAL PRIMARY KEY,
  production_log_id INTEGER NOT NULL UNIQUE
    REFERENCES production_logs(id) ON DELETE CASCADE,
  qty_before_change INTEGER NOT NULL,
  size_left VARCHAR(20),
  size_right VARCHAR(20),
  downtime_start TIME,
  downtime_end TIME
);

CREATE TABLE tune_rounds (
  id SERIAL PRIMARY KEY,
  production_log_id INTEGER NOT NULL
    REFERENCES production_logs(id) ON DELETE CASCADE,
  round_no SMALLINT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  UNIQUE(production_log_id, round_no)
);

CREATE TABLE defect_entries (
  id SERIAL PRIMARY KEY,
  production_log_id INTEGER NOT NULL
    REFERENCES production_logs(id) ON DELETE CASCADE,
  defect_type_code VARCHAR(10) NOT NULL REFERENCES defect_types(code),
  qty INTEGER NOT NULL CHECK (qty > 0),
  UNIQUE(production_log_id, defect_type_code)
);

-- ---------- 3b. Audit trail (snapshot-before-update) ----------
-- ก่อน UPDATE ค่าใหม่ลง production_logs ต้องบันทึก snapshot ของ row เดิมทั้งก้อน
-- ลงตารางนี้ก่อนเสมอ (ทั้งสอง operation อยู่ใน transaction เดียวกัน) — ดู
-- AUDIT_TRAIL_PLAN.md สำหรับรายละเอียด service-layer logic

CREATE TABLE production_log_history (
  id                 SERIAL PRIMARY KEY,
  production_log_id  INTEGER NOT NULL
    REFERENCES production_logs(id) ON DELETE CASCADE,
  snapshot           JSONB NOT NULL,          -- ค่าทั้ง row ก่อนถูกแก้
  version            INTEGER NOT NULL,        -- version ณ ตอนที่ snapshot นี้เป็นตัวแทน
  edited_by          VARCHAR(100) NOT NULL,   -- ชื่อคนแก้ (ยังไม่มี auth → ส่งมาจาก client)
  edit_reason        TEXT,
  edited_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_history_log_id ON production_log_history(production_log_id);
CREATE INDEX idx_history_edited_at ON production_log_history(edited_at);

-- ---------- 3c. Hard-delete support (snapshot-before-delete) ----------
-- ไม่ FK ไปหา production_logs (row จะไม่มีอยู่แล้วหลังลบ) — ต่างจาก
-- production_log_history ที่ FK ON DELETE CASCADE ได้ เพราะที่นี่การลบ "คือ"
-- เหตุการณ์ที่กำลังบันทึก ถ้า FK cascade มันจะลบ snapshot ที่เพิ่ง insert ไปเอง
-- snapshot เก็บทั้ง row หลัก + child records (defect_entries, stone_changes,
-- tune_rounds) + ประวัติแก้ไขเดิม (ถ้ามี) เพราะทั้งหมดจะหายไปตอนลบจริง

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

-- ---------- 4. View ช่วยคำนวณ good_qty ----------
-- ไม่เก็บ good_qty ซ้ำใน production_logs
-- คำนวณสดจาก total_qty - SUM(defect_entries.qty) ทุกครั้งที่ query

CREATE VIEW production_logs_summary AS
SELECT
  pl.*,
  pl.total_qty - COALESCE(SUM(de.qty), 0) AS good_qty
FROM production_logs pl
LEFT JOIN defect_entries de ON de.production_log_id = pl.id
GROUP BY pl.id;

-- ---------- 5. ข้อมูลอ้างอิงเริ่มต้น (seed data) ----------
-- defect_types ต้องมีข้อมูลตั้งต้น เพราะเป็น "รายการคงที่" ของระบบ

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