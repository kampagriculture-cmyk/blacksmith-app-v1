# Audit Trail Implementation Plan — Blacksmith Production System

> **สำหรับ Claude Code**: อ่าน `CLAUDE.md`, `HANDOFF.md`, และ `CONCURRENCY.md` ก่อนเริ่มงาน
> เพื่อเข้าใจ schema ปัจจุบัน, concurrency patterns, และข้อตกลงเรื่อง DB-writing commands
>
> **สำคัญ**: อย่ารัน SQL ที่เขียนลง DB เอง — เตรียม SQL ให้ repo owner รันเอง
> (ยกเว้น SELECT / dry-run) ตามกฎที่บันทึกไว้ใน HANDOFF.md

---

## เป้าหมาย

เพิ่มระบบ audit trail สำหรับ `production_logs` เพื่อให้ตอบคำถามได้ว่า:
- ใครแก้ record นี้
- แก้เมื่อไหร่
- ค่าเดิมก่อนแก้คืออะไร (snapshot ทั้ง row)
- แก้เพราะอะไร (edit reason)
- แก้ไปกี่ครั้งแล้ว (version number)

ใช้ pattern: **snapshot-before-update** — ก่อน UPDATE ค่าใหม่ลง `production_logs`
ให้บันทึก snapshot ของ row เดิมทั้งก้อนลงตาราง `production_log_history` ก่อนเสมอ
ทั้งสอง operation ต้องอยู่ใน transaction เดียวกัน (all-or-nothing)

---

## Phase 1: Schema — ตาราง + คอลัมน์ใหม่

### 1a. เพิ่มคอลัมน์ `version` ใน `production_logs`

```sql
ALTER TABLE production_logs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
```

- row ที่มีอยู่แล้ว (691+ rows ข้อมูลจริง) จะได้ version = 1 อัตโนมัติจาก DEFAULT
- ทุกครั้งที่ UPDATE สำเร็จ ให้ increment version ใน application layer

### 1b. สร้างตาราง `production_log_history`

```sql
CREATE TABLE production_log_history (
  id              SERIAL PRIMARY KEY,
  production_log_id INTEGER NOT NULL
    REFERENCES production_logs(id) ON DELETE CASCADE,
  snapshot        JSONB NOT NULL,          -- ค่าทั้ง row ก่อนถูกแก้
  version         INTEGER NOT NULL,        -- version ณ ตอนที่ snapshot นี้เป็นตัวแทน
  edited_by       VARCHAR(100) NOT NULL,   -- ชื่อคนแก้ (ยังไม่มี auth → ส่งมาจาก client)
  edit_reason     TEXT,                    -- เหตุผล (optional ตอนแรก, บังคับทีหลังได้)
  edited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_history_log_id ON production_log_history(production_log_id);
CREATE INDEX idx_history_edited_at ON production_log_history(edited_at);
```

**ทำไมใช้ `JSONB` แทน mirror ทุกคอลัมน์:**
- เมื่อ schema หลักเปลี่ยน (เพิ่ม field) ไม่ต้อง migrate ตาราง history ตาม
- Postgres `JSONB` query ได้ปกติ (`snapshot->>'total_qty'` etc.)
- แลกกับ: ไม่มี type safety ระดับ DB สำหรับค่าใน snapshot

**ทำไมใช้ `ON DELETE CASCADE`:**
- ถ้า production_log ถูกลบ (ซึ่งปัจจุบันไม่มี endpoint ลบ) history ก็ไม่มีความหมาย
- สอดคล้องกับ pattern เดิมของ child tables (`stone_changes`, `tune_rounds`, `defect_entries`)

### 1c. อัพเดตไฟล์ที่เกี่ยวข้อง

1. **`database/001_init_schema.sql`** — เพิ่ม `version` column ใน `production_logs` definition
   และเพิ่ม `CREATE TABLE production_log_history` block ทั้งก้อน
