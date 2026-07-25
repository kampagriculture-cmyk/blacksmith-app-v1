"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type InventoryItem,
  type InventoryConfig,
  type StockStatus,
} from "@/lib/api";
import { BackLink } from "@/components/BackLink";

// สภาพวัสดุเก่าที่คืน — 3 ตัวเลือกเหมือนฟอร์ม GAS เดิม
const CONDITIONS = [
  { value: "เปลี่ยนพอดีขีดมาตรฐาน", icon: "✓", label: "เปลี่ยนพอดีขีดมาตรฐาน" },
  { value: "เปลี่ยนก่อนถึงขีด", icon: "↩", label: "เปลี่ยนก่อนถึงขีด" },
  { value: "เลยขีดวงในไปแล้ว", icon: "⚠", label: "เลยขีดวงในไปแล้ว" },
];
// ช่อง reason โผล่เฉพาะตัวเลือกนี้
const REASON_CONDITION = "เปลี่ยนก่อนถึงขีด";

type Tab = "withdraw" | "receipt" | "stock";
type Msg = { kind: "ok" | "err"; text: string } | null;

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>("withdraw");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [config, setConfig] = useState<InventoryConfig>({ employees: [], machines: [] });
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [i, c] = await Promise.all([api.getItems(), api.getInventoryConfig()]);
        setItems(i);
        setConfig(c);
      } catch (e) {
        setLoadErr((e as ApiError).message);
      }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-graphite-night text-ink p-3">
      <div className="mx-auto max-w-[480px]">
        <BackLink />
        <h1 className="text-center text-[19px] font-medium mb-3.5">
          ระบบเบิก-รับเข้าวัสดุสิ้นเปลือง
        </h1>

        {/* ===== Tab bar ===== */}
        <div className="flex gap-1.5 mb-3.5 bg-graphite-surface border-[0.5px] border-hairline rounded-xl p-1.5">
          {(
            [
              ["withdraw", "เบิก"],
              ["receipt", "รับเข้า"],
              ["stock", "สต็อค"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 h-[42px] rounded-lg text-sm transition-colors ${
                tab === key ? "bg-shift-blue text-white" : "text-ink-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loadErr && <StatusBox kind="err">{loadErr}</StatusBox>}

        {tab === "withdraw" && <WithdrawForm items={items} config={config} />}
        {tab === "receipt" && <ReceiptForm items={items} config={config} />}
        {tab === "stock" && <StockPanel active />}
      </div>
    </main>
  );
}

// ============================================================
// TAB 1 — เบิก
// ============================================================
function WithdrawForm({
  items,
  config,
}: {
  items: InventoryItem[];
  config: InventoryConfig;
}) {
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(2);
  const [withdrawerId, setWithdrawerId] = useState<number | "">("");
  const [machineId, setMachineId] = useState<number | "">("");
  const [condition, setCondition] = useState("");
  const [reason, setReason] = useState("");
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const item = items.find((i) => i.id === itemId);
  const ready = itemId !== "" && qty > 0 && withdrawerId !== "" && condition !== "";

  function reset() {
    setItemId("");
    setQty(2);
    setWithdrawerId("");
    setMachineId("");
    setCondition("");
    setReason("");
    setRemark("");
  }

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.createWithdrawal({
        itemId,
        qty,
        withdrawerId: Number(withdrawerId),
        machineId: machineId === "" ? undefined : Number(machineId),
        condition,
        reason: reason.trim() || undefined,
        remark: remark.trim() || undefined,
      });
      setMsg({
        kind: "ok",
        text: `บันทึกการเบิก ${item?.name ?? itemId} จำนวน ${qty} ${item?.unit ?? ""} สำเร็จ`,
      });
      reset();
    } catch (e) {
      setMsg({ kind: "err", text: (e as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="ข้อมูลการเบิก" icon="▣">
        <Field label="วัสดุที่เบิก" required>
          <ItemSelect items={items} value={itemId} onChange={setItemId} />
        </Field>
        <Field label="จำนวน" required>
          <Stepper value={qty} onChange={setQty} />
        </Field>
        <div className="flex gap-2">
          <Field label="ผู้เบิก" required className="flex-1">
            <EmployeeSelect
              employees={config.employees}
              value={withdrawerId}
              onChange={setWithdrawerId}
            />
          </Field>
          <Field label="เครื่องปลายทาง (ถ้าทราบ)" className="flex-1">
            <MachineSelect
              machines={config.machines}
              value={machineId}
              onChange={setMachineId}
            />
          </Field>
        </div>
      </Card>

      <Card title="สภาพวัสดุเก่าที่คืน" icon="⚙">
        <div className="flex flex-col gap-2">
          {CONDITIONS.map((c) => (
            <button
              key={c.value}
              onClick={() => setCondition(c.value)}
              className={`h-12 rounded-lg border-[0.5px] text-sm text-left px-3.5 transition-colors ${
                condition === c.value
                  ? "bg-shift-blue border-shift-blue text-white"
                  : "bg-graphite-surface-2 border-hairline-strong text-ink"
              }`}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>
        {condition === REASON_CONDITION && (
          <div className="mt-3 bg-amber-warning-bg border-[0.5px] border-amber-warning-border rounded-xl p-3">
            <label className="block text-[13px] font-medium text-amber-warning-text mb-1.5">
              ระบุเหตุผลที่เปลี่ยนก่อนถึงขีด
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น หินแตก / บิ่น / งานพิเศษ"
              className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-amber-warning-border px-3 text-base text-ink placeholder:text-ink-faint outline-none"
            />
          </div>
        )}
      </Card>

      <Card title="หมายเหตุ" icon="✎">
        <Textarea value={remark} onChange={setRemark} />
      </Card>

      <ReqNote />
      {msg && <StatusBox kind={msg.kind}>{msg.text}</StatusBox>}
      <SubmitButton onClick={submit} disabled={!ready || busy}>
        {busy ? "กำลังส่ง..." : "บันทึกการเบิก"}
      </SubmitButton>
    </>
  );
}

// ============================================================
// TAB 2 — รับเข้า
// ============================================================
function ReceiptForm({
  items,
  config,
}: {
  items: InventoryItem[];
  config: InventoryConfig;
}) {
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(10);
  const [receiverId, setReceiverId] = useState<number | "">("");
  const [source, setSource] = useState("");
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const item = items.find((i) => i.id === itemId);
  const ready = itemId !== "" && qty > 0 && receiverId !== "";

  function reset() {
    setItemId("");
    setQty(10);
    setReceiverId("");
    setSource("");
    setRemark("");
  }

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.createReceipt({
        itemId,
        qty,
        receiverId: Number(receiverId),
        source: source.trim() || undefined,
        remark: remark.trim() || undefined,
      });
      setMsg({
        kind: "ok",
        text: `บันทึกการรับเข้า ${item?.name ?? itemId} จำนวน ${qty} ${item?.unit ?? ""} สำเร็จ`,
      });
      reset();
    } catch (e) {
      setMsg({ kind: "err", text: (e as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="ข้อมูลการรับเข้า" icon="▦">
        <Field label="วัสดุที่รับเข้า" required>
          <ItemSelect items={items} value={itemId} onChange={setItemId} />
        </Field>
        <Field label="จำนวน" required>
          <Stepper value={qty} onChange={setQty} />
        </Field>
        <Field label="ผู้รับเข้า" required>
          <EmployeeSelect
            employees={config.employees}
            value={receiverId}
            onChange={setReceiverId}
          />
        </Field>
        <Field label="เลข PO / Supplier">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="เช่น PO-2026-001"
            className={inputCls}
          />
        </Field>
      </Card>

      <Card title="หมายเหตุ" icon="✎">
        <Textarea value={remark} onChange={setRemark} />
      </Card>

      <ReqNote />
      {msg && <StatusBox kind={msg.kind}>{msg.text}</StatusBox>}
      <SubmitButton onClick={submit} disabled={!ready || busy}>
        {busy ? "กำลังส่ง..." : "บันทึกการรับเข้า"}
      </SubmitButton>
    </>
  );
}

// ============================================================
// TAB 3 — สต็อค
// ============================================================
function StockPanel({ active }: { active: boolean }) {
  const [list, setList] = useState<StockStatus[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setList(await api.getStock());
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  return (
    <>
      <button
        onClick={load}
        className="w-full h-[42px] rounded-lg bg-graphite-surface-2 border-[0.5px] border-hairline-strong text-shift-blue-text text-sm mb-3"
      >
        ↻ รีเฟรชสต็อค
      </button>

      {loading && <div className="text-center text-ink-muted py-5">กำลังโหลด...</div>}
      {err && <StatusBox kind="err">{err}</StatusBox>}
      {!loading && !err && list?.length === 0 && (
        <div className="text-center text-ink-faint py-8 text-sm">
          ยังไม่มีข้อมูลสต็อค — เพิ่มวัสดุใน item_master ก่อน
        </div>
      )}
      {list?.map((s) => (
        <StockCard key={s.id} s={s} />
      ))}
    </>
  );
}

function StockCard({ s }: { s: StockStatus }) {
  const tier =
    s.status === "สั่งซื้อด่วน"
      ? {
          card: "bg-alert-rose-bg border-alert-rose-text/30",
          badge: "bg-alert-rose-text/15 text-alert-rose-text",
          icon: "⚠",
        }
      : s.status === "ใกล้หมด"
        ? {
            card: "bg-amber-warning-bg border-amber-warning-border",
            badge: "bg-amber-warning-text/15 text-amber-warning-text",
            icon: "●",
          }
        : {
            card: "bg-graphite-surface-2 border-hairline",
            badge: "bg-confirm-green-bg text-confirm-green-text",
            icon: "✓",
          };

  return (
    <div className={`border-[0.5px] rounded-xl p-3.5 mb-2.5 ${tier.card}`}>
      <div className="flex justify-between items-center mb-2.5">
        <div className="text-base font-medium">{s.name}</div>
        <div className={`text-xs font-medium px-2.5 py-1 rounded-md ${tier.badge}`}>
          {tier.icon} {s.status}
        </div>
      </div>
      <div className="text-[32px] font-medium my-2 leading-none">
        {s.balance.toLocaleString()}
        <span className="text-sm text-ink-muted font-normal ml-1">{s.unit}</span>
      </div>
      <div className="flex justify-between text-xs text-ink-muted pt-2.5 border-t-[0.5px] border-hairline">
        <span>
          รับเข้า <b className="text-ink font-medium">{s.totalIn.toLocaleString()}</b>
        </span>
        <span>
          เบิกออก <b className="text-ink font-medium">{s.totalOut.toLocaleString()}</b>
        </span>
        <span>
          จุดสั่งซื้อ <b className="text-ink font-medium">{s.reorderPoint}</b>
        </span>
      </div>
      <div className="text-[10px] text-ink-faint mt-1.5 text-right">
        อัปเดต: {fmtDate(s.lastUpdated)}
      </div>
    </div>
  );
}

// ============================================================
// Shared bits
// ============================================================
const inputCls =
  "w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-base text-ink placeholder:text-ink-faint outline-none [color-scheme:dark] appearance-none";

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-graphite-surface border-[0.5px] border-hairline rounded-[14px] p-3.5 mb-3.5">
      <div className="flex items-center gap-2 text-[15px] font-medium mb-3">
        <span className="text-shift-blue-text text-lg">{icon}</span> {title}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`mb-3 last:mb-0 ${className}`}>
      <label className={`block text-xs mb-1.5 ${required ? "text-ink" : "text-ink-muted"}`}>
        {label}
        {required && <span className="text-alert-rose-text"> *</span>}
      </label>
      {children}
    </div>
  );
}

function ItemSelect({
  items,
  value,
  onChange,
}: {
  items: InventoryItem[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      <option value="">เลือก...</option>
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
        </option>
      ))}
    </select>
  );
}

function EmployeeSelect({
  employees,
  value,
  onChange,
}: {
  employees: InventoryConfig["employees"];
  value: number | "";
  onChange: (v: number | "") => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      className={inputCls}
    >
      <option value="">เลือก...</option>
      {employees.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ))}
    </select>
  );
}

function MachineSelect({
  machines,
  value,
  onChange,
}: {
  machines: InventoryConfig["machines"];
  value: number | "";
  onChange: (v: number | "") => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      className={inputCls}
    >
      <option value="">-</option>
      {machines.map((m) => (
        <option key={m.id} value={m.id}>
          {m.code}
        </option>
      ))}
    </select>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(v < 1 ? 1 : v);
  return (
    <div className="flex">
      <button
        onClick={() => set(value - 1)}
        className="w-12 h-12 shrink-0 bg-graphite-surface-2 border-[0.5px] border-hairline-strong border-r-0 rounded-l-lg text-2xl"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={1}
        onChange={(e) => set(parseInt(e.target.value) || 1)}
        className="w-full min-w-0 bg-graphite-night border-[0.5px] border-hairline-strong border-x-0 text-center text-base text-ink h-12 outline-none [color-scheme:dark] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        onClick={() => set(value + 1)}
        className="w-12 h-12 shrink-0 bg-graphite-surface-2 border-[0.5px] border-hairline-strong border-l-0 rounded-r-lg text-2xl"
      >
        +
      </button>
    </div>
  );
}

function Textarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      placeholder="ไม่บังคับ"
      className="w-full rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong p-2.5 text-base text-ink placeholder:text-ink-faint outline-none resize-y"
    />
  );
}

function StatusBox({
  kind,
  children,
}: {
  kind: "ok" | "err";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg px-3 py-3 text-center text-[15px] font-medium mb-2.5 ${
        kind === "ok"
          ? "bg-confirm-green-bg text-confirm-green-text"
          : "bg-alert-rose-bg text-alert-rose-text"
      }`}
    >
      {children}
    </div>
  );
}

function SubmitButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full h-14 rounded-xl bg-shift-blue text-white text-[17px] font-medium mb-5 disabled:bg-graphite-surface-2 disabled:text-ink-faint"
    >
      {children}
    </button>
  );
}

function ReqNote() {
  return (
    <p className="text-center text-alert-rose-text text-[13px] font-medium my-3.5">
      * กรุณากรอกช่องที่มีดอกจันให้ครบถ้วน
    </p>
  );
}

// วันที่ไทยอ่านง่าย: dd/MM/yyyy HH:mm
function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
