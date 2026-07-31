const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "ต่อ backend ไม่ได้ — เช็คว่า nest start --watch รันอยู่ที่ port 3001");
  }

  if (!res.ok) {
    let msg = `เกิดข้อผิดพลาด (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.message === "string") msg = body.message;
      else if (Array.isArray(body?.message)) msg = body.message.join(", ");
    } catch {
      /* body ไม่ใช่ JSON */
    }
    throw new ApiError(res.status, msg);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------- Types (ตรงกับ DTO จริง) ----------

export type InProgressLog = {
  id: number;
  machine_id: number;
  knife_id: number;
  lot_no: string;
  operator_id: number;
  started_at: string;
  machines?: { code: string };
  knives?: { code: string };
  // ★ ชื่อ field แปลก เพราะ Prisma auto-disambiguate relation employees ที่ชี้จาก
  // production_logs 2 ทาง (operator_id กับ supervisor_id) — ห้ามแก้ชื่อเอง
  employees_production_logs_operator_idToemployees?: { name: string };
};

export type StartPayload = {
  machineId: number;
  knifeId: number;
  lotNo: string;
  operatorId: number;
  startedAt?: string; // ISO — ไม่ส่ง = server ใช้เวลาปัจจุบัน
};

export type DefectEntry = { code: string; qty: number };

export type StoneChangePayload = {
  qtyBeforeChange: number;
  sizeLeft?: string;
  sizeRight?: string;
  downtimeStart?: string; // "HH:MM"
  downtimeEnd?: string;   // "HH:MM"
};

export type TuneRoundPayload = {
  roundNo: number;
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
};

export type ProductionLogConfig = {
  employees: { id: number; name: string; role: string }[];
  machines: { id: number; code: string }[];
  knives: { id: number; code: string }[];
  defectTypes: { code: string; name_th: string; display_order: number }[];
};

export type AnalyticsRow = {
  id: number;
  machineCode: string;
  knifeCode: string;
  lotNo: string;
  endedAt: string | null;
  totalQty: number;
  ngQty: number;
  goodQty: number;
  defects: Record<string, number>;
  stoneChanged: boolean;
  qtyBeforeChange: number | null;
  stoneDowntimeStart: string | null;
  stoneDowntimeEnd: string | null;
  tuneMinutesTotal: number;
  operatorName: string;
  supervisorName: string | null;
};

export type MachineOwners = Record<string, string>;

// ---------- Records ("ประวัติบันทึกการผลิต") + edit / audit trail ----------

export type RecordStoneChange = {
  qtyBeforeChange: number;
  sizeLeft: string | null;
  sizeRight: string | null;
  downtimeStart: string | null; // "HH:MM"
  downtimeEnd: string | null;   // "HH:MM"
};

export type RecordTuneRound = {
  roundNo: number;
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
};

export type RecordRow = {
  id: number;
  lot_no: string;
  machine: { id: number; code: string };
  operator: { id: number; name: string };
  supervisor: { id: number; name: string } | null;
  knife: { id: number; code: string };
  total_qty: number;
  good_qty: number;
  defect_qty: number;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  version: number;
  qc_approved: boolean | null;
  remark: string | null;
  stone_change: RecordStoneChange | null;
  tune_rounds: RecordTuneRound[];
};

export type RecordsResponse = {
  data: RecordRow[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
};

export type RecordsQuery = {
  page?: number;
  limit?: number;
  machineId?: number;
  operatorId?: number;
  dateFrom?: string;
  dateTo?: string;
};

export type UpdateLogPayload = {
  machineId?: number;
  knifeId?: number;
  lotNo?: string;
  status?: "in_progress" | "completed";
  startedAt?: string;
  endedAt?: string;
  totalQty?: number;
  operatorId?: number;
  supervisorId?: number;
  qcApproved?: boolean;
  remark?: string;
  // undefined = ไม่แตะ, null = ลบการเปลี่ยนหินออก, object = upsert
  stoneChange?: { qtyBeforeChange: number; sizeLeft?: string; sizeRight?: string; downtimeStart?: string; downtimeEnd?: string } | null;
  // undefined = ไม่แตะ, array (รวม []) = แทนที่รอบจูนทั้งชุด
  tuneRounds?: { roundNo: number; startTime: string; endTime: string }[];
  editedBy: string;
  editReason?: string;
};

// ★ ค่าที่ backend ส่งกลับจาก PATCH คือ production_logs row ดิบ (ไม่มี relations
// ผูกมาด้วย) ต่างจาก RecordRow ที่มี machine/operator/knife เป็น object ซ้อน —
// หลัง edit สำเร็จให้ refetch รายการแทนที่จะพยายามแปลง shape นี้เอง
export type UpdateLogResponse = {
  id: number;
  machine_id: number;
  knife_id: number;
  lot_no: string;
  status: string;
  total_qty: number | null;
  operator_id: number;
  supervisor_id: number | null;
  version: number;
};

export type LogHistoryEntry = {
  id: number;
  production_log_id: number;
  snapshot: Record<string, unknown>;
  version: number;
  edited_by: string;
  edit_reason: string | null;
  edited_at: string;
};

export type LogHistoryResponse = {
  current_version: number;
  total_edits: number;
  history: LogHistoryEntry[];
};

export type LotCheckResult = {
  done: boolean;
  log: {
    id: number;
    status: "completed" | "in_progress";
    ended_at: string | null;
    machines?: { code: string };
  } | null;
};

export type CheckoutPayload = {
  totalQty: number;
  supervisorId: number;
  endedAt?: string;
  qcApproved?: boolean;
  remark?: string;
  defects?: DefectEntry[];
  stoneChange?: StoneChangePayload;
  tuneRounds?: TuneRoundPayload[];
};

// ---------- Inventory (เบิก-รับเข้าวัสดุ) ----------

export type InventoryItem = {
  id: string;
  name: string;
  unit: string;
  reorderPoint: number;
};

export type InventoryConfig = {
  employees: { id: number; name: string; role: string }[];
  machines: { id: number; code: string }[];
};

export type StockStatus = {
  id: string;
  name: string;
  unit: string;
  totalIn: number;
  totalOut: number;
  balance: number;
  reorderPoint: number;
  status: "ปกติ" | "ใกล้หมด" | "สั่งซื้อด่วน";
  lastUpdated: string | null;
};

export type WithdrawalPayload = {
  itemId: string;
  qty: number;
  withdrawerId: number;
  machineId?: number;
  condition?: string;
  reason?: string;
  remark?: string;
};

export type ReceiptPayload = {
  itemId: string;
  qty: number;
  receiverId: number;
  source?: string;
  remark?: string;
};

// ---------- Endpoints ----------
export const api = {
  getInProgress: () => request<InProgressLog[]>("/production-logs/in-progress"),

  start: (body: StartPayload) =>
    request<InProgressLog>("/production-logs/start", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  checkout: (id: number, body: CheckoutPayload) =>
    request<InProgressLog>(`/production-logs/${id}/checkout`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  checkLot: (lotNo: string) =>
    request<LotCheckResult>(`/production-logs/lot-check?lotNo=${encodeURIComponent(lotNo)}`),

  getProductionLogConfig: () => request<ProductionLogConfig>("/production-logs/config"),

  getAnalyticsData: () => request<AnalyticsRow[]>("/production-logs/analytics"),

  getMachineOwners: () => request<MachineOwners>("/production-logs/machine-owners"),

  getRecords: (query: RecordsQuery = {}) => {
    const params = new URLSearchParams();
    if (query.page) params.set("page", String(query.page));
    if (query.limit) params.set("limit", String(query.limit));
    if (query.machineId) params.set("machineId", String(query.machineId));
    if (query.operatorId) params.set("operatorId", String(query.operatorId));
    if (query.dateFrom) params.set("dateFrom", query.dateFrom);
    if (query.dateTo) params.set("dateTo", query.dateTo);
    const qs = params.toString();
    return request<RecordsResponse>(`/production-logs/records${qs ? `?${qs}` : ""}`);
  },

  updateLog: (id: number, body: UpdateLogPayload) =>
    request<UpdateLogResponse>(`/production-logs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  getLogHistory: (id: number) => request<LogHistoryResponse>(`/production-logs/${id}/history`),

  deleteLog: (id: number, body: { deletedBy: string; deleteReason?: string }) =>
    request<{ deleted: true; id: number }>(`/production-logs/${id}`, {
      method: "DELETE",
      body: JSON.stringify(body),
    }),

  // ----- inventory -----
  getItems: () => request<InventoryItem[]>("/inventory/items"),

  getInventoryConfig: () => request<InventoryConfig>("/inventory/config"),

  getStock: () => request<StockStatus[]>("/inventory/stock"),

  createWithdrawal: (body: WithdrawalPayload) =>
    request<{ id: number }>("/inventory/withdrawals", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  createReceipt: (body: ReceiptPayload) =>
    request<{ id: number }>("/inventory/receipts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};