2. **`backend/prisma/schema.prisma`** — รัน `npx prisma db pull` หลัง repo owner รัน SQL แล้ว
   จากนั้น `npx prisma generate` เพื่อ regenerate client ใน `backend/generated/prisma`
3. **ตรวจสอบ** ว่า Prisma introspect ได้ relation ที่ถูกต้อง:
   `ProductionLog` ควรมี `production_log_history ProductionLogHistory[]`
   และ `ProductionLogHistory` ควรมี FK กลับ

---

## Phase 2: Backend — PATCH endpoint + history logic

### 2a. DTO สำหรับ edit

สร้าง `UpdateProductionLogDto` (ถ้ายังไม่มี) ใน `backend/src/production-logs/dto/`:

```typescript
// update-production-log.dto.ts
import { IsOptional, IsInt, Min, IsString, MaxLength } from 'class-validator';

export class UpdateProductionLogDto {
  @IsOptional() @IsInt() @Min(0)
  total_qty?: number;

  @IsOptional() @IsInt() @Min(0)
  supervisor_id?: number;

  @IsOptional() @IsInt() @Min(0)
  operator_id?: number;

  // เพิ่ม field อื่นที่ควรแก้ได้ตาม business need

  // === audit fields ===
  @IsString() @MaxLength(100)
  edited_by: string;          // required — ต้องรู้ว่าใครแก้

  @IsOptional() @IsString() @MaxLength(500)
  edit_reason?: string;
}
```

**หมายเหตุ**: `edited_by` ตอนนี้เป็น string ที่ client ส่งมา เพราะระบบยังไม่มี auth
ในอนาคตถ้ามี auth ให้ดึงจาก token/session แทน

### 2b. Service method

เพิ่มใน `backend/src/production-logs/production-logs.service.ts`:

```typescript
async updateLog(id: number, dto: UpdateProductionLogDto) {
  const { edited_by, edit_reason, ...updateFields } = dto;

  return this.prisma.$transaction(async (tx) => {
    // 1. Row lock — ป้องกัน concurrent edit เหมือน pattern ใน checkoutWorkOrder
    const rows = await tx.$queryRaw<any[]>`
      SELECT * FROM production_logs WHERE id = ${id} FOR UPDATE`;

    if (rows.length === 0) {
      throw new NotFoundException(`ไม่พบ log id ${id}`);
    }
    const existing = rows[0];

    // 2. Snapshot ค่าเดิมทั้ง row ลง history ก่อน
    await tx.production_log_history.create({
      data: {
        production_log_id: id,
        snapshot: existing,        // row ทั้งก้อนเป็น JSONB
        version: existing.version,
        edited_by,
        edit_reason: edit_reason ?? null,
      },
    });

    // 3. Update ค่าใหม่ + increment version
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

**จุดสำคัญ:**
- ใช้ `FOR UPDATE` row lock เหมือน `checkoutWorkOrder` — ป้องกัน concurrent edit
- **อย่า** ใช้ `findUniqueOrThrow` ตรงนี้ เพราะต้องการ raw query เพื่อ `FOR UPDATE`
  (Prisma Client ไม่ support `FOR UPDATE` ใน findUnique)
- `existing` จาก raw query จะเป็น snake_case ทั้งหมด ไม่ใช่ camelCase
- snapshot เก็บ `existing` ทั้งก้อนรวม `version`, `created_at`, `updated_at`
  เพื่อให้ reconstruct ค่า ณ จุดนั้นได้ครบ

### 2c. Controller endpoints

เพิ่มใน `backend/src/production-logs/production-logs.controller.ts`:

```typescript
// แก้ไข production log (พร้อมบันทึก audit trail)
@Patch(':id')
async updateLog(
  @Param('id', ParseIntPipe) id: number,
  @Body() dto: UpdateProductionLogDto,
) {
  return this.service.updateLog(id, dto);
}

