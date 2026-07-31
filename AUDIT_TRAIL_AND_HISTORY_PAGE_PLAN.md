# Feature: ประวัติบันทึกการผลิต + Audit Trail

> **สำหรับ Claude Code**: อ่าน `CLAUDE.md`, `HANDOFF.md`, `DESIGN.md`, `CONCURRENCY.md` ก่อนเริ่มงาน
>
> **สำคัญ**: อย่ารัน SQL ที่เขียนลง DB เอง — เตรียม SQL ให้ repo owner รันเอง
> (ยกเว้น SELECT / dry-run) ตามกฎที่บันทึกไว้ใน HANDOFF.md

---

## สรุปฟีเจอร์

เพิ่มหน้า **`/records`** ("ประวัติบันทึกการผลิต") ที่แสดง production log ทีละ lot
เป็นตารางยาว มี filter ได้ แต่ละ row กดเข้าไปแก้ไขข้อมูลที่บันทึกผิดได้ผ่าน modal
ทุกการแก้ไขถูกบันทึกเป็น audit trail (snapshot ค่าเดิม + เหตุผล + คนแก้)

**หน้านี้ไม่ใช่หน้า "บันทึก" — การบันทึกปกติเกิดตอน checkout อัตโนมัติอยู่แล้ว
หน้านี้มีไว้ "ดูย้อนหลัง + แก้ไขข้อมูลที่ผิด" เท่านั้น**

---

## Part A: Backend — Schema + Endpoints

### A1. Schema changes (เตรียม SQL ให้ repo owner รัน)

**เพิ่มคอลัมน์ `version` ใน `production_logs`:**

```sql
ALTER TABLE production_logs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
```

**สร้างตาราง `production_log_history`:**

```sql
CREATE TABLE production_log_history (
  id                SERIAL PRIMARY KEY,
  production_log_id INTEGER NOT NULL
    REFERENCES production_logs(id) ON DELETE CASCADE,
  snapshot          JSONB NOT NULL,
  version           INTEGER NOT NULL,
  edited_by         VARCHAR(100) NOT NULL,
  edit_reason       TEXT,
  edited_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_history_log_id ON production_log_history(production_log_id);
CREATE INDEX idx_history_edited_at ON production_log_history(edited_at);
```

**หลังรัน SQL แล้ว:**

```bash
cd backend
npx prisma db pull      # ดึง schema ใหม่เข้า schema.prisma
npx prisma generate     # regenerate client ใน backend/generated/prisma
```

**อัพเดต `database/001_init_schema.sql`** ให้ตรงกับ schema จริง:
- เพิ่ม `version INTEGER NOT NULL DEFAULT 1` ใน `production_logs` definition
- เพิ่ม `CREATE TABLE production_log_history` + indexes

### A2. GET /production-logs/records — ดึง log แบบ lot-by-lot

Endpoint ใหม่สำหรับหน้า `/records` — **แยกจาก** endpoint เดิมที่ dashboard ใช้

```
GET /production-logs/records?page=1&limit=20&machine_id=1&date_from=2026-07-01&date_to=2026-07-31&operator_id=3
```

Response shape:

```json
{
  "data": [
    {
      "id": 42,
      "lot_no": "L2607-001",
      "machine": { "id": 1, "code": "SG-01" },
      "operator": { "id": 3, "name": "สุชาดา" },
      "supervisor": { "id": 5, "name": "..." },
      "knife": { "id": 2, "code": "831" },
      "total_qty": 200,
      "good_qty": 185,
      "defect_qty": 15,
      "status": "completed",
      "started_at": "...",
      "ended_at": "...",
      "version": 1
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 347,
    "total_pages": 18
  }
}
```

**Implementation notes:**
- `good_qty` คำนวณจาก `production_logs_summary` view ที่มีอยู่แล้ว
   หรือ compute ใน query: `total_qty - COALESCE(SUM(defect_entries.qty), 0)`
- Default sort: `ended_at DESC` (ล่าสุดก่อน)
- ใช้ Prisma `skip/take` สำหรับ pagination
- Filter ทุกตัวเป็น optional — ไม่ส่งมา = ไม่ filter
- Include relations: `machines`, `employees` (ทั้ง operator + supervisor), `knives`
- **⚠️ Route ordering**: `/records` เป็น static route ต้องอยู่ **ก่อน** `:id` routes
  ใน controller — เหมือน `start`, `in-progress`, `lot-check`, `config`

