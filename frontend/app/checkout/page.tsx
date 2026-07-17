"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type InProgressLog,
  type DefectEntry,
  type TuneRoundPayload,
} from "@/lib/api";
import { DEFECT_TYPES } from "@/lib/defect-types";
import { EMPLOYEES } from "@/lib/employees";
import { BackLink } from "@/components/BackLink";

// ===== คำนวณ downtime — ยกตรรกะจากฟอร์มเดิม (ข้ามเที่ยงคืน +1440) =====
function diffMinutes(start: string, end: string): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (isNaN(sh) || isNaN(eh)) return null;
  let d = eh * 60 + em - (sh * 60 + sm);
  if (d < 0) d += 1440;
  return d;
}

function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const mins = m % 60;
  return (h > 0 ? `${h} ชม. ` : "") + `${mins} นาที`;
}

// ★ วันนี้ตามเวลาเครื่อง ใช้เป็นค่า default ของ "วันที่จบงาน"
function todayYMD(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split("T")[0];
}

export default function CheckoutPage() {
  const [logs, setLogs] = useState<InProgressLog[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<InProgressLog | null>(null);

  const load = useCallback(async () => {
    try {
      setLogs(await api.getInProgress());
      setLoadErr(null);
    } catch (e) {
      setLoadErr((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (selected) {
    return (
      <CheckoutForm
        log={selected}
        onDone={() => {
          setSelected(null);
          load();
        }}
        onCancel={() => setSelected(null)}
      />
    );
  }

  return (
    <div style={S.body}>
      <div style={S.wrap}>
        <BackLink />
        <h2 style={S.title}>เลือกงานที่จะปิด</h2>

        {loadErr && <div style={S.errBox}>{loadErr}</div>}
        {loading && !loadErr && (
          <div style={{ ...S.section, textAlign: "center", color: V.text3 }}>
            กำลังโหลด...
          </div>
        )}
        {!loading && !loadErr && logs.length === 0 && (
          <div style={{ ...S.section, textAlign: "center", color: V.text3 }}>
            ไม่มีงานค้าง
          </div>
        )}

        {logs.map((l) => (
          <button
            key={l.id}
            onClick={() => setSelected(l)}
            style={{ ...S.section, ...S.pickBtn }}
          >
            <div style={S.pickHead}>
              <span style={{ fontSize: 18, fontWeight: 500, color: V.accentText }}>
                {l.machines?.code ?? `machine ${l.machine_id}`}
              </span>
              <span style={{ fontSize: 12, color: V.text3 }}>#{l.id}</span>
            </div>
            <div style={{ fontSize: 13, color: V.text2, marginTop: 4 }}>
              Lot {l.lot_no} · มีด {l.knives?.code ?? l.knife_id} ·{" "}
              {l.employees_production_logs_operator_idToemployees?.name ?? l.operator_id}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================

function CheckoutForm({
  log,
  onDone,
  onCancel,
}: {
  log: InProgressLog;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [endDate, setEndDate] = useState(todayYMD()); // ★ ใหม่ — แยกวันที่ออกจากเวลา
  const [endTime, setEndTime] = useState("");
  const [totalQty, setTotalQty] = useState("");
  const [defectQty, setDefectQty] = useState<Record<string, number>>({});
  const [supervisorId, setSupervisorId] = useState<number | "">("");
  // null = ยังไม่ตรวจ (ค่าเริ่มต้น) / true = ผ่าน / false = ไม่ผ่าน
const [qcApproved, setQcApproved] = useState<boolean | null>(null);
  const [remark, setRemark] = useState("");

  const [isStoneChange, setIsStoneChange] = useState(false);
  const [qtyBeforeChange, setQtyBeforeChange] = useState("");
  const [sizeLeft, setSizeLeft] = useState("");
  const [sizeRight, setSizeRight] = useState("");
  const [stoneStart, setStoneStart] = useState("");
  const [stoneEnd, setStoneEnd] = useState("");

  const [tuneRounds, setTuneRounds] = useState<TuneRoundPayload[]>([
    { roundNo: 1, startTime: "", endTime: "" },
  ]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ===== ยอดรวม — คำนวณสดเหมือนฟอร์มเดิม =====
  const totalNum = parseInt(totalQty) || 0;
  const ngSum = Object.values(defectQty).reduce((s, q) => s + (q || 0), 0);
  const goodQty = totalNum - ngSum;

  // ===== downtime เปลี่ยนหิน =====
  const stoneDt = diffMinutes(stoneStart, stoneEnd);

  // ===== downtime จูนรวม =====
  const tuneTotal = tuneRounds.reduce((sum, r) => {
    const d = diffMinutes(r.startTime, r.endTime);
    return sum + (d ?? 0);
  }, 0);
  const tuneFilled = tuneRounds.some((r) => r.startTime && r.endTime);

  const exceedTotal = totalQty !== "" && ngSum > totalNum;
  const ready =
    totalQty !== "" &&
    totalNum >= 0 &&
    supervisorId !== "" &&
    !exceedTotal &&
    endDate !== "";

  function adjustDefect(code: string, delta: number) {
    setDefectQty((p) => ({ ...p, [code]: Math.max(0, (p[code] ?? 0) + delta) }));
  }

  function setDefectDirect(code: string, v: string) {
    const n = parseInt(v);
    setDefectQty((p) => ({ ...p, [code]: isNaN(n) || n < 0 ? 0 : n }));
  }

  function addTuneRound() {
    setTuneRounds((p) => [...p, { roundNo: p.length + 1, startTime: "", endTime: "" }]);
  }

  function updateTuneRound(idx: number, patch: Partial<TuneRoundPayload>) {
    setTuneRounds((p) => p.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeTuneRound(idx: number) {
    setTuneRounds((p) =>
      p.filter((_, i) => i !== idx).map((r, i) => ({ ...r, roundNo: i + 1 })),
    );
  }

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setMsg(null);

    if (isStoneChange && qtyBeforeChange.trim() === "") {
      setMsg({ kind: "err", text: 'เลือก "เปลี่ยนหิน" แล้วต้องกรอกยอดก่อนเปลี่ยนหินด้วย' });
      setBusy(false);
      return;
    }

    // ★ รอบว่างทั้งคู่ = ข้ามได้ / กรอกข้างเดียว = error (ตรรกะเดียวกับ collectTuneData เดิม)
    const filledRounds = tuneRounds.filter((r) => r.startTime || r.endTime);
    const broken = filledRounds.find((r) => !r.startTime || !r.endTime);
    if (broken) {
      setMsg({ kind: "err", text: `รอบจูนรอบที่ ${broken.roundNo} กรอกเวลาไม่ครบ` });
      setBusy(false);
      return;
    }

    const defects: DefectEntry[] = Object.entries(defectQty)
      .filter(([, q]) => q > 0)
      .map(([code, qty]) => ({ code, qty }));

    // ★ รวม endDate + endTime ตรงๆ — ผู้ใช้ระบุวันชัดเจน ไม่ต้องเดาว่าข้ามเที่ยงคืนไหม
    let endedAt: string | undefined;
    if (endDate && endTime) {
      const end = new Date(`${endDate}T${endTime}:00`); // ตีความเป็นเวลาท้องถิ่นของ browser (ไทย)
      endedAt = end.toISOString();
    }

    // ★ กันกรอกวัน/เวลาจบ ย้อนก่อนเวลาเริ่มงาน
    if (endedAt && new Date(endedAt) < new Date(log.started_at)) {
      setMsg({ kind: "err", text: "วัน-เวลาจบงาน ต้องไม่ก่อนเวลาที่เปิดงานไว้" });
      setBusy(false);
      return;
    }

    try {
      await api.checkout(log.id, {
        totalQty: totalNum,
        supervisorId: Number(supervisorId),
        endedAt,
        qcApproved: qcApproved === null ? undefined : qcApproved,
        remark: remark.trim() || undefined,
        defects: defects.length ? defects : undefined,
        stoneChange: isStoneChange
          ? {
              qtyBeforeChange: Number(qtyBeforeChange),
              sizeLeft: sizeLeft.trim() || undefined,
              sizeRight: sizeRight.trim() || undefined,
              downtimeStart: stoneStart || undefined,
              downtimeEnd: stoneEnd || undefined,
            }
          : undefined,
        tuneRounds: filledRounds.length
          ? filledRounds.map((r, i) => ({ ...r, roundNo: i + 1 }))
          : undefined,
      });
      setMsg({ kind: "ok", text: "บันทึกข้อมูลเรียบร้อย" });
      setTimeout(onDone, 800);
    } catch (e) {
      const err = e as ApiError;
      setMsg({
        kind: "err",
        text: err.status === 409 ? `ปิดงานไม่ได้: ${err.message}` : err.message,
      });
      setBusy(false);
    }
  }

  return (
    <div style={S.body}>
      <div style={S.wrap}>
        <button onClick={onCancel} style={S.backBtn}>
          ← กลับ
        </button>
        <h2 style={S.title}>ใบจดบันทึกผลงานประจำเครื่องจักร</h2>

        {/* ===== ข้อมูลทั่วไป (อ่านอย่างเดียว) ===== */}
        <div style={S.section}>
          <div style={S.sectionHead}>
            <span style={S.ic}>▣</span> ข้อมูลทั่วไป
            <span style={S.opt}>— ล็อกจากตอนเปิดงาน</span>
          </div>
          <div style={S.row}>
            <div style={S.col}>
              <label style={S.fld}>หมายเลข</label>
              <input value={log.machines?.code ?? String(log.machine_id)} readOnly style={{ ...S.input, ...S.readonly }} />
            </div>
            <div style={S.col}>
              <label style={S.fld}>เบอร์มีด</label>
              <input value={log.knives?.code ?? String(log.knife_id)} readOnly style={{ ...S.input, ...S.readonly }} />
            </div>
          </div>
          <div style={S.row}>
            <div style={S.col}>
              <label style={S.fld}>Lot No.</label>
              <input value={log.lot_no} readOnly style={{ ...S.input, ...S.readonly }} />
            </div>
          </div>
          <div style={S.row}>
            <div style={S.col}>
              <label style={S.fld}>ชื่อผู้ผลิต</label>
              <input
                value={log.employees_production_logs_operator_idToemployees?.name ?? String(log.operator_id)}
                readOnly
                style={{ ...S.input, ...S.readonly }}
              />
            </div>
          </div>
          <div style={S.row}>
            <div style={S.col}>
              <label style={S.fldReq}>วันที่จบงาน</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ ...S.input, textAlign: "center" }}
              />
            </div>
            <div style={S.col}>
              <label style={S.fldReq}>เวลาจบ</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                style={{ ...S.input, textAlign: "center" }}
              />
            </div>
          </div>
        </div>

        {/* ===== ยอดการผลิต ===== */}
        <div style={S.section}>
          <div style={S.sectionHead}>
            <span style={S.ic}>▤</span> ข้อมูลยอดการผลิต
          </div>
          <div style={S.row}>
            <div style={S.col}>
              <label style={S.fldReq}>ยอดผลิตรวม</label>
              <input
                type="number"
                inputMode="numeric"
                value={totalQty}
                onChange={(e) => setTotalQty(e.target.value)}
                style={S.input}
              />
            </div>
          </div>
          <div style={S.row}>
            <div style={S.col}>
              <label style={S.fld}>ยอดของเสียรวม (อัตโนมัติ)</label>
              <input value={ngSum} readOnly style={{ ...S.input, ...S.readonly }} />
            </div>
            <div style={S.col}>
              <label style={S.fld}>ยอดของดี (อัตโนมัติ)</label>
              <input
                value={totalQty === "" ? "" : goodQty}
                readOnly
                style={{
                  ...S.input,
                  ...S.readonly,
                  color: goodQty < 0 ? V.dangerTx : V.text2,
                }}
              />
            </div>
          </div>
          {exceedTotal && (
            <div style={{ ...S.dtBox, background: V.dangerBg, color: V.dangerTx }}>
              ⚠ ของเสีย {ngSum} มากกว่ายอดผลิต {totalNum} — ตรวจสอบอีกครั้ง
            </div>
          )}
        </div>

        {/* ===== ประเภทของเสีย ===== */}
        <div style={S.section}>
          <div style={S.sectionHead}>
            <span style={S.ic}>▦</span> ประเภทของเสีย <span style={S.opt}>— ไม่บังคับ</span>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {DEFECT_TYPES.map((d, i) => (
              <div key={d.code}>
                <label style={S.defectLabel}>
                  {d.code} {d.name}
                </label>
                <div style={{ display: "flex" }}>
                  <span style={S.stepTag}>H{i + 1}</span>
                  <button onClick={() => adjustDefect(d.code, -1)} style={{ ...S.stepBtn, ...S.stepMinus }}>
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={defectQty[d.code] ?? ""}
                    placeholder="0"
                    onChange={(e) => setDefectDirect(d.code, e.target.value)}
                    style={S.stepInput}
                  />
                  <button onClick={() => adjustDefect(d.code, 1)} style={{ ...S.stepBtn, ...S.stepPlus }}>
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ===== เปลี่ยนหิน ===== */}
        <div style={S.section}>
          <div style={S.sectionHead}>
            <span style={S.ic}>⚙</span> การเปลี่ยนหิน &amp; เวลาพักเครื่อง
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={S.fld}>มีการเปลี่ยนหินหรือไม่?</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setIsStoneChange(false)}
                style={{ ...S.tbtn, ...(!isStoneChange ? S.tbtnOn : {}) }}
              >
                ไม่เปลี่ยน
              </button>
              <button
                onClick={() => setIsStoneChange(true)}
                style={{ ...S.tbtn, ...(isStoneChange ? S.tbtnOn : {}) }}
              >
                เปลี่ยนหิน
              </button>
            </div>
          </div>

          {isStoneChange && (
            <>
              <div style={S.warnBox}>
                <label style={S.warnLabel}>⚠ ยอดก่อนเปลี่ยนหิน (จำเป็น)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={qtyBeforeChange}
                  onChange={(e) => setQtyBeforeChange(e.target.value)}
                  placeholder="เช่น 12500"
                  style={{
                    ...S.input,
                    textAlign: "center",
                    borderColor: qtyBeforeChange === "" ? "#c25450" : "#5aa86f",
                  }}
                />
                <div style={S.warnHint}>ค่านี้ใช้คำนวณอายุหินในแดชบอร์ด</div>
              </div>
              <div style={S.row}>
                <div style={S.col}>
                  <label style={S.fld}>ขนาดหินซ้าย</label>
                  <input
                    value={sizeLeft}
                    onChange={(e) => setSizeLeft(e.target.value)}
                    placeholder="380"
                    style={{ ...S.input, textAlign: "center" }}
                  />
                </div>
                <div style={S.col}>
                  <label style={S.fld}>ขนาดหินขวา</label>
                  <input
                    value={sizeRight}
                    onChange={(e) => setSizeRight(e.target.value)}
                    placeholder="380"
                    style={{ ...S.input, textAlign: "center" }}
                  />
                </div>
              </div>
            </>
          )}

          <div style={S.row}>
            <div style={S.col}>
              <label style={S.fld}>เริ่มพักเครื่อง</label>
              <input
                type="time"
                value={stoneStart}
                onChange={(e) => setStoneStart(e.target.value)}
                style={{ ...S.input, textAlign: "center" }}
              />
            </div>
            <div style={S.col}>
              <label style={S.fld}>จบพักเครื่อง</label>
              <input
                type="time"
                value={stoneEnd}
                onChange={(e) => setStoneEnd(e.target.value)}
                style={{ ...S.input, textAlign: "center" }}
              />
            </div>
          </div>
          {stoneDt !== null && <DtBox minutes={stoneDt} label="พักเครื่อง" />}
        </div>

        {/* ===== ผู้รับผิดชอบ & จูน ===== */}
        <div style={S.section}>
          <div style={S.sectionHead}>
            <span style={S.ic}>✓</span> ผู้รับผิดชอบ &amp; การอนุมัติ
          </div>

          <div style={S.row}>
            <div style={S.col}>
              <label style={S.fldReq}>หัวหน้า/ช่าง</label>
              <select
                value={supervisorId}
                onChange={(e) => setSupervisorId(e.target.value === "" ? "" : Number(e.target.value))}
                style={S.input}
              >
                <option value="">เลือก...</option>
                {EMPLOYEES.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={S.col}>
              <label style={S.fld}>QC</label>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setQcApproved(null)}
                  style={{
                    ...S.tbtn,
                    fontSize: 13,
                    ...(qcApproved === null ? S.tbtnOn : {}),
                  }}
                >
                  ไม่ตรวจ
                </button>
                <button
                  onClick={() => setQcApproved(true)}
                  style={{
                    ...S.tbtn,
                    fontSize: 13,
                    ...(qcApproved === true ? { background: V.okBg, color: V.okTx, borderColor: V.okTx } : {}),
                  }}
                >
                  ผ่าน
                </button>
                <button
                  onClick={() => setQcApproved(false)}
                  style={{
                    ...S.tbtn,
                    fontSize: 13,
                    ...(qcApproved === false ? { background: V.dangerBg, color: V.dangerTx, borderColor: V.dangerTx } : {}),
                  }}
                >
                  ไม่ผ่าน
                </button>
              </div>
            </div>
          </div>

          <div style={{ ...S.fld, marginBottom: 6, marginTop: 12 }}>
            เวลาปรับจูน MC (เพิ่มได้หลายรอบ)
          </div>
          {tuneRounds.map((r, idx) => (
            <div key={idx} style={S.tuneRow}>
              <span style={S.rnum}>{idx + 1}</span>
              <div style={S.col}>
                <label style={S.fld}>เริ่ม</label>
                <input
                  type="time"
                  value={r.startTime}
                  onChange={(e) => updateTuneRound(idx, { startTime: e.target.value })}
                  style={{ ...S.input, textAlign: "center" }}
                />
              </div>
              <div style={S.col}>
                <label style={S.fld}>จบ</label>
                <input
                  type="time"
                  value={r.endTime}
                  onChange={(e) => updateTuneRound(idx, { endTime: e.target.value })}
                  style={{ ...S.input, textAlign: "center" }}
                />
              </div>
              <button
                onClick={() => removeTuneRound(idx)}
                style={{ ...S.delBtn, visibility: tuneRounds.length > 1 ? "visible" : "hidden" }}
              >
                ×
              </button>
            </div>
          ))}
          <button onClick={addTuneRound} style={S.addRoundBtn}>
            + เพิ่มรอบจูน
          </button>
          {tuneFilled && (
            <DtBox minutes={tuneTotal} label={`จูนรวม`} suffix={` (${tuneRounds.length} รอบ)`} />
          )}
        </div>

        {/* ===== หมายเหตุ ===== */}
        <div style={S.section}>
          <div style={S.sectionHead}>
            <span style={S.ic}>✎</span> หมายเหตุ
          </div>
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={2}
            style={{ ...S.input, height: "auto", padding: "10px 12px", resize: "vertical" }}
          />
        </div>

        <p style={S.reqNote}>* กรุณากรอกข้อมูลในช่องที่มีดอกจันให้ครบถ้วน</p>

        {msg && (
          <div
            style={{
              ...S.dtBox,
              marginBottom: 10,
              background: msg.kind === "ok" ? V.okBg : V.dangerBg,
              color: msg.kind === "ok" ? V.okTx : V.dangerTx,
            }}
          >
            {msg.text}
          </div>
        )}

        <button onClick={submit} disabled={!ready || busy} style={{ ...S.submitBtn, opacity: !ready || busy ? 0.6 : 1 }}>
          {busy ? "กำลังส่งข้อมูล..." : "บันทึกข้อมูลเข้าสู่ระบบ"}
        </button>
      </div>
    </div>
  );
}

// กล่องเตือน downtime — 3 สีเหมือนฟอร์มเดิม
function DtBox({ minutes, label, suffix = "" }: { minutes: number; label: string; suffix?: string }) {
  let bg = V.okBg,
    color = V.okTx,
    text = `✓ ${label} ${fmtMinutes(minutes)}${suffix}`;

  if (minutes === 0) {
    bg = V.dangerBg;
    color = V.dangerTx;
    text = "⚠ เวลาเริ่มกับจบเท่ากัน ตรวจสอบอีกครั้ง";
  } else if (minutes > 120) {
    bg = V.warnBg;
    color = V.warnTx;
    text = `⚠ ${label} ${fmtMinutes(minutes)}${suffix} — เกิน 2 ชม. ตรวจสอบอีกครั้ง`;
  }

  return <div style={{ ...S.dtBox, background: bg, color }}>{text}</div>;
}

// ===== ธีมเดิมทั้งชุด =====
const V = {
  bg: "#16181d",
  card: "#1d1f24",
  card2: "#272a30",
  field: "#16181d",
  border: "#3a3e46",
  border2: "#4a4e57",
  text: "#f2f3f5",
  text2: "#a9adb6",
  text3: "#80848d",
  accent: "#2f6fc4",
  accentText: "#7fb0e8",
  warnBg: "#3a3322",
  warnBd: "#6b5a2e",
  warnTx: "#f0c674",
  dangerBg: "#3d2626",
  dangerTx: "#e89a9a",
  okBg: "#243a2e",
  okTx: "#7fd1a0",
};

const S: Record<string, React.CSSProperties> = {
  body: {
    background: V.bg,
    color: V.text,
    fontFamily: "'Segoe UI', Tahoma, sans-serif",
    minHeight: "100vh",
    padding: 12,
    fontSize: 15,
  },
  wrap: { maxWidth: 480, margin: "0 auto" },
  title: { textAlign: "center", fontSize: 19, fontWeight: 500, margin: "6px 0 18px", color: V.text },
  section: {
    background: V.card,
    border: `0.5px solid ${V.border}`,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    width: "100%",
  },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 15,
    fontWeight: 500,
    color: V.text,
    marginBottom: 12,
  },
  ic: { color: V.accentText, fontSize: 18 },
  opt: { fontSize: 12, color: V.text3, fontWeight: 400 },
  fld: { display: "block", fontSize: 12, color: V.text2, marginBottom: 5 },
  fldReq: { display: "block", fontSize: 12, color: V.text, marginBottom: 5 },
  input: {
    width: "100%",
    background: V.field,
    borderWidth: "0.5px",
    borderStyle: "solid",
    borderColor: V.border2,
    borderRadius: 8,
    color: V.text,
    fontSize: 16,
    padding: "0 12px",
    height: 48,
    fontFamily: "inherit",
    colorScheme: "dark",
  },
  readonly: { background: V.card2, color: V.text2 },
  row: { display: "flex", gap: 8, marginBottom: 12 },
  col: { flex: 1, minWidth: 0 },
  tbtn: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    fontSize: 15,
    borderWidth: "0.5px",
    borderStyle: "solid",
    borderColor: V.border2,
    background: V.card2,
    color: V.text,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  tbtnOn: { background: V.accent, color: "#fff", borderColor: V.accent },
  defectLabel: { fontSize: 14, fontWeight: 500, color: V.text, marginBottom: 6, display: "block" },
  stepTag: {
    width: 46,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: V.card2,
    border: `0.5px solid ${V.border2}`,
    borderRight: "none",
    borderRadius: "8px 0 0 8px",
    fontSize: 13,
    fontWeight: 500,
    color: V.text2,
  },
  stepBtn: {
    width: 48,
    height: 48,
    flex: "none",
    padding: 0,
    background: V.card2,
    border: `0.5px solid ${V.border2}`,
    color: V.text,
    fontSize: 22,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  stepMinus: { borderRight: "none" },
  stepPlus: { borderLeft: "none", borderRadius: "0 8px 8px 0" },
  stepInput: {
    width: "100%",
    minWidth: 0,
    background: V.field,
    border: `0.5px solid ${V.border2}`,
    borderLeft: "none",
    borderRight: "none",
    borderRadius: 0,
    color: V.text,
    fontSize: 16,
    height: 48,
    textAlign: "center",
    fontFamily: "inherit",
  },
  warnBox: {
    background: V.warnBg,
    border: `0.5px solid ${V.warnBd}`,
    borderRadius: 12,
    padding: 13,
    marginBottom: 12,
  },
  warnLabel: { color: V.warnTx, fontSize: 13, fontWeight: 500, display: "block", marginBottom: 7 },
  warnHint: { color: "#c9a85a", fontSize: 11, marginTop: 5 },
  dtBox: {
    marginTop: 11,
    padding: "11px 12px",
    borderRadius: 8,
    textAlign: "center",
    fontSize: 15,
    fontWeight: 500,
  },
  tuneRow: { display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 8 },
  rnum: {
    width: 26,
    height: 48,
    flex: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 500,
    color: V.text2,
  },
  delBtn: {
    width: 44,
    height: 48,
    flex: "none",
    padding: 0,
    background: V.card2,
    border: `0.5px solid ${V.border2}`,
    borderRadius: 8,
    color: V.dangerTx,
    fontSize: 18,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  addRoundBtn: {
    width: "100%",
    height: 46,
    borderRadius: 8,
    background: V.card2,
    border: `0.5px dashed ${V.border2}`,
    color: V.accentText,
    fontSize: 15,
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: 2,
  },
  submitBtn: {
    width: "100%",
    height: 56,
    borderRadius: 12,
    border: "none",
    background: V.accent,
    color: "#fff",
    fontSize: 17,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: 4,
    marginBottom: 20,
  },
  reqNote: { textAlign: "center", color: V.dangerTx, fontSize: 13, fontWeight: 500, margin: "14px 0" },
  backBtn: {
    background: "none",
    border: "none",
    color: V.text2,
    fontSize: 13,
    cursor: "pointer",
    padding: 0,
    marginBottom: 4,
  },
  pickBtn: { textAlign: "left", cursor: "pointer" },
  pickHead: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  errBox: {
    background: V.dangerBg,
    border: `0.5px solid ${V.dangerTx}`,
    borderRadius: 12,
    padding: 13,
    color: V.dangerTx,
    marginBottom: 14,
  },
};