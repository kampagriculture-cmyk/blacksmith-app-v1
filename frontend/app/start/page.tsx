"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { EMPLOYEES } from "@/lib/employees";
import { BackLink } from "@/components/BackLink";

const MACHINES = [
  { id: 1, label: "SG-01" },
  { id: 2, label: "SG-02" },
];

const KNIVES = [
  { id: 1, label: "474" },
  { id: 2, label: "830" },
  { id: 3, label: "146" },
];

export default function StartPage() {
  const [machineId, setMachineId] = useState<number | "">("");
  const [knifeId, setKnifeId] = useState<number | "">("");
  const [operatorId, setOperatorId] = useState<number | "">("");
  const [lotNo, setLotNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const ready =
    machineId !== "" && knifeId !== "" && operatorId !== "" && lotNo.trim() !== "";

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setMsg(null);

    try {
      const log = await api.start({
        machineId: Number(machineId),
        knifeId: Number(knifeId),
        operatorId: Number(operatorId),
        lotNo: lotNo.trim(),
        // ★ ไม่ส่ง startedAt — server ใช้เวลาปัจจุบันตอนกดจริง
      });
      setMsg({ kind: "ok", text: `เปิดงานสำเร็จ — log id ${log.id} / lot ${log.lot_no}` });
      setLotNo("");
      setKnifeId("");
    } catch (e) {
      const err = e as ApiError;
      setMsg({
        kind: "err",
        text: err.status === 409 ? `เปิดงานไม่ได้: ${err.message}` : err.message,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-graphite-night text-ink p-4">
      <BackLink />
      <h1 className="text-2xl font-bold mb-6">เปิดงาน</h1>

      <div className="space-y-5 max-w-md">
        <Field label="เครื่อง">
          <div className="grid grid-cols-2 gap-3">
            {MACHINES.map((m) => (
              <Choice key={m.id} active={machineId === m.id} onClick={() => setMachineId(m.id)}>
                {m.label}
              </Choice>
            ))}
          </div>
        </Field>

        <Field label="มีด">
          <div className="grid grid-cols-3 gap-3">
            {KNIVES.map((k) => (
              <Choice key={k.id} active={knifeId === k.id} onClick={() => setKnifeId(k.id)}>
                {k.label}
              </Choice>
            ))}
          </div>
        </Field>

        <Field label="พนักงาน">
          <div className="grid grid-cols-2 gap-3">
            {EMPLOYEES.map((e) => (
              <Choice key={e.id} active={operatorId === e.id} onClick={() => setOperatorId(e.id)}>
                {e.label}
              </Choice>
            ))}
          </div>
        </Field>

        <Field label="เลขล็อต (lot no.)">
          <input
            type="text"
            inputMode="text"
            value={lotNo}
            onChange={(ev) => setLotNo(ev.target.value)}
            placeholder="เช่น LOT-20260717-01"
            className="w-full h-14 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-4 text-lg text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-shift-blue-text"
          />
        </Field>

        <button
          onClick={submit}
          disabled={!ready || busy}
          className="w-full h-16 rounded-xl bg-shift-blue text-white text-lg font-bold hover:bg-shift-blue/90 disabled:bg-graphite-surface-2 disabled:text-ink-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-shift-blue-text"
        >
          {busy ? "กำลังบันทึก..." : "เปิดงาน"}
        </button>

        {msg && (
          <div
            className={`rounded-xl p-4 text-base ${
              msg.kind === "ok"
                ? "bg-confirm-green-bg text-confirm-green-text border-[0.5px] border-confirm-green-text/40"
                : "bg-alert-rose-bg text-alert-rose-text border-[0.5px] border-alert-rose-text/40"
            }`}
          >
            {msg.text}
          </div>
        )}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm text-ink-muted mb-2">{label}</div>
      {children}
    </div>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-14 rounded-lg border-[0.5px] text-lg font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-shift-blue-text ${
        active
          ? "bg-shift-blue border-shift-blue text-white"
          : "bg-graphite-surface-2 border-hairline-strong text-ink"
      }`}
    >
      {children}
    </button>
  );
}