### A3. PATCH /production-logs/:id — แก้ไข + audit trail

**DTO:**

```typescript
// update-production-log.dto.ts
import { IsOptional, IsInt, Min, IsString, MaxLength } from 'class-validator';

export class UpdateProductionLogDto {
  // === editable fields ===
  @IsOptional() @IsInt() @Min(0)
  total_qty?: number;

  @IsOptional() @IsInt() @Min(0)
  operator_id?: number;

  @IsOptional() @IsInt() @Min(0)
  supervisor_id?: number;

  // เพิ่ม field อื่นที่ควรแก้ได้ตาม business need

  // === audit fields (required) ===
  @IsString() @MaxLength(100)
  edited_by: string;

  @IsOptional() @IsString() @MaxLength(500)
  edit_reason?: string;
}
```

**Service method:**

```typescript
async updateLog(id: number, dto: UpdateProductionLogDto) {
  const { edited_by, edit_reason, ...updateFields } = dto;

  return this.prisma.$transaction(async (tx) => {
    // 1. Row lock — pattern เดียวกับ checkoutWorkOrder
    const rows = await tx.$queryRaw<any[]>`
      SELECT * FROM production_logs WHERE id = ${id} FOR UPDATE`;

    if (rows.length === 0) {
      throw new NotFoundException(`ไม่พบ log id ${id}`);
    }
    const existing = rows[0];

    // 2. Snapshot ค่าเดิมลง history ก่อนแก้
    await tx.production_log_history.create({
      data: {
        production_log_id: id,
        snapshot: existing,
        version: existing.version,
        edited_by,
        edit_reason: edit_reason ?? null,
      },
    });

    // 3. Update + increment version
    return tx.production_logs.update({
      where: { id },
      data: {
        ...updateFields,
        version: existing.version + 1,
      },
    });
  });
}
```

**⚠️ Concurrency**: ใช้ `FOR UPDATE` row lock ตาม pattern เดียวกับ
`checkoutWorkOrder` ใน CONCURRENCY.md — อย่าใช้ `findUniqueOrThrow` เพราะ
Prisma Client ไม่ support `FOR UPDATE`

### A4. GET /production-logs/:id/history — ดูประวัติการแก้ไข

```typescript
async getLogHistory(id: number) {
  const log = await this.prisma.production_logs.findUnique({ where: { id } });
  if (!log) throw new NotFoundException(`ไม่พบ log id ${id}`);

  const history = await this.prisma.production_log_history.findMany({
    where: { production_log_id: id },
    orderBy: { version: 'desc' },
  });

  return {
    current_version: log.version,
    total_edits: history.length,
    history,
  };
}
```

---

## Part B: Frontend — หน้า `/records` + Edit Modal

### B1. Navigation — เพิ่มปุ่มบนหน้าแรก

เพิ่มปุ่มบนหน้าแรก (`/`) ข้อความ: **"ประวัติบันทึกการผลิต"**
ภาษาอังกฤษ sub-label (ถ้ามี): "Production History Log"
Link ไปที่ `/records`

**ไม่ใช้คำว่า "บันทึก" แบบ action** — หน้านี้ไว้ "ดูย้อนหลัง + แก้ไข"
ไม่ใช่ไว้บันทึกข้อมูลใหม่ (การบันทึกปกติเกิดตอน checkout อัตโนมัติ)

### B2. หน้า `/records` — ตาราง lot-by-lot

**Layout:**

