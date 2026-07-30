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