// ดึงประวัติการแก้ไขของ log
@Get(':id/history')
async getLogHistory(@Param('id', ParseIntPipe) id: number) {
  return this.service.getLogHistory(id);
}
```

**⚠️ Route ordering**: ทั้งสองใช้ `:id` param — ตรวจสอบว่า static routes
(`start`, `in-progress`, `lot-check`, `config`) ยังอยู่ **ก่อน** parameterized routes
ตามกฎใน CLAUDE.md

### 2d. History query method

```typescript
async getLogHistory(id: number) {
  // ตรวจว่า log มีจริง
  const log = await this.prisma.production_logs.findUnique({ where: { id } });
  if (!log) {
    throw new NotFoundException(`ไม่พบ log id ${id}`);
  }

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

## Phase 3: Error handling

เพิ่ม case ใน `PrismaExceptionFilter` ถ้าจำเป็น:
- P2025 (record not found) → 404 — น่าจะ handle อยู่แล้ว
- ตรวจว่า `AllExceptionsFilter` จับ `NotFoundException` ได้ถูกต้อง

---

## Phase 4: ทดสอบ

### 4a. Manual test script

สร้าง `backend/test-edit.ps1` (ตาม pattern เดิมของ `test-start.ps1`, `test-checkout.ps1`):

```powershell
# แก้ไข log id 5 (ใช้ id ที่มีจริง)
$body = @{
  total_qty = 150
  edited_by = "กัมพล"
  edit_reason = "นับยอดผิดตอน checkout"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Uri "http://localhost:3001/production-logs/5" `
  -Method Patch -ContentType "application/json" -Body $body

# ดูประวัติ
Invoke-RestMethod -Uri "http://localhost:3001/production-logs/5/history"
```

### 4b. Concurrent edit test

สร้าง `backend/test-concurrent-edit.js` ตาม pattern ของ `test-concurrent.js`:
- ยิง 5 concurrent PATCH ไปที่ log เดียวกัน
- คาดหวัง: ทุก request สำเร็จ (ไม่ใช่ 409 เหมือน start/checkout)
  แต่ version ต้องเพิ่มขึ้นเป็น 6 (1 + 5 edits) ไม่ใช่ 2
- ตรวจ history ต้องมี 5 rows, version 1-5, snapshot แต่ละตัวต่างกัน

---

## สิ่งที่ยังไม่ต้องทำ (จะ over-engineer ถ้าทำตอนนี้)

- **Undo/rollback endpoint** — ตอนนี้แค่ "ดูประวัติได้" พอ
- **Field-level diff** — ถ้าต้องการ ทำตอน render ฝั่ง frontend
  โดยเทียบ snapshot สอง version (JSON diff)
- **Frontend UI สำหรับแก้ไข** — ยังไม่มี design, ทำ endpoint ให้พร้อมก่อน
  แล้วค่อยออกแบบ UI ทีหลัง
- **Audit trail สำหรับ child tables** (`defect_entries`, `stone_changes`, `tune_rounds`)
  — เริ่มจาก production_logs ก่อน, ขยายทีหลังถ้าจำเป็น
- **Soft delete** — ปัจจุบันไม่มี DELETE endpoint อยู่แล้ว ยังไม่ต้องเพิ่ม

---

## Checklist สำหรับ repo owner

- [ ] รัน `ALTER TABLE` + `CREATE TABLE` SQL บน Neon (Claude Code จะเตรียม SQL ให้)
- [ ] `npx prisma db pull` + `npx prisma generate` หลังรัน SQL
- [ ] Review + test PATCH endpoint locally
- [ ] Review + test GET history endpoint locally
- [ ] รัน concurrent edit test
- [ ] อัพเดต `CLAUDE.md` section Architecture ให้ครอบคลุม audit trail
- [ ] อัพเดต `MANAGER_GUIDE.md` เพิ่ม section "ดูประวัติการแก้ไข"
- [ ] Commit เมื่อพร้อม