```
┌─────────────────────────────────────────────────┐
│  ← กลับ              ประวัติบันทึกการผลิต        │
│                                                  │
│  ┌─ Filter Bar ───────────────────────────────┐  │
│  │ วันที่: [from] - [to]  เครื่อง: [▾]       │  │
│  │ พนักงาน: [▾]                               │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌─ Table ────────────────────────────────────┐  │
│  │ ล็อต  │ เครื่อง │ พนง. │ มีด │ ยอด │ เสีย │  │
│  │───────┼────────┼──────┼─────┼─────┼──────│  │
│  │ L001  │ SG-01  │ สุชา │ 831 │ 200 │  15  │  │
│  │ L002  │ SG-02  │ เต้  │ 502 │ 150 │   8  │  │
│  │ ...   │        │      │     │     │      │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌─ Pagination ───────────────────────────────┐  │
│  │         ◀ หน้า 1 / 18 ▶                    │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**Design — ใช้ DESIGN.md tokens ทั้งหมด:**
- Background: `graphite-night` (#16181d)
- Table rows: `graphite-surface` (#1d1f24) card style, 0.5px `hairline` border
- Filter inputs: `graphite-night` fill + `hairline-strong` border (ตาม input spec)
- แต่ละ row กดได้ทั้ง row → เปิด Edit Modal
- Row ที่เคยแก้ไขแล้ว (version > 1) แสดง badge เล็กๆ เช่น "แก้ไขแล้ว ×2"
  ใช้สี `amber-warning-text` เพื่อดึงความสนใจ (ไม่ใช่ error แต่เป็นข้อมูลที่ควรรู้)
- Pagination ปุ่ม: `graphite-surface-2` fill, `shift-blue` เมื่อ active
- BackLink component (มีอยู่แล้ว) สำหรับ "← กลับ"
- Touch target ≥ 48px ตาม spec

**Filter dropdowns:**
- เครื่อง / พนักงาน → ดึงจาก `GET /production-logs/config` (มีอยู่แล้ว)
- วันที่ → date picker หรือ input type="date" ง่ายๆ
- Apply filter แบบ onChange ไม่ต้องกดปุ่ม "ค้นหา" แยก (debounce 300ms)

**Data fetching:**
- เรียก `GET /production-logs/records` พร้อม query params จาก filter
- Loading state: skeleton rows (ตาม pattern ที่ start/checkout ใช้อยู่)
- Error state: alert-rose status box + retry button

### B3. Edit Modal — แก้ไขข้อมูล

เมื่อกด row → เปิด modal/drawer ทับหน้า `/records`

```
┌─────────────────────────────────────────┐
│          แก้ไขข้อมูล — ล็อต L001        │
│                                         │
│  เครื่อง:    SG-01        (read-only)   │
│  มีด:       831           (read-only)   │
│  วันที่:    30/07/2026    (read-only)   │
│                                         │
│  ─── แก้ไขได้ ────────────────────────  │
│                                         │
│  จำนวนทั้งหมด:   [ 200        ]        │
│  พนักงาน:        [ ▾ สุชาดา   ]        │
│  หัวหน้างาน:     [ ▾ ...      ]        │
│                                         │
│  ─── ข้อมูล Audit ─────────────────── │
│                                         │
│  แก้ไขโดย:       [ ▾ เลือกชื่อ ]  *    │
│  เหตุผล:         [ นับยอดผิด... ]  *    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │         บันทึกการแก้ไข          │    │
│  └─────────────────────────────────┘    │
│                                         │
│  เวอร์ชันปัจจุบัน: 1                    │
│  (ยังไม่เคยแก้ไข)                       │
│                                         │
│           [ ยกเลิก ]                    │
└─────────────────────────────────────────┘
```

**Design:**
- Modal background: `graphite-surface` (#1d1f24)
- Overlay behind modal: semi-transparent black
- Read-only fields: `graphite-surface-2` fill + `ink-muted` text (ตาม input-readonly spec)
- Editable fields: `graphite-night` fill (ตาม input spec)
- "บันทึกการแก้ไข" button: `shift-blue` primary, 56px height
- ปุ่ม disabled ถ้า: ไม่ได้เปลี่ยนค่าอะไรเลย / ไม่ได้เลือก edited_by / ไม่ได้กรอก edit_reason
- "ยกเลิก" button: text-only, `ink-muted`
- Success: `confirm-green` status box "บันทึกการแก้ไขสำเร็จ" → auto-close modal + refresh table row
- Error: `alert-rose` status box ใน modal

**Field rules:**
- `edited_by` — dropdown ดึงจาก config (supervisor + qc role เท่านั้น? หรือทุก role? — ถามมึงก่อน implement, default ให้เป็นทุก role ก่อน)
- `edit_reason` — required, free text, placeholder: "ระบุเหตุผลที่แก้ไข เช่น นับยอดผิดตอน checkout"
- Fields ที่ **ห้ามแก้** (read-only ใน modal): `machine_id`, `knife_id`, `lot_no`, `started_at`, `ended_at`, `status` — ถ้าพวกนี้ผิดมันคือ record ผิดตัว ไม่ใช่ค่าผิด
- Fields ที่ **แก้ได้**: `total_qty`, `operator_id`, `supervisor_id` — เพิ่มเติมได้ทีหลัง

**Validation (client-side, mirror backend):**
- `total_qty` ≥ 0, integer เท่านั้น
- `total_qty` ≥ SUM(defect_entries.qty) ของ record นั้น — ถ้าน้อยกว่าแสดง alert-rose
  (ตาม PRODUCT.md: "defect counts can't exceed total output")

### B4. Version badge + history preview (ระดับ 2 — ทำทีหลังได้)

ยังไม่ต้อง implement full history timeline ตอนนี้
แค่แสดงใน modal:
- "เวอร์ชันปัจจุบัน: 3 (แก้ไขแล้ว 2 ครั้ง)" ถ้า version > 1
- "ยังไม่เคยแก้ไข" ถ้า version = 1

Full history view (ใครแก้ เมื่อไหร่ ค่าเดิมคืออะไร) ทำเป็น phase ถัดไป

---

## Part C: Testing

### C1. Manual test script

สร้าง `backend/test-edit.ps1`:

```powershell
# แก้ไข log (ใช้ id ที่มีจริง)
$body = @{
  total_qty = 150
  edited_by = "กัมพล"
  edit_reason = "นับยอดผิดตอน checkout"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Uri "http://localhost:3001/production-logs/5" `
  -Method Patch -ContentType "application/json" -Body $body

# ดู history
Invoke-RestMethod -Uri "http://localhost:3001/production-logs/5/history"
```

### C2. Concurrent edit test

สร้าง `backend/test-concurrent-edit.js` ตาม pattern `test-concurrent.js`:
- ยิง 5 concurrent PATCH ไปที่ log เดียวกัน
- คาดหวัง: ทุก request สำเร็จ, version สุดท้าย = 6, history มี 5 rows

---

## Part D: Documentation updates

หลัง implement เสร็จ อัพเดต:

1. **`CLAUDE.md`** — เพิ่ม:
   - `production_log_history` ใน domain model section
   - PATCH endpoint ใน architecture
   - `/records` route ใน frontend structure
   - audit trail pattern ใน concurrency section (ใช้ FOR UPDATE เหมือน checkout)

2. **`MANAGER_GUIDE.md`** — เพิ่ม section:
   - "ดูประวัติบันทึกการผลิต" (หน้า /records คืออะไร)
   - "แก้ไขข้อมูลที่บันทึกผิด" (ใช้ edit modal ยังไง)
   - ย้ำว่าทุกการแก้ไขถูกบันทึกไว้ ลบไม่ได้

3. **`HANDOFF.md`** — เพิ่มสิ่งที่ทำในเซสชันนี้

---

## สิ่งที่ยังไม่ต้องทำ

- **Undo/rollback** — ดูประวัติได้ แต่ยังไม่ต้อง revert อัตโนมัติ
- **Field-level diff UI** — ทำ phase ถัดไปเมื่อมี history data จริง
- **Audit trail สำหรับ child tables** (defect_entries, stone_changes, tune_rounds) — เริ่มจาก production_logs ก่อน
- **Soft delete** — ไม่มี DELETE endpoint อยู่แล้ว
- **Auth/login** — edited_by ยังเป็น dropdown ส่งจาก client

---

## Checklist สำหรับ repo owner

- [ ] รัน `ALTER TABLE` + `CREATE TABLE` SQL บน Neon
- [ ] `npx prisma db pull` + `npx prisma generate`
- [ ] Review PATCH endpoint + test locally
- [ ] Review GET /records endpoint + test locally
- [ ] Review หน้า /records + edit modal
- [ ] รัน concurrent edit test
- [ ] Review doc updates (CLAUDE.md, MANAGER_GUIDE.md, HANDOFF.md)
- [ ] Deploy backend ก่อน แล้ว frontend ตาม
- [ ] Commit
