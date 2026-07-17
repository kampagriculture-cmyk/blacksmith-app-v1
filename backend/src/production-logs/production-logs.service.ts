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