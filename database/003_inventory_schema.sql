-- ============================================================
-- 003_inventory_schema.sql
-- ระบบเบิก-รับเข้าวัสดุสิ้นเปลือง (Inventory phase)
-- แปลงมาจาก Google Apps Script (item_master / withdrawal_log /
-- receipt_log / inventory_state) — ดูของเดิมที่ Code.gs
--
-- ต่างจาก GAS ตรงนี้:
--   * ไม่มีตาราง inventory_state เก็บ balance ซ้ำ — ใช้ VIEW คำนวณสด
--     เหมือน production_logs_summary คำนวณ good_qty (ดู 001_init_schema.sql)
--     => ฟังก์ชัน recomputeAll_/reset_ ของ GAS จึงไม่จำเป็นอีกต่อไป
--   * withdrawer/receiver เก็บเป็น FK ไป employees (ไม่เก็บชื่อเป็น string)
--   * machine ปลายทางเก็บเป็น FK ไป machines — link เข้ากับระบบผลิตจริง
-- ============================================================

-- ---------- 1. ตารางวัสดุ (item master) ----------
-- ข้อมูลนิ่ง — รายการวัสดุสิ้นเปลืองที่เบิก/รับเข้าได้
-- id เป็น string เหมือน GAS (เช่น 'STONE-380') ไม่ใช่ serial

CREATE TABLE item_master (
  id VARCHAR(30) PRIMARY KEY,          -- 'STONE-380', 'COOLANT' ฯลฯ
  name VARCHAR(120) NOT NULL,
  unit VARCHAR(20) NOT NULL,           -- 'ก้อน', 'ขวด', 'แผ่น'
  reorder_point INTEGER NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  active BOOLEAN NOT NULL DEFAULT true  -- ปิดใช้งาน = ไม่โผล่ใน dropdown
);

-- ---------- 2. log การเบิก (withdrawal) ----------
-- append-only — 1 แถวต่อ 1 ครั้งที่เบิก

CREATE TABLE withdrawal_log (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  item_id VARCHAR(30) NOT NULL REFERENCES item_master(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  withdrawer_id INTEGER NOT NULL REFERENCES employees(id),
  machine_id INTEGER REFERENCES machines(id),   -- optional — เครื่องปลายทาง
  condition VARCHAR(60),                          -- สภาพวัสดุเก่าที่คืน
  reason TEXT,                                    -- เหตุผล (กรณีเปลี่ยนก่อนถึงขีด)
  remark TEXT
);

CREATE INDEX idx_withdrawal_item ON withdrawal_log (item_id);

-- ---------- 3. log การรับเข้า (receipt) ----------

CREATE TABLE receipt_log (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  item_id VARCHAR(30) NOT NULL REFERENCES item_master(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  receiver_id INTEGER NOT NULL REFERENCES employees(id),
  source VARCHAR(120),                            -- เลข PO / supplier
  remark TEXT
);

CREATE INDEX idx_receipt_item ON receipt_log (item_id);

-- ---------- 4. View คำนวณสต็อคสด ----------
-- balance = SUM(receipt) - SUM(withdrawal) — คิดสดทุกครั้งที่ query
-- ไม่เก็บซ้ำ จึง drift ไม่ได้ (เหมือน production_logs_summary)
-- last_updated = เวลา log ล่าสุด (รับหรือเบิก) ของวัสดุนั้น
-- GREATEST() ของ Postgres ข้าม NULL ให้อัตโนมัติ

CREATE VIEW inventory_state AS
SELECT
  im.id,
  im.name,
  im.unit,
  im.reorder_point,
  COALESCE(r.total_in, 0)::int                          AS total_in,
  COALESCE(w.total_out, 0)::int                         AS total_out,
  (COALESCE(r.total_in, 0) - COALESCE(w.total_out, 0))::int AS balance,
  GREATEST(r.last_in, w.last_out)                       AS last_updated
FROM item_master im
LEFT JOIN (
  SELECT item_id, SUM(qty) AS total_in, MAX(created_at) AS last_in
  FROM receipt_log GROUP BY item_id
) r ON r.item_id = im.id
LEFT JOIN (
  SELECT item_id, SUM(qty) AS total_out, MAX(created_at) AS last_out
  FROM withdrawal_log GROUP BY item_id
) w ON w.item_id = im.id
WHERE im.active = true;

-- ---------- 5. seed placeholder ----------
-- ★ ค่าตัวอย่าง — แทนที่ด้วย item_master จริงจากชีตเดิมได้เลย
-- reorder_point ใช้คำนวณ status: <=rp = สั่งซื้อด่วน, <=rp*1.5 = ใกล้หมด

INSERT INTO item_master (id, name, unit, reorder_point, active) VALUES
  ('STONE-380',  'หินลับขนาด 380',       'ก้อน', 10, true),
  ('STONE-400',  'หินลับขนาด 400',       'ก้อน', 10, true),
  ('COOLANT',    'น้ำยาหล่อเย็น',         'ขวด',  5,  true),
  ('SANDPAPER',  'กระดาษทรายละเอียด',     'แผ่น', 20, true);
