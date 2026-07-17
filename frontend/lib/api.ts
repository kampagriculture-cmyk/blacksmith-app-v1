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
};