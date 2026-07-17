-- ============================================================
-- 002_seed_data.sql
-- ข้อมูลตัวอย่าง ใช้ฝึก SELECT / JOIN / WHERE / aggregate
-- ============================================================

-- ---------- machines ----------
INSERT INTO machines (code) VALUES
  ('SG-01'),
  ('SG-02');

-- ---------- knives ----------
INSERT INTO knives (code) VALUES
  ('474'),
  ('830'),
  ('146');

-- ---------- employees ----------
-- role ต้องเป็นค่าที่ CHECK constraint ยอมรับเท่านั้น: operator / supervisor / qc
INSERT INTO employees (name, role) VALUES
  ('สุชาดา', 'operator'),
  ('เต้', 'operator'),
  ('รัตนา', 'operator'),
  ('ศักดิ์สิทธิ์', 'supervisor'),
  ('ภาณุวัชร', 'supervisor');

-- ---------- machine_owners ----------
-- สมมติ: SG-01 ปกติเต้เป็นคนรัน, SG-02 ปกติรัตนาเป็นคนรัน
-- ใช้ id ที่เพิ่งสร้างจาก SERIAL (เต้=2, รัตนา=3 ตามลำดับ insert ด้านบน)
INSERT INTO machine_owners (machine_id, operator_id) VALUES
  (1, 2),  -- SG-01 -> เต้
  (2, 3);  -- SG-02 -> รัตนา

-- ---------- production_logs ----------
-- 5 แถวตัวอย่าง คละเครื่อง/คน/วัน เพื่อให้เห็นความหลากหลายตอน query
INSERT INTO production_logs
  (machine_id, knife_id, lot_no, ended_at, total_qty, operator_id, supervisor_id, qc_approved, remark)
VALUES
  (1, 1, 'LOT-2026-001', '2026-07-01 14:30:00', 5000, 2, 4, true,  NULL),
  (1, 1, 'LOT-2026-002', '2026-07-02 15:10:00', 4800, 3, 4, true,  'เต้ลาป่วย รัตนามาแทน'),  -- คนสลับ! เต้ปกติรัน SG-01
  (2, 2, 'LOT-2026-003', '2026-07-01 13:45:00', 6200, 3, 5, true,  NULL),
  (2, 3, 'LOT-2026-004', '2026-07-03 16:00:00', 3900, 3, 5, false, 'รอ QC ตรวจซ้ำ'),
  (1, 2, 'LOT-2026-005', '2026-07-04 12:20:00', 5300, 2, 4, true,  NULL);

-- ---------- defect_entries ----------
-- log 1: H01=20, H03=15 | log 2: H01=80 (เยอะผิดปกติ เพราะสลับคน) | log 3: H05=10 | log 5: ไม่มีของเสียเลย
INSERT INTO defect_entries (production_log_id, defect_type_code, qty) VALUES
  (1, 'H01', 20),
  (1, 'H03', 15),
  (2, 'H01', 80),
  (2, 'H03', 10),
  (3, 'H05', 10),
  (4, 'H01', 5),
  (4, 'H09', 12);
  -- log 5 ตั้งใจไม่ใส่ defect เลย = ของดีทั้งหมด

-- ---------- stone_changes ----------
-- เฉพาะ log ที่มีเปลี่ยนหินจริง (log 1 กับ log 4)
INSERT INTO stone_changes
  (production_log_id, qty_before_change, size_left, size_right, downtime_start, downtime_end)
VALUES
  (1, 4700, '380', '380', '13:00', '13:15'),
  (4, 3800, '375', '378', '15:00', '15:20');

-- ---------- tune_rounds ----------
-- log 2 จูน 2 รอบ, log 3 จูน 1 รอบ, ที่เหลือไม่จูนเลย
INSERT INTO tune_rounds (production_log_id, round_no, start_time, end_time) VALUES
  (2, 1, '09:00', '09:15'),
  (2, 2, '13:00', '13:20'),
  (3, 1, '10:30', '10:40');