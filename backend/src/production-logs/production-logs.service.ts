import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CreateProductionLogDto } from "./dto/create-production-log.dto";
import { StartWorkOrderDto } from "./dto/start-work-order.dto";
import { CheckoutWorkOrderDto } from "./dto/checkout-work-order.dto";
import { UpdateProductionLogDto } from "./dto/update-production-log.dto";
import { DeleteProductionLogDto } from "./dto/delete-production-log.dto";
import { RecordsQueryDto } from "./dto/records-query.dto";

function timeStringToDate(time: string): Date {
  return new Date(`1970-01-01T${time}:00Z`);
}

/** "HH:MM" จาก DB Time field (เก็บแบบ UTC ตาม timeStringToDate ด้านบน) */
function timeToHHMM(t: Date): string {
  return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
}

/** นาทีต่างระหว่าง HH:MM สองค่า ข้ามเที่ยงคืน +1440 (ตรรกะเดียวกับ calcDt เดิมฝั่ง Apps Script) */
function minutesBetween(start: Date, end: Date): number {
  const s = start.getUTCHours() * 60 + start.getUTCMinutes();
  const e = end.getUTCHours() * 60 + end.getUTCMinutes();
  return e < s ? e - s + 1440 : e - s;
}

const H_CODES = [
  "H01", "H02", "H03", "H04", "H05", "H06", "H07",
  "H08", "H09", "H10", "H11", "H12", "H13", "H14", "H15",
];

const LOCK_NAMESPACE_MACHINE = 42;

type ProductionLogLockRow = {
  id: number;
  status: string;
  machine_id: number;
};

/** แถวเต็มจาก SELECT * FOR UPDATE — ใช้เป็น snapshot ก่อนแก้ (ดู updateLog) */
type ProductionLogFullRow = {
  id: number;
  machine_id: number;
  knife_id: number;
  lot_no: string;
  status: string;
  started_at: Date | null;
  ended_at: Date | null;
  total_qty: number | null;
  operator_id: number;
  supervisor_id: number | null;
  qc_approved: boolean | null;
  remark: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
};

@Injectable()
export class ProductionLogsService {
  constructor(private prisma: PrismaService) {}

