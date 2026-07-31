"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type ProductionLogConfig,
  type RecordRow,
  type RecordsResponse,
  type RecordTuneRound,
} from "@/lib/api";
import { BackLink } from "@/components/BackLink";

// ★ วันที่/เวลาในระบบเก็บแบบ UTC-literal (ตัวเลขดิบจากชีตเดิม ไม่ปรับ timezone จริง —
// ดู note เดียวกันใน analytics/page.tsx) ใช้ UTC getters/setters ทุกที่ที่นี่เพื่อให้
// round-trip ตรงกับค่าที่แสดง ไม่เลื่อนไปตาม timezone ของเบราว์เซอร์

function toDatetimeLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function fromDatetimeLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  return new Date(`${v}:00Z`).toISOString();
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()} ${hh}:${mi}`;
}

export default function RecordsPage() {
  const [config, setConfig] = useState<ProductionLogConfig | null>(null);
  const [resp, setResp] = useState<RecordsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [machineId, setMachineId] = useState<number | "">("");
  const [operatorId, setOperatorId] = useState<number | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [selected, setSelected] = useState<RecordRow | null>(null);

  useEffect(() => {
    api.getProductionLogConfig().catch(() => null).then((c) => c && setConfig(c));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getRecords({
        page,
        limit: 20,
        machineId: machineId || undefined,
        operatorId: operatorId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setResp(res);
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [page, machineId, operatorId, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="min-h-screen bg-graphite-night text-ink p-4">
      <BackLink />
      <h1 className="text-2xl font-bold mb-6">ประวัติบันทึกการผลิต</h1>

      {/* ===== Filter bar ===== */}
      <div className="rounded-lg bg-graphite-surface border-[0.5px] border-hairline p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-ink-muted mb-1">เครื่อง</label>
          <select
            value={machineId}
            onChange={(e) => {
              setMachineId(e.target.value === "" ? "" : Number(e.target.value));
              setPage(1);
            }}
            className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
          >
            <option value="">ทุกเครื่อง</option>
            {config?.machines.map((m) => (
              <option key={m.id} value={m.id}>{m.code}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">พนักงาน</label>
          <select
            value={operatorId}
            onChange={(e) => {
              setOperatorId(e.target.value === "" ? "" : Number(e.target.value));
              setPage(1);
            }}
            className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
          >
            <option value="">ทุกคน</option>
            {config?.employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">ตั้งแต่วันที่</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">ถึงวันที่</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
          />
        </div>
      </div>

      {err && (
        <div className="rounded-xl p-4 text-base mb-4 bg-alert-rose-bg text-alert-rose-text border-[0.5px] border-alert-rose-text/40">
          {err}
        </div>
      )}

      {/* ===== Table ===== */}
      <div className="rounded-lg border-[0.5px] border-hairline overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-graphite-surface-2 text-ink-muted">
              <th className="p-3 text-left font-medium">ล็อต</th>
              <th className="p-3 text-left font-medium">เครื่อง</th>
              <th className="p-3 text-left font-medium">พนักงาน</th>
              <th className="p-3 text-left font-medium">หัวหน้า</th>
              <th className="p-3 text-left font-medium">มีด</th>
              <th className="p-3 text-right font-medium">ยอดผลิต</th>
              <th className="p-3 text-right font-medium">ของดี</th>
              <th className="p-3 text-right font-medium">ของเสีย</th>
              <th className="p-3 text-left font-medium">เปลี่ยนหิน</th>
              <th className="p-3 text-left font-medium">รอบจูน</th>
              <th className="p-3 text-left font-medium">QC</th>
              <th className="p-3 text-left font-medium">วันที่จบงาน</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={13} className="p-6 text-center text-ink-faint">กำลังโหลด...</td></tr>
            )}
            {!loading && resp?.data.length === 0 && (
              <tr><td colSpan={13} className="p-6 text-center text-ink-faint">ไม่มีข้อมูลตามเงื่อนไขที่เลือก</td></tr>
            )}
            {!loading && resp?.data.map((r) => (
              <tr
                key={r.id}
                onClick={() => setSelected(r)}
                className="border-t-[0.5px] border-hairline bg-graphite-surface hover:bg-graphite-surface-2 cursor-pointer transition-colors"
              >
                <td className="p-3">
                  {r.lot_no}
                  {r.version > 1 && (
                    <span className="ml-2 text-xs text-amber-warning-text">แก้ไขแล้ว ×{r.version - 1}</span>
                  )}
                </td>
                <td className="p-3">{r.machine.code}</td>
                <td className="p-3">{r.operator.name}</td>
                <td className="p-3 text-ink-muted">{r.supervisor?.name ?? "-"}</td>
                <td className="p-3">{r.knife.code}</td>
                <td className="p-3 text-right">{r.total_qty.toLocaleString()}</td>
                <td className="p-3 text-right text-confirm-green-text">{r.good_qty.toLocaleString()}</td>
                <td className="p-3 text-right text-alert-rose-text">{r.defect_qty.toLocaleString()}</td>
                <td className="p-3">
                  {r.stone_change ? (
                    <span className="text-amber-warning-text">
                      ✓ {r.stone_change.downtimeStart && r.stone_change.downtimeEnd
                        ? `${r.stone_change.downtimeStart}-${r.stone_change.downtimeEnd}`
                        : `ก่อน ${r.stone_change.qtyBeforeChange.toLocaleString()}`}
                    </span>
                  ) : (
                    <span className="text-ink-faint">-</span>
                  )}
                </td>
                <td className="p-3">
                  {r.tune_rounds.length > 0 ? (
                    <span className="text-shift-blue-text">{r.tune_rounds.length} รอบ</span>
                  ) : (
                    <span className="text-ink-faint">-</span>
                  )}
                </td>
                <td className="p-3">
                  {r.qc_approved === true && <span className="text-confirm-green-text">ผ่าน</span>}
                  {r.qc_approved === false && <span className="text-alert-rose-text">ไม่ผ่าน</span>}
                  {r.qc_approved === null && <span className="text-ink-faint">-</span>}
                </td>
                <td className="p-3 text-ink-muted">{fmtDateTime(r.ended_at)}</td>
                <td className="p-3 text-shift-blue-text text-right whitespace-nowrap">แก้ไข →</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ===== Pagination ===== */}
      {resp && resp.pagination.total_pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="h-10 px-4 rounded-lg bg-graphite-surface-2 text-ink disabled:text-ink-faint disabled:cursor-not-allowed"
          >
            ◀ ก่อนหน้า
          </button>
          <span className="text-ink-muted text-sm">
            หน้า {resp.pagination.page} / {resp.pagination.total_pages} ({resp.pagination.total.toLocaleString()} รายการ)
          </span>
          <button
            disabled={page >= resp.pagination.total_pages}
            onClick={() => setPage((p) => Math.min(resp.pagination.total_pages, p + 1))}
            className="h-10 px-4 rounded-lg bg-graphite-surface-2 text-ink disabled:text-ink-faint disabled:cursor-not-allowed"
          >
            ถัดไป ▶
          </button>
        </div>
      )}

      {selected && config && (
        <EditModal
          record={selected}
          config={config}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </main>
  );
}

// ============================================================

function EditModal({
  record,
  config,
  onClose,
  onSaved,
}: {
  record: RecordRow;
  config: ProductionLogConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [machineId, setMachineId] = useState<number>(record.machine.id);
  const [knifeId, setKnifeId] = useState<number>(record.knife.id);
  const [lotNo, setLotNo] = useState(record.lot_no);
  const [status, setStatus] = useState<"in_progress" | "completed">(record.status as "in_progress" | "completed");
  const [startedAt, setStartedAt] = useState(toDatetimeLocalInput(record.started_at));
  const [endedAt, setEndedAt] = useState(toDatetimeLocalInput(record.ended_at));
  const [totalQty, setTotalQty] = useState(String(record.total_qty));
  const [operatorId, setOperatorId] = useState<number>(record.operator.id);
  const [supervisorId, setSupervisorId] = useState<number | "">(record.supervisor?.id ?? "");
  const [editedBy, setEditedBy] = useState<number | "">("");
  const [editReason, setEditReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmLotInput, setConfirmLotInput] = useState("");

  // ===== เปลี่ยนหิน — เพิ่มเข้ามาเพราะบางครั้งลืมกรอกตอน checkout จริง =====
  const [isStoneChange, setIsStoneChange] = useState(record.stone_change !== null);
  const [qtyBeforeChange, setQtyBeforeChange] = useState(String(record.stone_change?.qtyBeforeChange ?? ""));
  const [sizeLeft, setSizeLeft] = useState(record.stone_change?.sizeLeft ?? "");
  const [sizeRight, setSizeRight] = useState(record.stone_change?.sizeRight ?? "");
  const [stoneDtStart, setStoneDtStart] = useState(record.stone_change?.downtimeStart ?? "");
  const [stoneDtEnd, setStoneDtEnd] = useState(record.stone_change?.downtimeEnd ?? "");

  // ===== รอบจูน — same reason, painpoint ที่สุดที่ operator ลืมกรอก =====
  const [tuneRounds, setTuneRounds] = useState<RecordTuneRound[]>(record.tune_rounds);

  function addTuneRound() {
    setTuneRounds((p) => [...p, { roundNo: p.length + 1, startTime: "", endTime: "" }]);
  }
  function updateTuneRound(idx: number, patch: Partial<RecordTuneRound>) {
    setTuneRounds((p) => p.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function removeTuneRound(idx: number) {
    setTuneRounds((p) => p.filter((_, i) => i !== idx).map((r, i) => ({ ...r, roundNo: i + 1 })));
  }

  const totalQtyNum = parseInt(totalQty, 10);
  const qtyBeforeChangeNum = parseInt(qtyBeforeChange, 10);

  const stoneChangeNow = isStoneChange
    ? {
        qtyBeforeChange: qtyBeforeChangeNum,
        sizeLeft: sizeLeft.trim() || undefined,
        sizeRight: sizeRight.trim() || undefined,
        downtimeStart: stoneDtStart || undefined,
        downtimeEnd: stoneDtEnd || undefined,
      }
    : null;
  const stoneChangeUnchanged =
    (record.stone_change === null && !isStoneChange) ||
    (record.stone_change !== null &&
      isStoneChange &&
      record.stone_change.qtyBeforeChange === qtyBeforeChangeNum &&
      (record.stone_change.sizeLeft ?? "") === sizeLeft.trim() &&
      (record.stone_change.sizeRight ?? "") === sizeRight.trim() &&
      (record.stone_change.downtimeStart ?? "") === stoneDtStart &&
      (record.stone_change.downtimeEnd ?? "") === stoneDtEnd);

  const tuneRoundsUnchanged = JSON.stringify(tuneRounds) === JSON.stringify(record.tune_rounds);
  const brokenTuneRound = tuneRounds.find((r) => !r.startTime || !r.endTime);

  const changed =
    machineId !== record.machine.id ||
    knifeId !== record.knife.id ||
    lotNo !== record.lot_no ||
    status !== record.status ||
    startedAt !== toDatetimeLocalInput(record.started_at) ||
    endedAt !== toDatetimeLocalInput(record.ended_at) ||
    totalQtyNum !== record.total_qty ||
    operatorId !== record.operator.id ||
    supervisorId !== (record.supervisor?.id ?? "") ||
    !stoneChangeUnchanged ||
    !tuneRoundsUnchanged;

  const invalidQty = totalQty === "" || isNaN(totalQtyNum) || totalQtyNum < 0 || totalQtyNum < record.defect_qty;
  const invalidLot = lotNo.trim() === "";
  const invalidStoneChange = isStoneChange && (qtyBeforeChange === "" || isNaN(qtyBeforeChangeNum) || qtyBeforeChangeNum < 0);
  const ready =
    changed && editedBy !== "" && editReason.trim() !== "" &&
    !invalidQty && !invalidLot && !invalidStoneChange && !brokenTuneRound;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const editorName = config.employees.find((e) => e.id === editedBy)?.name ?? "";
      await api.updateLog(record.id, {
        machineId: machineId !== record.machine.id ? machineId : undefined,
        knifeId: knifeId !== record.knife.id ? knifeId : undefined,
        lotNo: lotNo !== record.lot_no ? lotNo.trim() : undefined,
        status: status !== record.status ? status : undefined,
        startedAt: startedAt !== toDatetimeLocalInput(record.started_at) ? fromDatetimeLocalInput(startedAt) : undefined,
        endedAt: endedAt !== toDatetimeLocalInput(record.ended_at) ? fromDatetimeLocalInput(endedAt) : undefined,
        totalQty: totalQtyNum !== record.total_qty ? totalQtyNum : undefined,
        operatorId: operatorId !== record.operator.id ? operatorId : undefined,
        supervisorId: supervisorId !== (record.supervisor?.id ?? "") && supervisorId !== "" ? supervisorId : undefined,
        stoneChange: stoneChangeUnchanged ? undefined : stoneChangeNow,
        tuneRounds: tuneRoundsUnchanged ? undefined : tuneRounds,
        editedBy: editorName,
        editReason: editReason.trim(),
      });
      setMsg({ kind: "ok", text: "บันทึกการแก้ไขสำเร็จ" });
      setTimeout(onSaved, 700);
    } catch (e) {
      setMsg({ kind: "err", text: (e as ApiError).message });
      setBusy(false);
    }
  }

  const deleteReady = editedBy !== "" && editReason.trim() !== "" && confirmLotInput.trim() === record.lot_no;

  async function deleteRecord() {
    if (!deleteReady || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const deleterName = config.employees.find((e) => e.id === editedBy)?.name ?? "";
      await api.deleteLog(record.id, { deletedBy: deleterName, deleteReason: editReason.trim() });
      setMsg({ kind: "ok", text: "ลบข้อมูลสำเร็จ" });
      setTimeout(onSaved, 700);
    } catch (e) {
      setMsg({ kind: "err", text: (e as ApiError).message });
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg bg-graphite-surface border-[0.5px] border-hairline p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4">แก้ไขข้อมูล — ล็อต {record.lot_no}</h2>

        <div className="space-y-3 mb-4">
          <Field label="เครื่อง">
            <select
              value={machineId}
              onChange={(e) => setMachineId(Number(e.target.value))}
              className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
            >
              {config.machines.map((m) => (
                <option key={m.id} value={m.id}>{m.code}</option>
              ))}
            </select>
          </Field>
          <Field label="มีด">
            <select
              value={knifeId}
              onChange={(e) => setKnifeId(Number(e.target.value))}
              className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
            >
              {config.knives.map((k) => (
                <option key={k.id} value={k.id}>{k.code}</option>
              ))}
            </select>
          </Field>
          <Field label="เลขล็อต (lot no.)">
            <input
              type="text"
              value={lotNo}
              onChange={(e) => setLotNo(e.target.value)}
              className={`w-full h-12 rounded-lg bg-graphite-night border-[0.5px] px-3 text-ink ${invalidLot ? "border-alert-rose-text" : "border-hairline-strong"}`}
            />
          </Field>
          <Field label="สถานะ">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "in_progress" | "completed")}
              className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
            >
              <option value="completed">completed</option>
              <option value="in_progress">in_progress</option>
            </select>
          </Field>
          <Field label="เวลาเริ่มงาน">
            <input
              type="datetime-local"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
              className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
            />
          </Field>
          <Field label="เวลาจบงาน">
            <input
              type="datetime-local"
              value={endedAt}
              onChange={(e) => setEndedAt(e.target.value)}
              className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
            />
          </Field>
          <Field label="จำนวนทั้งหมด">
            <input
              type="number"
              value={totalQty}
              onChange={(e) => setTotalQty(e.target.value)}
              className={`w-full h-12 rounded-lg bg-graphite-night border-[0.5px] px-3 text-ink ${invalidQty ? "border-alert-rose-text" : "border-hairline-strong"}`}
            />
            {invalidQty && totalQty !== "" && (
              <div className="text-xs text-alert-rose-text mt-1">
                ต้องไม่ติดลบ และต้องไม่น้อยกว่ายอดของเสียที่บันทึกไว้ ({record.defect_qty.toLocaleString()})
              </div>
            )}
          </Field>
          <Field label="พนักงาน">
            <select
              value={operatorId}
              onChange={(e) => setOperatorId(Number(e.target.value))}
              className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
            >
              {config.employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </Field>
          <Field label="หัวหน้างาน">
            <select
              value={supervisorId}
              onChange={(e) => setSupervisorId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
            >
              <option value="">ไม่ระบุ</option>
              {config.employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="text-xs text-ink-muted mb-2 pt-2 border-t-[0.5px] border-hairline">การเปลี่ยนหิน</div>
        <div className="space-y-3 mb-4">
          <div className="flex gap-2">
            <button
              onClick={() => setIsStoneChange(false)}
              className={`flex-1 h-11 rounded-lg text-sm border-[0.5px] ${!isStoneChange ? "bg-shift-blue border-shift-blue text-white" : "bg-graphite-surface-2 border-hairline-strong text-ink"}`}
            >
              ไม่เปลี่ยน
            </button>
            <button
              onClick={() => setIsStoneChange(true)}
              className={`flex-1 h-11 rounded-lg text-sm border-[0.5px] ${isStoneChange ? "bg-shift-blue border-shift-blue text-white" : "bg-graphite-surface-2 border-hairline-strong text-ink"}`}
            >
              เปลี่ยนหิน
            </button>
          </div>
          {isStoneChange && (
            <>
              <Field label="ยอดก่อนเปลี่ยนหิน">
                <input
                  type="number"
                  value={qtyBeforeChange}
                  onChange={(e) => setQtyBeforeChange(e.target.value)}
                  className={`w-full h-12 rounded-lg bg-graphite-night border-[0.5px] px-3 text-ink ${invalidStoneChange ? "border-alert-rose-text" : "border-hairline-strong"}`}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="ขนาดหินซ้าย">
                  <input type="text" value={sizeLeft} onChange={(e) => setSizeLeft(e.target.value)} placeholder="380"
                    className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink" />
                </Field>
                <Field label="ขนาดหินขวา">
                  <input type="text" value={sizeRight} onChange={(e) => setSizeRight(e.target.value)} placeholder="380"
                    className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="เริ่มพักเครื่อง">
                  <input type="time" value={stoneDtStart} onChange={(e) => setStoneDtStart(e.target.value)}
                    className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink" />
                </Field>
                <Field label="จบพักเครื่อง">
                  <input type="time" value={stoneDtEnd} onChange={(e) => setStoneDtEnd(e.target.value)}
                    className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink" />
                </Field>
              </div>
            </>
          )}
        </div>

        <div className="text-xs text-ink-muted mb-2 pt-2 border-t-[0.5px] border-hairline flex items-center justify-between">
          <span>เวลาปรับจูน MC</span>
          <button onClick={addTuneRound} className="text-shift-blue-text text-xs">+ เพิ่มรอบจูน</button>
        </div>
        <div className="space-y-2 mb-4">
          {tuneRounds.length === 0 && (
            <div className="text-xs text-ink-faint py-2">ไม่มีรอบจูนที่บันทึกไว้ — กด &ldquo;+ เพิ่มรอบจูน&rdquo; ถ้าลืมกรอกตอน checkout</div>
          )}
          {tuneRounds.map((r, idx) => (
            <div key={idx} className="flex items-end gap-2">
              <span className="text-xs text-ink-muted w-5 pb-3">{idx + 1}</span>
              <div className="flex-1">
                <label className="block text-xs text-ink-muted mb-1">เริ่ม</label>
                <input type="time" value={r.startTime} onChange={(e) => updateTuneRound(idx, { startTime: e.target.value })}
                  className="w-full h-11 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-ink-muted mb-1">จบ</label>
                <input type="time" value={r.endTime} onChange={(e) => updateTuneRound(idx, { endTime: e.target.value })}
                  className="w-full h-11 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink" />
              </div>
              <button onClick={() => removeTuneRound(idx)} className="h-11 w-11 rounded-lg bg-graphite-surface-2 text-alert-rose-text">×</button>
            </div>
          ))}
          {brokenTuneRound && (
            <div className="text-xs text-alert-rose-text">ทุกรอบจูนต้องกรอกเวลาเริ่มและจบให้ครบ</div>
          )}
        </div>

        <div className="text-xs text-ink-muted mb-2 pt-2 border-t-[0.5px] border-hairline">ข้อมูล Audit</div>
        <div className="space-y-3 mb-4">
          <Field label="แก้ไขโดย *">
            <select
              value={editedBy}
              onChange={(e) => setEditedBy(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
            >
              <option value="">เลือกชื่อ...</option>
              {config.employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </Field>
          <Field label="เหตุผล *">
            <input
              type="text"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="ระบุเหตุผลที่แก้ไข เช่น นับยอดผิดตอน checkout"
              className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink"
            />
          </Field>
        </div>

        <div className="text-xs text-ink-muted mb-4">
          {record.version > 1
            ? `เวอร์ชันปัจจุบัน: ${record.version} (แก้ไขแล้ว ${record.version - 1} ครั้ง)`
            : "เวอร์ชันปัจจุบัน: 1 (ยังไม่เคยแก้ไข)"}
        </div>

        {msg && (
          <div
            className={`rounded-xl p-3 text-sm mb-4 ${
              msg.kind === "ok"
                ? "bg-confirm-green-bg text-confirm-green-text border-[0.5px] border-confirm-green-text/40"
                : "bg-alert-rose-bg text-alert-rose-text border-[0.5px] border-alert-rose-text/40"
            }`}
          >
            {msg.text}
          </div>
        )}

        <button
          onClick={submit}
          disabled={!ready || busy}
          className="w-full h-14 rounded-lg bg-shift-blue text-white font-bold disabled:bg-graphite-surface-2 disabled:text-ink-faint"
        >
          {busy ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
        </button>
        <button onClick={onClose} className="w-full h-10 mt-2 text-ink-muted text-sm">
          ยกเลิก
        </button>

        <div className="mt-6 pt-4 border-t-[0.5px] border-hairline">
          {!confirmingDelete ? (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="w-full h-10 text-alert-rose-text text-sm"
            >
              ลบข้อมูลนี้
            </button>
          ) : (
            <div className="rounded-lg bg-alert-rose-bg border-[0.5px] border-alert-rose-text/40 p-3">
              <div className="text-sm text-alert-rose-text font-medium mb-2">
                การลบไม่สามารถย้อนกลับได้จากหน้านี้ — ต้องเลือก &ldquo;แก้ไขโดย&rdquo; และ &ldquo;เหตุผล&rdquo; ด้านบนก่อน แล้วพิมพ์เลขล็อตเพื่อยืนยัน
              </div>
              <label className="block text-xs text-ink-muted mb-1">
                พิมพ์ &ldquo;{record.lot_no}&rdquo; เพื่อยืนยัน
              </label>
              <input
                type="text"
                value={confirmLotInput}
                onChange={(e) => setConfirmLotInput(e.target.value)}
                className="w-full h-12 rounded-lg bg-graphite-night border-[0.5px] border-hairline-strong px-3 text-ink mb-2"
              />
              <div className="flex gap-2">
                <button
                  onClick={deleteRecord}
                  disabled={!deleteReady || busy}
                  className="flex-1 h-12 rounded-lg bg-alert-rose-text text-graphite-night font-bold disabled:bg-graphite-surface-2 disabled:text-ink-faint"
                >
                  {busy ? "กำลังลบ..." : "ยืนยันการลบ"}
                </button>
                <button
                  onClick={() => { setConfirmingDelete(false); setConfirmLotInput(""); }}
                  className="h-12 px-4 rounded-lg bg-graphite-surface-2 text-ink"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-ink-muted mb-1">{label}</div>
      {children}
    </div>
  );
}

