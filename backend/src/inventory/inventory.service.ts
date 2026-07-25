import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CreateWithdrawalDto } from "./dto/create-withdrawal.dto";
import { CreateReceiptDto } from "./dto/create-receipt.dto";

// ===== สถานะสต็อค — ตรงกับ constant ใน Code.gs =====
const STATUS_NORMAL = "ปกติ";
const STATUS_WARNING = "ใกล้หมด";
const STATUS_CRITICAL = "สั่งซื้อด่วน";

export type StockStatus = {
  id: string;
  name: string;
  unit: string;
  totalIn: number;
  totalOut: number;
  balance: number;
  reorderPoint: number;
  status: string;
  lastUpdated: string | null;
};

// แถวดิบจาก view inventory_state
type StateRow = {
  id: string;
  name: string;
  unit: string;
  reorder_point: number;
  total_in: number;
  total_out: number;
  balance: number;
  last_updated: Date | null;
};

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private prisma: PrismaService) {}

  // ---------- READ ----------

  /** รายการวัสดุที่ active — เติม dropdown (mirror getItemList) */
  async getItems() {
    const items = await this.prisma.item_master.findMany({
      where: { active: true },
      orderBy: { id: "asc" },
    });
    return items.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      reorderPoint: i.reorder_point,
    }));
  }

  /**
   * ผู้เบิก/ผู้รับ/เครื่อง — เติม dropdown (mirror getConfigLists)
   * ต่างจาก GAS: ดึงจากตาราง employees/machines จริง ไม่ hardcode
   */
  async getConfig() {
    const [employees, machines] = await Promise.all([
      this.prisma.employees.findMany({
        select: { id: true, name: true, role: true },
        orderBy: { id: "asc" },
      }),
      this.prisma.machines.findMany({
        select: { id: true, code: true },
        orderBy: { id: "asc" },
      }),
    ]);
    return { employees, machines };
  }

  /** สถานะสต็อคทั้งหมด เรียง critical→warning→normal (mirror getStockStatus) */
  async getStock(): Promise<StockStatus[]> {
    const rows = await this.prisma.$queryRaw<StateRow[]>`
      SELECT id, name, unit, reorder_point, total_in, total_out, balance, last_updated
      FROM inventory_state
    `;

    const rank: Record<string, number> = {
      [STATUS_CRITICAL]: 0,
      [STATUS_WARNING]: 1,
      [STATUS_NORMAL]: 2,
    };

    return rows
      .map((r) => this.toStockStatus(r))
      .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3));
  }

  // ---------- WRITE ----------

  /** บันทึกการเบิก — insert log แล้วเช็คว่าตกถึง CRITICAL ไหม (mirror saveWithdrawal) */
  async createWithdrawal(dto: CreateWithdrawalDto) {
    await this.assertItemActive(dto.itemId);

    const row = await this.prisma.withdrawal_log.create({
      data: {
        item_id: dto.itemId,
        qty: dto.qty,
        withdrawer_id: dto.withdrawerId,
        machine_id: dto.machineId ?? null,
        condition: dto.condition ?? null,
        reason: dto.reason ?? null,
        remark: dto.remark ?? null,
      },
    });

    // เช็คหลังเบิก — ตกถึงระดับ CRITICAL หรือยัง แล้วยิง alert hook
    const state = await this.getStockForItem(dto.itemId);
    if (state && state.status === STATUS_CRITICAL) {
      this.triggerLowStockAlert(state);
    }

    return row;
  }

  /** บันทึกการรับเข้า — insert log (mirror saveReceipt) */
  async createReceipt(dto: CreateReceiptDto) {
    await this.assertItemActive(dto.itemId);

    return this.prisma.receipt_log.create({
      data: {
        item_id: dto.itemId,
        qty: dto.qty,
        receiver_id: dto.receiverId,
        source: dto.source ?? null,
        remark: dto.remark ?? null,
      },
    });
  }

  // ---------- INTERNAL ----------

  private async assertItemActive(itemId: string) {
    const item = await this.prisma.item_master.findUnique({
      where: { id: itemId },
    });
    if (!item) {
      throw new BadRequestException(`ไม่พบรหัสวัสดุ ${itemId}`);
    }
    if (!item.active) {
      throw new BadRequestException(`วัสดุ ${item.name} ถูกปิดใช้งานอยู่`);
    }
  }

  private async getStockForItem(itemId: string): Promise<StockStatus | null> {
    const rows = await this.prisma.$queryRaw<StateRow[]>`
      SELECT id, name, unit, reorder_point, total_in, total_out, balance, last_updated
      FROM inventory_state
      WHERE id = ${itemId}
    `;
    return rows.length ? this.toStockStatus(rows[0]) : null;
  }

  private toStockStatus(r: StateRow): StockStatus {
    return {
      id: r.id,
      name: r.name,
      unit: r.unit,
      totalIn: Number(r.total_in),
      totalOut: Number(r.total_out),
      balance: Number(r.balance),
      reorderPoint: r.reorder_point,
      status: this.calcStatus(Number(r.balance), r.reorder_point),
      lastUpdated: r.last_updated ? r.last_updated.toISOString() : null,
    };
  }

  /** ตรรกะสถานะ — เหมือน calcStatus_ ใน Code.gs เป๊ะ */
  private calcStatus(balance: number, reorderPoint: number): string {
    if (balance <= reorderPoint) return STATUS_CRITICAL;
    if (balance <= reorderPoint * 1.5) return STATUS_WARNING;
    return STATUS_NORMAL;
  }

  /**
   * hook เมื่อสต็อคตกถึง CRITICAL — ตอนนี้แค่ log ไว้ (เหมือน triggerLowStockAlert_ เดิม)
   * รอ decide ช่องทาง (email / LINE) ค่อยเสียบ logic จริงที่นี่
   */
  private triggerLowStockAlert(state: StockStatus) {
    this.logger.warn(
      `[ALERT] Low stock: ${state.name} balance=${state.balance} reorder=${state.reorderPoint}`,
    );
  }
}