  async startWorkOrder(dto: StartWorkOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      // ★ PHASE 3 NEGATIVE CONTROL — ปิดชั่วคราว อย่าลืมเปิดคืน!
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          ${LOCK_NAMESPACE_MACHINE}::int,
          ${dto.machineId}::int
        )`;

      const running = await tx.production_logs.findFirst({
        where: { machine_id: dto.machineId, status: "in_progress" },
        select: { id: true, lot_no: true },
      });

      if (running) {
        throw new ConflictException(
          `เครื่องนี้มีงานค้างอยู่: lot ${running.lot_no} (log id ${running.id}) — ต้อง checkout ก่อนเปิดงานใหม่`,
        );
      }

      // ★ กันล็อตซ้ำ 2 แบบ: เสร็จไปแล้ว หรือกำลังทำอยู่ที่เครื่องอื่น (เครื่องเดียวกันถูกกันไปแล้วด้านบน)
      const conflictingLot = await tx.production_logs.findFirst({
        where: { lot_no: dto.lotNo, status: { in: ["completed", "in_progress"] } },
        select: { id: true, status: true, machines: { select: { code: true } } },
      });

      if (conflictingLot) {
        const message =
          conflictingLot.status === "completed"
            ? `ล็อตนี้ (${dto.lotNo}) เสร็จงานไปแล้ว (log id ${conflictingLot.id}) — ตรวจสอบเลขล็อตอีกครั้ง`
            : `ล็อตนี้ (${dto.lotNo}) กำลังทำอยู่ที่เครื่อง ${conflictingLot.machines.code} (log id ${conflictingLot.id}) — ตรวจสอบเลขล็อตอีกครั้ง`;
        throw new ConflictException(message);
      }

      const log = await tx.production_logs.create({
        data: {
          machine_id: dto.machineId,
          knife_id: dto.knifeId,
          lot_no: dto.lotNo,
          operator_id: dto.operatorId,
          status: "in_progress",
          started_at: dto.startedAt ? new Date(dto.startedAt) : new Date(),
        },
      });

      return log;
    });
  }

  async checkoutWorkOrder(id: number, dto: CheckoutWorkOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      const rows = (await tx.$queryRaw`
        SELECT id, status, machine_id
        FROM production_logs
        WHERE id = ${id}
        FOR UPDATE
      `) as ProductionLogLockRow[];

      if (rows.length === 0) {
        throw new NotFoundException(`ไม่พบ production log id ${id}`);
      }

      const current = rows[0];

      if (current.status !== "in_progress") {
        throw new ConflictException(
          `log id ${id} ปิดงานไปแล้ว (status = ${current.status}) — ปิดซ้ำไม่ได้`,
        );
      }

      const totalDefects = (dto.defects ?? []).reduce((s, d) => s + d.qty, 0);
      if (totalDefects > dto.totalQty) {
        throw new BadRequestException(
          `ของเสียรวม ${totalDefects} ชิ้น มากกว่ายอดผลิต ${dto.totalQty} ชิ้น`,
        );
      }

      const log = await tx.production_logs.update({
        where: { id },
        data: {
          status: "completed",
          total_qty: dto.totalQty,
          supervisor_id: dto.supervisorId,
          ended_at: dto.endedAt ? new Date(dto.endedAt) : new Date(),
          qc_approved: dto.qcApproved,
          remark: dto.remark,
          updated_at: new Date(),
        },
      });

      if (dto.defects?.length) {
        await tx.defect_entries.createMany({
          data: dto.defects.map((d) => ({
            production_log_id: id,
            defect_type_code: d.code,
            qty: d.qty,
          })),
        });
      }

      if (dto.stoneChange) {
        await tx.stone_changes.create({
          data: {
            production_log_id: id,
            qty_before_change: dto.stoneChange.qtyBeforeChange,
            size_left: dto.stoneChange.sizeLeft,
            size_right: dto.stoneChange.sizeRight,
            downtime_start: dto.stoneChange.downtimeStart
              ? timeStringToDate(dto.stoneChange.downtimeStart)
              : null,
            downtime_end: dto.stoneChange.downtimeEnd
              ? timeStringToDate(dto.stoneChange.downtimeEnd)
              : null,
          },
        });
      }

      if (dto.tuneRounds?.length) {
        await tx.tune_rounds.createMany({
          data: dto.tuneRounds.map((t) => ({
            production_log_id: id,
            round_no: t.roundNo,
            start_time: timeStringToDate(t.startTime),
            end_time: timeStringToDate(t.endTime),
          })),
        });
      }

      return log;
    });
  }

  /**
   * แก้ไข production log หลังบันทึกไปแล้ว (เช่น นับยอดผิดตอน checkout, ลืมกรอกเวลา
   * จูน/เปลี่ยนหินตอน checkout จริง) พร้อม audit trail — snapshot ค่าเดิมทั้งก้อน
   * (row หลัก + stone_changes + tune_rounds) ลง production_log_history ก่อน
   * UPDATE เสมอ ทั้งหมดอยู่ใน transaction เดียวกัน (all-or-nothing)
   * ดู AUDIT_TRAIL_PLAN.md สำหรับ design เต็ม
   *
   * stone_changes/tune_rounds ไม่ใช่ field ธรรมดา — stoneChange เป็น upsert
   * (undefined=ไม่แตะ, null=ลบ, object=ใส่ค่าใหม่ทั้งก้อน) ส่วน tuneRounds เป็น
   * full-replace (undefined=ไม่แตะ, array=ลบของเดิมทั้งหมดแล้วสร้างใหม่ตาม array
   * ที่ส่งมา — ไม่ merge ทีละรอบ เพราะฝั่ง client ส่ง state เต็มชุดมาอยู่แล้ว)
   */
  async updateLog(id: number, dto: UpdateProductionLogDto) {
    const { editedBy, editReason, stoneChange, tuneRounds, ...fields } = dto;

    return this.prisma.$transaction(async (tx) => {
      // 1. Row lock — กัน concurrent edit เหมือน pattern ใน checkoutWorkOrder
      const rows = (await tx.$queryRaw`
        SELECT * FROM production_logs WHERE id = ${id} FOR UPDATE
      `) as ProductionLogFullRow[];

      if (rows.length === 0) {
        throw new NotFoundException(`ไม่พบ production log id ${id}`);
      }
      const existing = rows[0];

      const [existingStoneChange, existingTuneRounds] = await Promise.all([
        tx.stone_changes.findFirst({ where: { production_log_id: id } }),
        tx.tune_rounds.findMany({ where: { production_log_id: id } }),
      ]);

      // 2. Snapshot ค่าเดิมทั้งก้อนลง history ก่อนแก้ (รวม child records ที่กำลังจะเปลี่ยน)
      await tx.production_log_history.create({
        data: {
          production_log_id: id,
          snapshot: JSON.parse(
            JSON.stringify({
              production_log: existing,
              stone_change: existingStoneChange,
              tune_rounds: existingTuneRounds,
            }),
          ),
          version: existing.version,
          edited_by: editedBy,
          edit_reason: editReason ?? null,
        },
      });

      // 3. Update ค่าใหม่ + increment version — ทุก field ของ production_logs แก้ได้
      const updated = await tx.production_logs.update({
        where: { id },
        data: {
          machine_id: fields.machineId,
          knife_id: fields.knifeId,
          lot_no: fields.lotNo,
          status: fields.status,
          started_at: fields.startedAt !== undefined ? new Date(fields.startedAt) : undefined,
          ended_at: fields.endedAt !== undefined ? new Date(fields.endedAt) : undefined,
          total_qty: fields.totalQty,
          operator_id: fields.operatorId,
          supervisor_id: fields.supervisorId,
          qc_approved: fields.qcApproved,
          remark: fields.remark,
          version: existing.version + 1,
          updated_at: new Date(),
        },
      });

      // 4. stoneChange: undefined = ไม่แตะ, null = ลบ, object = upsert
      if (stoneChange === null) {
        await tx.stone_changes.deleteMany({ where: { production_log_id: id } });
      } else if (stoneChange !== undefined) {
        await tx.stone_changes.upsert({
          where: { production_log_id: id },
          create: {
            production_log_id: id,
            qty_before_change: stoneChange.qtyBeforeChange,
            size_left: stoneChange.sizeLeft ?? null,
            size_right: stoneChange.sizeRight ?? null,
            downtime_start: stoneChange.downtimeStart ? timeStringToDate(stoneChange.downtimeStart) : null,
            downtime_end: stoneChange.downtimeEnd ? timeStringToDate(stoneChange.downtimeEnd) : null,
          },
          update: {
            qty_before_change: stoneChange.qtyBeforeChange,
            size_left: stoneChange.sizeLeft ?? null,
            size_right: stoneChange.sizeRight ?? null,
            downtime_start: stoneChange.downtimeStart ? timeStringToDate(stoneChange.downtimeStart) : null,
            downtime_end: stoneChange.downtimeEnd ? timeStringToDate(stoneChange.downtimeEnd) : null,
          },
        });
      }

      // 5. tuneRounds: undefined = ไม่แตะ, array (รวม []) = แทนที่ทั้งชุด
      if (tuneRounds !== undefined) {
        await tx.tune_rounds.deleteMany({ where: { production_log_id: id } });
        if (tuneRounds.length) {
          await tx.tune_rounds.createMany({
            data: tuneRounds.map((r) => ({
              production_log_id: id,
              round_no: r.roundNo,
              start_time: timeStringToDate(r.startTime),
              end_time: timeStringToDate(r.endTime),
            })),
          });
        }
      }

      return updated;
    });
  }

  /**
   * ลบ production log จริง (hard delete) — ใช้กับกรณีกดซ้ำ/บันทึกซ้ำโดยไม่ตั้งใจ
   * เก็บ snapshot ของ row หลัก + child records (defect_entries, stone_changes,
   * tune_rounds) + ประวัติแก้ไขเดิม (ถ้ามี) ลง production_log_deletions ก่อนลบเสมอ
   * เพราะทั้งหมดจะหายไปจริงหลัง DELETE (cascade) — กู้คืนได้จาก snapshot นี้เท่านั้น
   * (ไม่มี endpoint กู้คืนอัตโนมัติ ต้องให้ developer ทำมือถ้าจำเป็น)
   *
   * ใช้ production_log_deletions ไม่ใช้ production_log_history เพราะตารางนั้น
   * FK ไปหา production_logs แบบ ON DELETE CASCADE — ถ้า insert snapshot ไว้ที่นั่น
   * แล้วค่อย DELETE row หลัก, cascade จะลบ snapshot ที่เพิ่ง insert ไปด้วยทันที
   */
  async deleteLog(id: number, dto: DeleteProductionLogDto) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Row lock — pattern เดียวกับ updateLog/checkoutWorkOrder
      const rows = (await tx.$queryRaw`
        SELECT * FROM production_logs WHERE id = ${id} FOR UPDATE
      `) as ProductionLogFullRow[];

      if (rows.length === 0) {
        throw new NotFoundException(`ไม่พบ production log id ${id}`);
      }
      const existing = rows[0];

      const [defectEntries, stoneChange, tuneRounds, editHistory] = await Promise.all([
        tx.defect_entries.findMany({ where: { production_log_id: id } }),
        tx.stone_changes.findFirst({ where: { production_log_id: id } }),
        tx.tune_rounds.findMany({ where: { production_log_id: id } }),
        tx.production_log_history.findMany({ where: { production_log_id: id } }),
      ]);

      // 2. Snapshot ทุกอย่างที่จะหายไปตอน cascade delete ลงก่อนเสมอ
      await tx.production_log_deletions.create({
        data: {
          production_log_id: id,
          snapshot: JSON.parse(
            JSON.stringify({
              production_log: existing,
              defect_entries: defectEntries,
              stone_changes: stoneChange,
              tune_rounds: tuneRounds,
              prior_edit_history: editHistory,
            }),
          ),
          deleted_by: dto.deletedBy,
          delete_reason: dto.deleteReason ?? null,
        },
      });

      // 3. ลบจริง — cascade ลบ defect_entries/stone_changes/tune_rounds/production_log_history ให้อัตโนมัติ
      await tx.production_logs.delete({ where: { id } });

      return { deleted: true, id };
    });
  }

  /** ประวัติการแก้ไขของ log หนึ่งตัว เรียงล่าสุดก่อน */
  async getLogHistory(id: number) {
    const log = await this.prisma.production_logs.findUnique({ where: { id } });
    if (!log) {
      throw new NotFoundException(`ไม่พบ production log id ${id}`);
    }

    const history = await this.prisma.production_log_history.findMany({
      where: { production_log_id: id },
      orderBy: { version: "desc" },
    });

    return {
      current_version: log.version,
      total_edits: history.length,
      history,
    };
  }

  async checkLot(lotNo: string) {
    const log = await this.prisma.production_logs.findFirst({
      where: { lot_no: lotNo, status: { in: ["completed", "in_progress"] } },
      select: {
        id: true,
        status: true,
        ended_at: true,
        machines: { select: { code: true } },
      },
      orderBy: { created_at: "desc" },
    });

    return { done: log !== null, log };
  }

  async findInProgress() {
    return this.prisma.production_logs.findMany({
      where: { status: "in_progress" },
      include: {
        machines: true,
        knives: true,
        employees_production_logs_operator_idToemployees: true,
      },
      orderBy: { started_at: "asc" },
    });
  }

  async create(dto: CreateProductionLogDto) {
    return this.prisma.$transaction(async (tx) => {
      const log = await tx.production_logs.create({
        data: {
          machine_id: dto.machineId,
          knife_id: dto.knifeId,
          lot_no: dto.lotNo,
          ended_at: new Date(dto.endedAt),
          total_qty: dto.totalQty,
          operator_id: dto.operatorId,
          supervisor_id: dto.supervisorId,
          qc_approved: dto.qcApproved,
          remark: dto.remark,
        },
      });

      if (dto.defects?.length) {
        await tx.defect_entries.createMany({
          data: dto.defects.map((d) => ({
            production_log_id: log.id,
            defect_type_code: d.code,
            qty: d.qty,
          })),
        });
      }

      if (dto.stoneChange) {
        await tx.stone_changes.create({
          data: {
            production_log_id: log.id,
            qty_before_change: dto.stoneChange.qtyBeforeChange,
            size_left: dto.stoneChange.sizeLeft,
            size_right: dto.stoneChange.sizeRight,
            downtime_start: dto.stoneChange.downtimeStart
              ? timeStringToDate(dto.stoneChange.downtimeStart)
              : null,
            downtime_end: dto.stoneChange.downtimeEnd
              ? timeStringToDate(dto.stoneChange.downtimeEnd)
              : null,
          },
        });
      }

      if (dto.tuneRounds?.length) {
        await tx.tune_rounds.createMany({
          data: dto.tuneRounds.map((t) => ({
            production_log_id: log.id,
            round_no: t.roundNo,
            start_time: timeStringToDate(t.startTime),
            end_time: timeStringToDate(t.endTime),
          })),
        });
      }

      return log;
    });
  }

  /** ข้อมูลอ้างอิงสำหรับ dropdown ฝั่ง frontend (start/checkout) — ดึงสดจาก DB แทน hardcode */
  async getConfig() {
    const [employees, machines, knives, defectTypes] = await Promise.all([
      this.prisma.employees.findMany({
        where: { active: true },        // ← เพิ่มบรรทัดนี้
        select: { id: true, name: true, role: true },
        orderBy: { id: "asc" },
      }),
      this.prisma.machines.findMany({
        select: { id: true, code: true },
        orderBy: { id: "asc" },
      }),
      this.prisma.knives.findMany({
        select: { id: true, code: true },
        orderBy: { id: "asc" },
      }),
      this.prisma.defect_types.findMany({
        select: { code: true, name_th: true, display_order: true },
        orderBy: { display_order: "asc" },
      }),
    ]);
    return { employees, machines, knives, defectTypes };
  }

  /**
   * ข้อมูลดิบทั้งหมดสำหรับหน้า Analytics — ports the old Google Apps Script
   * dashboard's getDashboardData(). ฝั่ง frontend ทำ filter/aggregate เองหมด
   * (เหมือนต้นฉบับ) เลยส่งทุกแถวไปแบบไม่กรอง ไม่ทำ pagination
   */
  async getAnalyticsData() {
    const logs = await this.prisma.production_logs.findMany({
      where: { status: "completed" },
      include: {
        machines: true,
        knives: true,
        employees_production_logs_operator_idToemployees: true,
        employees_production_logs_supervisor_idToemployees: true,
        defect_entries: true,
        stone_changes: true,
        tune_rounds: true,
      },
      orderBy: { ended_at: "asc" },
    });

    return logs.map((log) => {
      const totalQty = log.total_qty ?? 0;
      const defects: Record<string, number> = Object.fromEntries(H_CODES.map((c) => [c, 0]));
      let ngQty = 0;
      for (const d of log.defect_entries) {
        defects[d.defect_type_code] = d.qty;
        ngQty += d.qty;
      }

      const tuneMinutesTotal = log.tune_rounds.reduce(
        (sum, r) => sum + minutesBetween(r.start_time, r.end_time),
        0,
      );

      return {
        id: log.id,
        machineCode: log.machines.code,
        knifeCode: log.knives.code,
        lotNo: log.lot_no,
        endedAt: log.ended_at,
        totalQty,
        ngQty,
        goodQty: totalQty - ngQty,
        defects,
        stoneChanged: log.stone_changes !== null,
        qtyBeforeChange: log.stone_changes?.qty_before_change ?? null,
        stoneDowntimeStart: log.stone_changes?.downtime_start
          ? timeToHHMM(log.stone_changes.downtime_start)
          : null,
        stoneDowntimeEnd: log.stone_changes?.downtime_end
          ? timeToHHMM(log.stone_changes.downtime_end)
          : null,
        tuneMinutesTotal,
        operatorName: log.employees_production_logs_operator_idToemployees.name,
        supervisorName: log.employees_production_logs_supervisor_idToemployees?.name ?? null,
      };
    });
  }

  /** เจ้าของเครื่อง (ports getMachineOwners) — map: machine code -> ชื่อคนประจำเครื่อง */
  async getMachineOwners() {
    const rows = await this.prisma.machine_owners.findMany({
      include: { machines: true, employees: true },
    });
    return Object.fromEntries(rows.map((r) => [r.machines.code, r.employees.name]));
  }

  /**
   * รายการ production log แบบแบ่งหน้า สำหรับหน้า /records ("ประวัติบันทึกการผลิต")
   * ต่างจาก getAnalyticsData() (ดึงทุกแถวไม่กรอง ให้ frontend คำนวณเอง) — endpoint
   * นี้กรอง/แบ่งหน้าฝั่ง backend เพราะใช้แสดงเป็นตารางยาวให้ browse+แก้ไขทีละ record
   * เฉพาะ log ที่ status = 'completed' เท่านั้น (log ที่ยังไม่ checkout ไม่มี total_qty
   * ให้แก้ และควรไปแก้ผ่านหน้า checkout ตามปกติ ไม่ใช่ทางนี้)
   */
  async getRecords(query: RecordsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = {
      status: "completed",
      ...(query.machineId ? { machine_id: query.machineId } : {}),
      ...(query.operatorId ? { operator_id: query.operatorId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            ended_at: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.production_logs.findMany({
        where,
        include: {
          machines: true,
          knives: true,
          employees_production_logs_operator_idToemployees: true,
          employees_production_logs_supervisor_idToemployees: true,
          defect_entries: true,
          stone_changes: true,
          tune_rounds: { orderBy: { round_no: "asc" } },
        },
        orderBy: { ended_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.production_logs.count({ where }),
    ]);

    const data = rows.map((r) => {
      const defectQty = r.defect_entries.reduce((s, d) => s + d.qty, 0);
      const totalQty = r.total_qty ?? 0;
      return {
        id: r.id,
        lot_no: r.lot_no,
        machine: { id: r.machines.id, code: r.machines.code },
        operator: { id: r.employees_production_logs_operator_idToemployees.id, name: r.employees_production_logs_operator_idToemployees.name },
        supervisor: r.employees_production_logs_supervisor_idToemployees
          ? { id: r.employees_production_logs_supervisor_idToemployees.id, name: r.employees_production_logs_supervisor_idToemployees.name }
          : null,
        knife: { id: r.knives.id, code: r.knives.code },
        total_qty: totalQty,
        good_qty: totalQty - defectQty,
        defect_qty: defectQty,
        status: r.status,
        started_at: r.started_at,
        ended_at: r.ended_at,
        version: r.version,
        qc_approved: r.qc_approved,
        remark: r.remark,
        stone_change: r.stone_changes
          ? {
              qtyBeforeChange: r.stone_changes.qty_before_change,
              sizeLeft: r.stone_changes.size_left,
              sizeRight: r.stone_changes.size_right,
              downtimeStart: r.stone_changes.downtime_start ? timeToHHMM(r.stone_changes.downtime_start) : null,
              downtimeEnd: r.stone_changes.downtime_end ? timeToHHMM(r.stone_changes.downtime_end) : null,
            }
          : null,
        tune_rounds: r.tune_rounds.map((t) => ({
          roundNo: t.round_no,
          startTime: timeToHHMM(t.start_time),
          endTime: timeToHHMM(t.end_time),
        })),
      };
    });

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findByMachine(machineCode: string) {
    return this.prisma.production_logs.findMany({
      where: { machines: { code: machineCode } },
      include: {
        machines: true,
        employees_production_logs_operator_idToemployees: true,
        defect_entries: true,
        stone_changes: true,
        tune_rounds: true,
      },
    });
  }
}