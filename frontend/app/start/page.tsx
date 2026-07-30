"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type LotCheckResult, type ProductionLogConfig } from "@/lib/api";
import { BackLink } from "@/components/BackLink";

export default function StartPage() {
  const [config, setConfig] = useState<ProductionLogConfig | null>(null);
  const [configErr, setConfigErr] = useState<string | null>(null);
  const [machineId, setMachineId] = useState<number | "">("");
  const [knifeId, setKnifeId] = useState<number | "">("");
  const [operatorId, setOperatorId] = useState<number | "">("");
  const [lotNo, setLotNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [lotCheck, setLotCheck] = useState<"idle" | "checking" | "done" | "ok">("idle");
  const [conflictingLog, setConflictingLog] = useState<LotCheckResult["log"]>(null);

  // ★ ดึงรายชื่อเครื่อง/มีด/พนักงานสดจาก backend แทนของ hardcode เดิม
  useEffect(() => {
    api
      .getProductionLogConfig()
      .then(setConfig)
      .catch((e) => setConfigErr((e as ApiError).message));
  }, []);

  // ★ เช็คเลขล็อตซ้ำแบบ live — รอ 500ms หลังพิมพ์เสร็จค่อยถาม backend
  // (backend เองก็เช็คซ้ำตอน submit อยู่แล้ว อันนี้แค่ให้เห็นก่อนกดปุ่ม)
  useEffect(() => {
    const trimmed = lotNo.trim();
    if (!trimmed) {
      setLotCheck("idle");
      setConflictingLog(null);
      return;
    }
    setLotCheck("checking");
    const t = setTimeout(async () => {
      try {
        const result = await api.checkLot(trimmed);
        setLotCheck(result.done ? "done" : "ok");
        setConflictingLog(result.log);
      } catch {
        setLotCheck("idle"); // เช็ค live ล้มเหลว — ปล่อยผ่าน ให้ backend กันตอน submit แทน
        setConflictingLog(null);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [lotNo]);

  const ready =
    machineId !== "" &&
    knifeId !== "" &&
    operatorId !== "" &&
    lotNo.trim() !== "" &&
    lotCheck !== "done";

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
      setLotCheck("idle");
      setConflictingLog(null);
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

  if (configErr) {
    return (
      <main className="min-h-screen bg-graphite-night text-ink p-4">
        <BackLink />
        <h1 className="text-2xl font-bold mb-6">เปิดงาน</h1>
        <div className="rounded-xl p-4 text-base max-w-md bg-alert-rose-bg text-alert-rose-text border-[0.5px] border-alert-rose-text/40">
          {configErr}
        </div>
      </main>
    );
  }

  if (!config) {
    return (
      <main className="min-h-screen bg-graphite-night text-ink p-4">
        <BackLink />
        <h1 className="text-2xl font-bold mb-6">เปิดงาน</h1>
        <div className="text-ink-faint">กำลังโหลด...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-graphite-night text-ink p-4">
      <BackLink />
      <h1 className="text-2xl font-bold mb-6">เปิดงาน</h1>

      <div className="space-y-5 max-w-md">
        <Field label="เครื่อง">
          <div className="grid grid-cols-2 gap-3">
            {config.machines.map((m) => (
              <Choice key={m.id} active={machineId === m.id} onClick={() => setMachineId(m.id)}>
                {m.code}
              </Choice>
            ))}
          </div>
        </Field>

        <Field label="มีด">
          <div className="grid grid-cols-3 gap-3">
            {config.knives.map((k) => (
              <Choice key={k.id} active={knifeId === k.id} onClick={() => setKnifeId(k.id)}>
                {k.code}
              </Choice>
            ))}
          </div>
        </Field>

        <Field label="พนักงาน">
          <div className="grid grid-cols-2 gap-3">
            {config.employees.map((e) => (
              <Choice key={e.id} active={operatorId === e.id} onClick={() => setOperatorId(e.id)}>
                {e.name}
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
            className={`w-full h-14 rounded-lg bg-graphite-night border-[0.5px] px-4 text-lg text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-shift-blue-text ${
              lotCheck === "done" ? "border-alert-rose-text" : "border-hairline-strong"
            }`}
          />
          {lotCheck === "checking" && (
            <div className="text-sm text-ink-faint mt-2">กำลังตรวจสอบ...</div>
          )}
          {lotCheck === "done" && (
            <div className="rounded-xl p-3 text-sm mt-2 bg-alert-rose-bg text-alert-rose-text border-[0.5px] border-alert-rose-text/40">
              {conflictingLog?.status === "in_progress"
                ? `ล็อตนี้ (${lotNo.trim()}) กำลังทำอยู่ที่เครื่อง ${conflictingLog.machines?.code ?? "?"} — ตรวจสอบเลขล็อตอีกครั้ง`
                : `ล็อตนี้ (${lotNo.trim()}) เสร็จงานไปแล้ว — ตรวจสอบเลขล็อตอีกครั้ง`}
            </div>
          )}
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