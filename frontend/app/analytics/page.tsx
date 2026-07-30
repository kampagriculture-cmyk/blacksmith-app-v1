"use client";

import { useEffect, useRef } from "react";
import { Chart, registerables } from "chart.js";
import { api, type AnalyticsRow, type MachineOwners } from "@/lib/api";
import { BackLink } from "@/components/BackLink";

Chart.register(...registerables);

// ★ ports the old Google Apps Script dashboard (Code.gs + HTML) — เดิมดึงข้อมูลผ่าน
// google.script.run.getDashboardData()/getMachineOwners() แล้วประมวลผล/วาดกราฟฝั่ง client
// ล้วนๆ พอร์ตมาที่นี่แค่เปลี่ยนช่องทางดึงข้อมูลเป็น REST API (/production-logs/analytics,
// /production-logs/machine-owners) ตรรกะ filter/aggregate/chart เดิมยังเหมือนเดิม

const H_LABELS = [
  "H01", "H02", "H03", "H04", "H05", "H06", "H07",
  "H08", "H09", "H10", "H11", "H12", "H13", "H14", "H15",
];

const SERIES_COLORS = ["#7fb0e8", "#f0a868", "#7fd1a0", "#e89a9a", "#c9a6f0", "#f0c674", "#6fd3d3", "#f09bc8"];

type Series = { id: number; name: string; op: string; machine: string; knife: string; color: string };

// ★ endedAt ถูกเก็บแบบ UTC-literal ตอนไมเกรตจากชีตเดิม (Date.UTC(y,mo,d,h,mi) ตรงตัว
// ไม่ปรับ timezone) ใช้ UTC getters ที่นี่เพื่อให้ได้วันที่/เวลาตรงกับที่บันทึกในชีตต้นฉบับ
function fmtDateThai(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function calcDt(startHHMM: string | null, endHHMM: string | null): number {
  if (!startHHMM || !endHHMM) return 0;
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  if (isNaN(sh) || isNaN(eh)) return 0;
  let d = eh * 60 + em - (sh * 60 + sm);
  if (d < 0) d += 1440;
  return d;
}

function fmtT(m: number): string {
  const h = Math.floor(m / 60);
  const mins = Math.round(m % 60);
  return (h > 0 ? h + "ชม. " : "") + mins + "นาที";
}

export default function AnalyticsPage() {
  const globalData = useRef<AnalyticsRow[]>([]);
  const normalMachineMap = useRef<MachineOwners>({});
  const customSeries = useRef<Series[]>([]);
  const seriesIdCounter = useRef(0);
  const yMode = useRef<"total" | "type">("total");
  const baseMode = useRef<"prod" | "ng">("prod");
  const chartDefectInstance = useRef<Chart | null>(null);
  const chartStoneInstance = useRef<Chart | null>(null);
  const chartTrendInstance = useRef<Chart | null>(null);

  useEffect(() => {
    const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
    const $sel = (id: string) => document.getElementById(id) as HTMLSelectElement;

    // ===== stone lifespan tracker types =====
    type StoneEntry = { id: string; label: string; dLabel: string; lifespan: number };

    function getActiveLists() {
      const ops = new Set<string>(), machines = new Set<string>(), knives = new Set<string>();
      globalData.current.forEach((r) => {
        if (r.operatorName) ops.add(r.operatorName);
        if (r.machineCode) machines.add(r.machineCode);
        if (r.knifeCode) knives.add(r.knifeCode);
      });
      return {
        ops: Array.from(ops).sort(),
        machines: Array.from(machines).sort(),
        knives: Array.from(knives).sort((a, b) => {
          const na = Number(a), nb = Number(b);
          return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
        }),
      };
    }

    function populateNames() {
      const techs = new Set<string>(), ops = new Set<string>(), machines = new Set<string>(), knives = new Set<string>();
      globalData.current.forEach((r) => {
        if (r.supervisorName) techs.add(r.supervisorName);
        if (r.operatorName) ops.add(r.operatorName);
        if (r.machineCode) machines.add(r.machineCode);
        if (r.knifeCode) knives.add(r.knifeCode);
      });
      ["A", "B"].forEach((s) => {
        const ts = $sel("filterTech" + s), os = $sel("filterOp" + s);
        const ms = $sel("filterMachine" + s), ks = $sel("filterKnife" + s);
        if (ts && os) {
          ts.innerHTML = os.innerHTML = '<option value="ALL">รวมทุกคน</option>';
          Array.from(techs).sort().forEach((n) => ts.add(new Option(n, n)));
          Array.from(ops).sort().forEach((n) => os.add(new Option(n, n)));
        }
        if (ms && ks) {
          ms.innerHTML = '<option value="ALL">รวมทุกเครื่อง</option>';
          Array.from(machines).sort().forEach((n) => ms.add(new Option(n, n)));
          ks.innerHTML = '<option value="ALL">รวมทุกเบอร์</option>';
          Array.from(knives)
            .sort((a, b) => {
              const na = Number(a), nb = Number(b);
              return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
            })
            .forEach((n) => ks.add(new Option(n, n)));
        }
      });
    }

    function processDataset(suffix: "A" | "B") {
      const fM = $("filterMachine" + suffix).value;
      const fK = $("filterKnife" + suffix).value;
      const fT = $("filterTech" + suffix).value;
      const fO = $("filterOp" + suffix).value;
      const sD = $sel("filterStoneDate" + suffix);
      const sL = $sel("filterStartLot" + suffix), eL = $sel("filterEndLot" + suffix);
      const dS = $("filterStartDate" + suffix).value, dE = $("filterEndDate" + suffix).value;
      const startObj = dS ? new Date(dS) : null, endObj = dE ? new Date(dE) : null;

      const filtered = globalData.current.filter((r) => {
        let mDate = true;
        if (startObj || endObj) {
          const rd = r.endedAt ? new Date(r.endedAt) : null;
          if (rd) {
            if (startObj && rd < startObj) mDate = false;
            if (endObj && rd > endObj) mDate = false;
          } else mDate = false;
        }
        return (
          (fM === "ALL" || r.machineCode === fM) &&
          (fK === "ALL" || r.knifeCode === fK) &&
          (fT === "ALL" || (r.supervisorName ?? "") === fT) &&
          (fO === "ALL" || r.operatorName === fO) &&
          mDate
        );
      });

      // อายุหิน
      const stones: StoneEntry[] = [];
      const trackers: Record<string, { qty: number; start: string }> = {};
      filtered.forEach((r) => {
        const key = r.machineCode + "_" + r.knifeCode;
        const rDateStr = r.endedAt ? fmtDateThai(r.endedAt) : "-";
        if (!trackers[key]) trackers[key] = { qty: 0, start: rDateStr };
        if (r.stoneChanged) {
          const qB = r.qtyBeforeChange ?? 0;
          trackers[key].qty += qB;
          if (trackers[key].qty > 0) {
            stones.push({
              id: r.machineCode + "_" + rDateStr,
              label: `เริ่ม:${trackers[key].start}\nถอด:${rDateStr}`,
              dLabel: `ถอด ${rDateStr} (${r.machineCode})`,
              lifespan: trackers[key].qty,
            });
          }
          trackers[key].qty = r.totalQty - qB;
          if (trackers[key].qty < 0) trackers[key].qty = 0;
          trackers[key].start = rDateStr;
        } else {
          trackers[key].qty += r.totalQty;
        }
      });

      const curS = sD.value;
      sD.innerHTML = '<option value="ALL">ดูทุกก้อน</option>';
      [...stones].reverse().forEach((s) => sD.add(new Option(s.dLabel, s.id)));
      sD.value = Array.from(sD.options).some((o) => o.value === curS) ? curS : "ALL";

      const curSL = sL.value, curEL = eL.value;
      sL.innerHTML = '<option value="ALL">ลอตแรกสุด</option>';
      eL.innerHTML = '<option value="ALL">ลอตล่าสุด</option>';
      filtered.forEach((r) => {
        const dateOnly = r.endedAt ? fmtDateThai(r.endedAt) : "-";
        const label = `${r.lotNo} (จบ: ${dateOnly})`;
        sL.add(new Option(label, r.lotNo));
        eL.add(new Option(label, r.lotNo));
      });
      sL.value = Array.from(sL.options).some((o) => o.value === curSL) ? curSL : "ALL";
      eL.value = Array.from(eL.options).some((o) => o.value === curEL) ? curEL : "ALL";

      let si = 0, ei = filtered.length - 1;
      if (sL.value !== "ALL") {
        const i = filtered.findIndex((r) => r.lotNo === sL.value);
        if (i !== -1) si = i;
      }
      if (eL.value !== "ALL") {
        const i = filtered.findIndex((r) => r.lotNo === eL.value);
        if (i !== -1) ei = i;
      }
      if (si > ei) [si, ei] = [ei, si];

      const pData = filtered.slice(si, ei + 1);
      const sData = sD.value !== "ALL" ? stones.filter((s) => s.id === sD.value) : stones;
      return { pData, sData };
    }

    function calcSum(pD: AnalyticsRow[], sD: StoneEntry[]) {
      const r = { total: 0, ng: 0, good: 0, stoneDt: 0, tuneDt: 0, dt: 0, life: 0, yP: "0", nP: "0" };
      pD.forEach((row) => {
        r.total += row.totalQty;
        r.ng += row.ngQty;
        r.good += row.goodQty;
        r.stoneDt += calcDt(row.stoneDowntimeStart, row.stoneDowntimeEnd);
        r.tuneDt += row.tuneMinutesTotal;
      });
      r.dt = r.stoneDt + r.tuneDt;
      let sl = 0;
      sD.forEach((s) => (sl += s.lifespan));
      r.life = sD.length > 0 ? Math.round(sl / sD.length) : 0;
      r.yP = r.total > 0 ? ((r.good / r.total) * 100).toFixed(1) : "0";
      r.nP = r.total > 0 ? ((r.ng / r.total) * 100).toFixed(1) : "0";
      return r;
    }

    // สัดส่วน downtime: จูน% vs เปลี่ยนหิน% ของ downtime รวม
    function fmtDowntimeBreakdown(stoneDt: number, tuneDt: number): string {
      const total = stoneDt + tuneDt;
      if (total === 0) return "";
      const stonePct = ((stoneDt / total) * 100).toFixed(0);
      const tunePct = ((tuneDt / total) * 100).toFixed(0);
      return `<div style="font-size:11px; color:var(--text3); margin-top:2px; font-weight:400;">เปลี่ยนหิน ${stonePct}% · จูน ${tunePct}%</div>`;
    }

    function updateKPIs(dA: ReturnType<typeof processDataset>, dB: ReturnType<typeof processDataset> | null, isC: boolean) {
      const a = calcSum(dA.pData, dA.sData);
      if (!isC) {
        $("kpiTotal").innerText = a.total.toLocaleString();
        $("kpiYield").innerText = a.yP + "%";
        $("kpiNG").innerText = a.nP + "%";
        $("kpiStoneLife").innerText = a.life > 0 ? a.life.toLocaleString() : "-";
        $("kpiDowntime").innerHTML = fmtT(a.dt) + fmtDowntimeBreakdown(a.stoneDt, a.tuneDt);
      } else {
        const b = calcSum(dB!.pData, dB!.sData);
        const fmt = (vA: string, vB: string, u = "") =>
          `<div style="color:var(--accent-text);font-size:17px;">A: ${vA}${u}</div><div style="color:var(--orange-text);font-size:17px;">B: ${vB}${u}</div>`;
        $("kpiTotal").innerHTML = fmt(a.total.toLocaleString(), b.total.toLocaleString());
        $("kpiYield").innerHTML = fmt(a.yP, b.yP, "%");
        $("kpiNG").innerHTML = fmt(a.nP, b.nP, "%");
        $("kpiStoneLife").innerHTML = fmt(a.life.toLocaleString(), b.life.toLocaleString());
        $("kpiDowntime").innerHTML =
          `<div style="color:var(--accent-text);font-size:13px;">A: ${fmtT(a.dt)}${fmtDowntimeBreakdown(a.stoneDt, a.tuneDt)}</div>` +
          `<div style="color:var(--orange-text);font-size:13px;margin-top:6px;">B: ${fmtT(b.dt)}${fmtDowntimeBreakdown(b.stoneDt, b.tuneDt)}</div>`;
      }
    }

    function drawDefectChart(dA: ReturnType<typeof processDataset>, dB: ReturnType<typeof processDataset> | null, isC: boolean) {
      const h = ["H01 หนา(R)", "H02 บาง(R)", "H03 บาง", "H04 เล็ก", "H05 ใหญ่", "H06 ซ้อน", "H07 ไม่เท่ากัน", "H08 คลื่น", "H09 ลาย", "H10 ไหม้", "H11 งอ", "H12 ลองหิน", "H13 เอียง", "H14 หยาบ", "H15 อื่นๆ"];
      const sA = Array(15).fill(0);
      let tNA = 0;
      dA.pData.forEach((r) => {
        tNA += r.ngQty;
        H_LABELS.forEach((code, i) => (sA[i] += r.defects[code] ?? 0));
      });
      const sB = Array(15).fill(0);
      let tNB = 0;
      if (isC) {
        dB!.pData.forEach((r) => {
          tNB += r.ngQty;
          H_LABELS.forEach((code, i) => (sB[i] += r.defects[code] ?? 0));
        });
      }

      const labs = h.map((n, i) => {
        if (!isC) return sA[i] > 0 ? [n, `NG:${((sA[i] / tNA) * 100).toFixed(1)}%`] : n;
        const ln = [n];
        if (sA[i] > 0) ln.push(`A:${((sA[i] / tNA) * 100).toFixed(1)}%`);
        if (sB[i] > 0) ln.push(`B:${((sB[i] / tNB) * 100).toFixed(1)}%`);
        return ln;
      });
      const ds: Chart["data"]["datasets"] = [{ label: isC ? "ชุด A" : "จำนวน (ชิ้น)", data: sA, backgroundColor: "rgba(127,176,232,0.75)" }];
      if (isC) ds.push({ label: "ชุด B", data: sB, backgroundColor: "rgba(240,168,104,0.75)" });

      chartDefectInstance.current?.destroy();
      chartDefectInstance.current = new Chart((document.getElementById("chartDefect") as HTMLCanvasElement).getContext("2d")!, {
        type: "bar",
        data: { labels: labs as string[], datasets: ds },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: "#a9adb6" } } },
          scales: {
            x: { ticks: { font: { size: 10 }, color: "#a9adb6" }, grid: { color: "#2a2d34" } },
            y: { beginAtZero: true, ticks: { color: "#a9adb6" }, grid: { color: "#2a2d34" } },
          },
        },
      });
    }

    function drawStoneChart(dA: ReturnType<typeof processDataset>, dB: ReturnType<typeof processDataset> | null, isC: boolean) {
      const lA = dA.sData.map((s) => s.label), vA = dA.sData.map((s) => s.lifespan);
      const ds: Chart["data"]["datasets"] = [
        { label: isC ? "อายุหิน A" : "อายุหิน (ชิ้น)", data: vA, borderColor: "#7fb0e8", backgroundColor: isC ? "#7fb0e8" : "rgba(127,176,232,0.15)", fill: !isC, tension: 0.3 },
      ];
      const type = isC ? "bar" : "line";
      let labs: string[] = lA;
      if (isC) {
        const vB = dB!.sData.map((s) => s.lifespan);
        ds.push({ label: "อายุหิน B", data: vB, backgroundColor: "#f0a868" });
        labs = Array.from({ length: Math.max(vA.length, vB.length) }, (_, i) => `ก้อนที่ ${i + 1}`);
      }
      chartStoneInstance.current?.destroy();
      chartStoneInstance.current = new Chart((document.getElementById("chartStone") as HTMLCanvasElement).getContext("2d")!, {
        type: type as "bar" | "line",
        data: { labels: labs, datasets: ds },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: "#a9adb6" } } },
          scales: {
            x: { ticks: { color: "#a9adb6" }, grid: { color: "#2a2d34" } },
            y: { ticks: { color: "#a9adb6" }, grid: { color: "#2a2d34" } },
          },
        },
      });
    }

    function renderDashboard() {
      if (globalData.current.length === 0) return;
      const isC = $("compareToggle").checked;
      const dA = processDataset("A"), dB = isC ? processDataset("B") : null;
      updateKPIs(dA, dB, isC);
      drawDefectChart(dA, dB, isC);
      drawStoneChart(dA, dB, isC);
      renderTrend();
    }

    function toggleCompareMode() {
      const isC = $("compareToggle").checked;
      document.getElementById("filtersB")!.classList.toggle("hidden", !isC);
      document.getElementById("labelGroupA")!.classList.toggle("hidden", !isC);
      renderDashboard();
    }

    // ===================== series builder =====================
    function renderSeriesList() {
      const lists = getActiveLists();
      let html = "";
      customSeries.current.forEach((s) => {
        const opOpts = '<option value="ALL">ทุกคน</option>' + lists.ops.map((o) => `<option value="${o}" ${s.op === o ? "selected" : ""}>${o}</option>`).join("");
        const mcOpts = '<option value="ALL">ทุกเครื่อง</option>' + lists.machines.map((m) => `<option value="${m}" ${s.machine === m ? "selected" : ""}>${m}</option>`).join("");
        const knOpts = '<option value="ALL">ทุกเบอร์</option>' + lists.knives.map((k) => `<option value="${k}" ${s.knife === k ? "selected" : ""}>${k}</option>`).join("");
        html += `
          <div class="series-row">
            <span class="dot" style="background:${s.color};"></span>
            <select onchange="window.__updateSeries(${s.id},'op',this.value)">${opOpts}</select>
            <select onchange="window.__updateSeries(${s.id},'machine',this.value)">${mcOpts}</select>
            <select onchange="window.__updateSeries(${s.id},'knife',this.value)">${knOpts}</select>
            <input class="nameInput" type="text" value="${s.name}" placeholder="ชื่อเส้น" oninput="window.__updateSeries(${s.id},'name',this.value)">
            <button class="del" onclick="window.__removeSeries(${s.id})">×</button>
          </div>`;
      });
      if (customSeries.current.length === 0) html = '<div style="color:var(--text3); font-size:13px; padding:8px;">กด "+ เพิ่มเส้น" เพื่อสร้างเส้นเปรียบเทียบ</div>';
      document.getElementById("seriesList")!.innerHTML = html;
    }

    function addSeries() {
      const id = ++seriesIdCounter.current;
      const color = SERIES_COLORS[customSeries.current.length % SERIES_COLORS.length];
      customSeries.current.push({ id, name: "เส้น " + (customSeries.current.length + 1), op: "ALL", machine: "ALL", knife: "ALL", color });
      renderSeriesList();
      renderTrend();
    }

    function removeSeries(id: number) {
      customSeries.current = customSeries.current.filter((s) => s.id !== id);
      renderSeriesList();
      renderTrend();
    }

    function updateSeries(id: number, field: keyof Series, value: string) {
      const s = customSeries.current.find((x) => x.id === id);
      if (s) {
        (s[field] as string) = value;
        renderTrend();
      }
    }

    function setYMode(v: "total" | "type") {
      yMode.current = v;
      document.getElementById("yTotal")!.classList.toggle("on", v === "total");
      document.getElementById("yType")!.classList.toggle("on", v === "type");
      document.getElementById("typePickWrap")!.classList.toggle("hidden", v !== "type");
      document.getElementById("baseModeWrap")!.classList.toggle("hidden", v !== "type");
      renderTrend();
    }

    function setBaseMode(v: "prod" | "ng") {
      baseMode.current = v;
      document.getElementById("baseA")!.classList.toggle("on", v === "prod");
      document.getElementById("baseB")!.classList.toggle("on", v === "ng");
      renderTrend();
    }

    function onRangeChange() {
      const custom = $("trendRange").value === "custom";
      document.getElementById("customFromWrap")!.classList.toggle("hidden", !custom);
      document.getElementById("customToWrap")!.classList.toggle("hidden", !custom);
      renderTrend();
    }

    function getTrendDates() {
      const range = $("trendRange").value;
      let fromObj: Date | null = null, toObj: Date | null = null, workingDaysLimit = 0;
      if (range === "custom") {
        const f = $("trendFrom").value, t = $("trendTo").value;
        fromObj = f ? new Date(f + "T00:00") : null;
        toObj = t ? new Date(t + "T23:59") : null;
      } else if (range !== "ALL") {
        workingDaysLimit = parseInt(range);
      }
      const dateMap: Record<string, number> = {};
      globalData.current.forEach((r) => {
        if (!r.endedAt) return;
        const dateStr = fmtDateThai(r.endedAt);
        const dp = dateStr.split("/");
        const dObj = new Date(Number(dp[2]), Number(dp[1]) - 1, Number(dp[0]));
        if (fromObj && dObj < fromObj) return;
        if (toObj && dObj > toObj) return;
        dateMap[dateStr] = dObj.getTime();
      });
      let dates = Object.keys(dateMap).sort((a, b) => dateMap[a] - dateMap[b]);
      if (workingDaysLimit > 0 && dates.length > workingDaysLimit) dates = dates.slice(dates.length - workingDaysLimit);
      return { dates };
    }

    type DayCell = { total: number; ng: number; h: number[] };

    function aggregateForSeries(series: Series, dateSet: Set<string>) {
      const map: Record<string, DayCell> = {};
      globalData.current.forEach((r) => {
        if (!r.endedAt) return;
        const dateStr = fmtDateThai(r.endedAt);
        if (!dateSet.has(dateStr)) return;
        if (series.op !== "ALL" && r.operatorName !== series.op) return;
        if (series.machine !== "ALL" && r.machineCode !== series.machine) return;
        if (series.knife !== "ALL" && r.knifeCode !== series.knife) return;
        if (!map[dateStr]) map[dateStr] = { total: 0, ng: 0, h: Array(15).fill(0) };
        map[dateStr].total += r.totalQty;
        map[dateStr].ng += r.ngQty;
        H_LABELS.forEach((code, i) => (map[dateStr].h[i] += r.defects[code] ?? 0));
      });
      return map;
    }

    type DayInfo = {
      dateLabel: string;
      stoneChanges: Record<string, number>;
      swaps: Record<string, { op: string; mc: string; qty: number; lots: number }>;
      unknownMcs: Set<string>;
    };

    function buildDailyTable(dates: string[], dateSet: Set<string>): DayInfo[] {
      const dayMap: Record<string, DayInfo> = {};
      globalData.current.forEach((r) => {
        if (!r.endedAt) return;
        const dateStr = fmtDateThai(r.endedAt);
        if (!dateSet.has(dateStr)) return;
        if (!dayMap[dateStr]) dayMap[dateStr] = { dateLabel: dateStr, stoneChanges: {}, swaps: {}, unknownMcs: new Set() };
        const day = dayMap[dateStr];
        const mc = r.machineCode, op = r.operatorName;

        if (r.stoneChanged) {
          const key = mc || "(ไม่ระบุเครื่อง)";
          day.stoneChanges[key] = (day.stoneChanges[key] || 0) + 1;
        }
        if (!mc || !op) return;
        if (!normalMachineMap.current[mc]) {
          day.unknownMcs.add(mc);
          return;
        }
        if (normalMachineMap.current[mc] !== op) {
          const key = op + "→" + mc;
          if (!day.swaps[key]) day.swaps[key] = { op, mc, qty: 0, lots: 0 };
          day.swaps[key].qty += r.totalQty;
          day.swaps[key].lots++;
        }
      });
      return dates.map((d) => dayMap[d]).filter(Boolean);
    }

    function renderTrend() {
      if (globalData.current.length === 0) return;
      const { dates } = getTrendDates();
      const dateSet = new Set(dates);
      const labels = dates;
      const typeIdx = parseInt($("typePick").value) || 0;

      const valueOf = (cell: DayCell | undefined): number | null => {
        if (!cell || cell.total === 0) return null;
        if (yMode.current === "total") return +((cell.ng / cell.total) * 100).toFixed(2);
        const hv = cell.h[typeIdx];
        if (baseMode.current === "prod") return +((hv / cell.total) * 100).toFixed(2);
        return cell.ng > 0 ? +((hv / cell.ng) * 100).toFixed(2) : 0;
      };

      const seriesAgg = customSeries.current.map((s) => ({ series: s, agg: aggregateForSeries(s, dateSet) }));
      const datasets = seriesAgg.map(({ series, agg }) => {
        const data = dates.map((d) => valueOf(agg[d]));
        return { label: series.name || "เส้น", data, borderColor: series.color, backgroundColor: series.color, tension: 0.3, spanGaps: true, pointRadius: 3 };
      });

      const yTitle = yMode.current === "total" ? "NG% รวม" : H_LABELS[typeIdx] + (baseMode.current === "prod" ? " (÷ผลิต)" : " (÷เสีย)");

      chartTrendInstance.current?.destroy();
      chartTrendInstance.current = new Chart((document.getElementById("chartTrend") as HTMLCanvasElement).getContext("2d")!, {
        type: "line",
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: "#a9adb6" } } },
          scales: {
            x: { ticks: { color: "#a9adb6" }, grid: { color: "#2a2d34" } },
            y: { beginAtZero: true, title: { display: true, text: yTitle, color: "#a9adb6" }, ticks: { color: "#a9adb6" }, grid: { color: "#2a2d34" } },
          },
        },
      });

      renderDailyTable(buildDailyTable(dates, dateSet), dates, seriesAgg, valueOf);
    }

    function renderDailyTable(
      days: DayInfo[],
      dates: string[],
      seriesAgg: { series: Series; agg: Record<string, DayCell> }[],
      valueOf: (cell: DayCell | undefined) => number | null,
    ) {
      const unit = yMode.current === "total" ? "NG%" : H_LABELS[parseInt($("typePick").value) || 0] + "%";
      const showDetail = $("showDefectDetail").checked;

      const activeHPerSeries = seriesAgg.map(({ agg }) => {
        const active: number[] = [];
        for (let i = 0; i < 15; i++) {
          let sum = 0;
          dates.forEach((d) => { if (agg[d]) sum += agg[d].h[i]; });
          if (sum > 0) active.push(i);
        }
        return active;
      });

      let thead = "";
      if (showDetail) {
        thead += '<tr><th rowspan="2">วันที่</th>';
        seriesAgg.forEach(({ series }, si) => {
          const span = 1 + activeHPerSeries[si].length;
          thead += `<th colspan="${span}" style="border-left:2px solid ${series.color};">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${series.color};margin-right:5px;vertical-align:middle;"></span>${series.name || "เส้น"}
          </th>`;
        });
        thead += '<th rowspan="2">หมายเหตุ</th></tr>';
        thead += "<tr>";
        seriesAgg.forEach(({ series }, si) => {
          thead += `<th style="border-left:2px solid ${series.color}; font-size:12px;">${unit}</th>`;
          activeHPerSeries[si].forEach((i) => {
            thead += `<th style="font-size:12px; color:var(--text2);">${H_LABELS[i]}</th>`;
          });
        });
        thead += "</tr>";
      } else {
        thead += "<tr><th>วันที่</th>";
        seriesAgg.forEach(({ series }) => {
          thead += `<th><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${series.color};margin-right:5px;vertical-align:middle;"></span>${series.name || "เส้น"} <span style="color:var(--text3);font-weight:400;">(${unit})</span></th>`;
        });
        thead += "<th>หมายเหตุ</th></tr>";
      }
      document.getElementById("dailyThead")!.innerHTML = thead;

      let body = "";
      dates.forEach((dateStr) => {
        const dayInfo = days.find((d) => d.dateLabel === dateStr);
        body += `<tr><td class="date">${dateStr}</td>`;
        seriesAgg.forEach(({ agg, series }, si) => {
          const cell = agg[dateStr];
          const v = valueOf(cell);
          const bd = showDetail ? `border-left:2px solid ${series.color};` : "";
          if (v === null) {
            body += `<td style="${bd}"><span style="color:var(--text3)">-</span></td>`;
          } else {
            const color = v >= 15 ? "var(--red-text)" : v >= 10 ? "var(--warn-tx)" : "var(--green-text)";
            body += `<td style="${bd}color:${color};font-weight:500;">${v.toFixed(1)}%</td>`;
          }
          if (showDetail) {
            activeHPerSeries[si].forEach((i) => {
              if (!cell || cell.total === 0) {
                body += `<td><span style="color:var(--text3)">-</span></td>`;
              } else {
                const hv = cell.h[i];
                if (hv === 0) {
                  body += `<td><span style="color:var(--text3)">-</span></td>`;
                } else {
                  const pct = ((hv / cell.total) * 100).toFixed(1);
                  body += `<td style="font-size:12px;">${hv} <span style="color:var(--text3);">(${pct}%)</span></td>`;
                }
              }
            });
          }
        });
        const stoneObj = dayInfo ? dayInfo.stoneChanges : {};
        const swapsArr = dayInfo ? Object.values(dayInfo.swaps) : [];
        const unknownMcs = dayInfo ? Array.from(dayInfo.unknownMcs) : [];
        const noteParts: string[] = [];
        const stoneEntries = Object.entries(stoneObj);
        if (stoneEntries.length > 0) {
          const txt = stoneEntries.map(([mc, n]) => (n > 1 ? `${mc} ${n} ครั้ง` : mc)).join(", ");
          noteParts.push(`<span class="badge-note">เปลี่ยนหิน: ${txt}</span>`);
        }
        if (swapsArr.length > 0) {
          const txt = swapsArr.map((s) => `${s.op}→${s.mc} (${s.qty.toLocaleString()} ชิ้น/${s.lots} ลอต)`).join(", ");
          noteParts.push(`<span class="badge-swap">⚠ สลับคน: ${txt}</span>`);
        }
        if (unknownMcs.length > 0) {
          noteParts.push(`<span class="badge-unknown">⚠ ${unknownMcs.join(", ")} ยังไม่กำหนดเจ้าของในตาราง machine_owners</span>`);
        }
        const note = noteParts.length > 0 ? noteParts.join("") : '<span style="color:var(--text3)">ปกติ</span>';
        body += `<td>${note}</td></tr>`;
      });
      if (dates.length === 0) body = `<tr><td colspan="50" style="color:var(--text3);padding:20px;">ไม่มีข้อมูลในช่วงที่เลือก</td></tr>`;
      document.getElementById("dailyTbody")!.innerHTML = body;
    }

    // ===== data fetch =====
    function fetchData() {
      $("kpiTotal").innerText = "กำลังโหลด...";
      api
        .getAnalyticsData()
        .then((data) => {
          if (data && data.length > 0) {
            globalData.current = data;
            populateNames();
            api
              .getMachineOwners()
              .catch(() => ({}))
              .then((map) => {
                normalMachineMap.current = map;
                if (customSeries.current.length === 0) addSeries();
                renderDashboard();
              });
          } else {
            alert("ไม่พบข้อมูล");
            $("kpiTotal").innerText = "0";
          }
        })
        .catch((error) => {
          alert("ดึงข้อมูลไม่ได้:\n" + error.message);
          $("kpiTotal").innerText = "Error";
        });
    }

    // expose the 2 handlers referenced by dynamically-generated innerHTML (series rows)
    (window as unknown as Record<string, unknown>).__updateSeries = updateSeries;
    (window as unknown as Record<string, unknown>).__removeSeries = removeSeries;

    // wire up the static shell (matches the old inline onclick="..."/onchange="..." attributes)
    document.getElementById("compareToggle")!.addEventListener("change", toggleCompareMode);
    document.getElementById("refreshBtn")!.addEventListener("click", fetchData);
    document.getElementById("addSeriesBtn")!.addEventListener("click", addSeries);
    document.getElementById("yTotal")!.addEventListener("click", () => setYMode("total"));
    document.getElementById("yType")!.addEventListener("click", () => setYMode("type"));
    document.getElementById("baseA")!.addEventListener("click", () => setBaseMode("prod"));
    document.getElementById("baseB")!.addEventListener("click", () => setBaseMode("ng"));
    document.getElementById("trendRange")!.addEventListener("change", onRangeChange);
    document.getElementById("typePick")!.addEventListener("change", renderTrend);
    document.getElementById("trendFrom")!.addEventListener("change", renderTrend);
    document.getElementById("trendTo")!.addEventListener("change", renderTrend);
    document.getElementById("showDefectDetail")!.addEventListener("change", renderTrend);
    ["A", "B"].forEach((s) => {
      ["filterMachine", "filterKnife", "filterTech", "filterOp", "filterStoneDate", "filterStartLot", "filterEndLot"].forEach((f) => {
        document.getElementById(f + s)?.addEventListener("change", renderDashboard);
      });
      ["filterStartDate", "filterEndDate"].forEach((f) => {
        document.getElementById(f + s)?.addEventListener("change", renderDashboard);
      });
    });

    H_LABELS.forEach((h, i) => $sel("typePick").add(new Option(h, String(i))));
    fetchData();

    return () => {
      chartDefectInstance.current?.destroy();
      chartStoneInstance.current?.destroy();
      chartTrendInstance.current?.destroy();
    };
  }, []);

  return (
    <div className="analytics-page">
      <style>{CSS}</style>
      <div className="wrap">
        <BackLink />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <h3 className="main">ระบบวิเคราะห์ผลการผลิตเจาะลึก</h3>
          <label className="switch">
            <input type="checkbox" id="compareToggle" />
            <span style={{ fontWeight: 500 }}>โหมดเปรียบเทียบ A/B</span>
          </label>
        </div>

        {/* ===== FILTER A ===== */}
        <div className="filter-bar gA" id="filtersA">
          <div id="labelGroupA" className="hidden" style={{ color: "var(--accent-text)", fontWeight: 500, marginBottom: 8 }}>
            ชุดข้อมูล A (อ้างอิง)
          </div>
          <div className="grid g5" style={{ marginBottom: 10 }}>
            <div><label className="lbl">เครื่องจักร</label><select id="filterMachineA"><option value="ALL">รวมทุกเครื่อง</option></select></div>
            <div><label className="lbl">เบอร์มีด</label><select id="filterKnifeA"><option value="ALL">รวมทุกเบอร์</option></select></div>
            <div><label className="lbl">ช่างจูนเครื่อง</label><select id="filterTechA"><option value="ALL">รวมทุกคน</option></select></div>
            <div><label className="lbl">ผู้ปฏิบัติงาน</label><select id="filterOpA"><option value="ALL">รวมทุกคน</option></select></div>
            <div><label className="lbl">อายุหิน (ก้อนที่ถอด)</label><select id="filterStoneDateA"><option value="ALL">ดูทุกก้อน</option></select></div>
          </div>
          <div className="grid g5">
            <div><label className="lbl">เริ่ม (วัน-เวลา)</label><input type="datetime-local" id="filterStartDateA" /></div>
            <div><label className="lbl">ถึง (วัน-เวลา)</label><input type="datetime-local" id="filterEndDateA" /></div>
            <div><label className="lbl">ตั้งแต่ Lot</label><select id="filterStartLotA"><option value="ALL">ลอตแรกสุด</option></select></div>
            <div><label className="lbl">ถึง Lot</label><select id="filterEndLotA"><option value="ALL">ลอตล่าสุด</option></select></div>
            <div style={{ display: "flex", alignItems: "flex-end" }}><button className="btn" id="refreshBtn" style={{ width: "100%" }}>รีเฟรชข้อมูล</button></div>
          </div>
        </div>

        {/* ===== FILTER B ===== */}
        <div className="filter-bar gB hidden" id="filtersB">
          <div style={{ color: "var(--orange-text)", fontWeight: 500, marginBottom: 8 }}>ชุดข้อมูล B (เปรียบเทียบ)</div>
          <div className="grid g5" style={{ marginBottom: 10 }}>
            <div><label className="lbl">เครื่องจักร</label><select id="filterMachineB"><option value="ALL">รวมทุกเครื่อง</option></select></div>
            <div><label className="lbl">เบอร์มีด</label><select id="filterKnifeB"><option value="ALL">รวมทุกเบอร์</option></select></div>
            <div><label className="lbl">ช่างจูนเครื่อง</label><select id="filterTechB"><option value="ALL">รวมทุกคน</option></select></div>
            <div><label className="lbl">ผู้ปฏิบัติงาน</label><select id="filterOpB"><option value="ALL">รวมทุกคน</option></select></div>
            <div><label className="lbl">อายุหิน (ก้อนที่ถอด)</label><select id="filterStoneDateB"><option value="ALL">ดูทุกก้อน</option></select></div>
          </div>
          <div className="grid g4">
            <div><label className="lbl">เริ่ม (วัน-เวลา)</label><input type="datetime-local" id="filterStartDateB" /></div>
            <div><label className="lbl">ถึง (วัน-เวลา)</label><input type="datetime-local" id="filterEndDateB" /></div>
            <div><label className="lbl">ตั้งแต่ Lot</label><select id="filterStartLotB"><option value="ALL">ลอตแรกสุด</option></select></div>
            <div><label className="lbl">ถึง Lot</label><select id="filterEndLotB"><option value="ALL">ลอตล่าสุด</option></select></div>
          </div>
        </div>

        {/* ===== KPI ===== */}
        <div className="grid g5">
          <div className="kpi"><div className="kpi-t" style={{ color: "var(--accent-text)" }}>ยอดผลิตรวม</div><div className="kpi-v" id="kpiTotal">-</div></div>
          <div className="kpi"><div className="kpi-t" style={{ color: "var(--green-text)" }}>อัตราของดี %</div><div className="kpi-v" id="kpiYield">-</div></div>
          <div className="kpi"><div className="kpi-t" style={{ color: "var(--red-text)" }}>อัตราของเสีย %</div><div className="kpi-v" id="kpiNG">-</div></div>
          <div className="kpi"><div className="kpi-t" style={{ color: "var(--warn-tx)" }}>อายุหินเฉลี่ย</div><div className="kpi-v" id="kpiStoneLife">-</div></div>
          <div className="kpi"><div className="kpi-t" style={{ color: "var(--text2)" }}>Downtime รวม</div><div className="kpi-v" id="kpiDowntime" style={{ fontSize: 15 }}>-</div></div>
        </div>

        <div className="grid g2" style={{ marginTop: 14 }}>
          <div className="card"><div className="sec-title">Pareto สัดส่วนของเสีย &amp; Impact %</div><canvas id="chartDefect"></canvas></div>
          <div className="card"><div className="sec-title">ประสิทธิภาพอายุการใช้งานหิน</div><canvas id="chartStone"></canvas></div>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="sec-title">แนวโน้มรายวัน (Daily Trend)</div>

          <div className="grid g4" style={{ marginBottom: 12 }}>
            <div>
              <label className="lbl">ช่วงเวลา</label>
              <select id="trendRange">
                <option value="7">7 วันทำงานล่าสุด</option>
                <option value="14">14 วันทำงานล่าสุด</option>
                <option value="30">30 วันทำงานล่าสุด</option>
                <option value="90">90 วันทำงานล่าสุด</option>
                <option value="custom">เลือกช่วงเอง</option>
                <option value="ALL">ทั้งหมด</option>
              </select>
            </div>
            <div id="customFromWrap" className="hidden"><label className="lbl">ตั้งแต่วันที่</label><input type="date" id="trendFrom" /></div>
            <div id="customToWrap" className="hidden"><label className="lbl">ถึงวันที่</label><input type="date" id="trendTo" /></div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginBottom: 14 }}>
            <div>
              <div className="lbl">แกน Y แสดง</div>
              <div className="seg">
                <button id="yTotal" className="on">NG% รวม</button>
                <button id="yType">เจาะประเภท</button>
              </div>
            </div>
            <div id="typePickWrap" className="hidden">
              <label className="lbl">ประเภทของเสีย</label>
              <select id="typePick"></select>
            </div>
            <div id="baseModeWrap" className="hidden">
              <div className="lbl">ฐานคำนวณ</div>
              <div className="seg">
                <button id="baseA" className="on">÷ ยอดผลิต (ภาพรวม)</button>
                <button id="baseB">÷ ยอดเสีย (impact)</button>
              </div>
            </div>
          </div>

          <div style={{ background: "var(--card2)", borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text2)" }}>เส้นที่ต้องการเปรียบเทียบ</span>
              <button className="btn" id="addSeriesBtn" style={{ height: 36, padding: "0 12px" }}>+ เพิ่มเส้น</button>
            </div>
            <div id="seriesList"></div>
          </div>

          <div style={{ position: "relative", height: 340 }}><canvas id="chartTrend"></canvas></div>
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <div className="sec-title" style={{ margin: 0 }}>ตารางข้อมูลรายวัน</div>
            <label className="switch" style={{ fontSize: 13 }}>
              <input type="checkbox" id="showDefectDetail" />
              <span>แสดงรายละเอียดของเสียแต่ละประเภท</span>
            </label>
          </div>
          <div className="table-scroll">
            <table id="dailyTable">
              <thead id="dailyThead"></thead>
              <tbody id="dailyTbody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.analytics-page {
  --bg: #16181d; --card: #1d1f24; --card2: #272a30; --field: #16181d;
  --border: #3a3e46; --border2: #4a4e57; --text: #f2f3f5; --text2: #a9adb6; --text3: #80848d;
  --accent: #2f6fc4; --accent-text: #7fb0e8; --orange: #e08a3c; --orange-text: #f0a868;
  --green-text: #7fd1a0; --red-text: #e89a9a; --warn-tx: #f0c674;
  background: var(--bg); color: var(--text);
  font-family: 'Segoe UI', Tahoma, sans-serif; padding: 14px; font-size: 14px; min-height: 100vh;
}
.analytics-page * { box-sizing: border-box; }
.analytics-page .wrap { max-width: 1200px; margin: 0 auto; }
.analytics-page h3.main { color: var(--accent-text); font-weight: 500; font-size: 19px; margin: 0 0 14px; }
.analytics-page .card { background: var(--card); border: 0.5px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
.analytics-page .filter-bar { background: var(--card); border-radius: 12px; padding: 14px; margin-bottom: 14px; border: 0.5px solid var(--border); }
.analytics-page .filter-bar.gA { border-left: 4px solid var(--accent); }
.analytics-page .filter-bar.gB { border-left: 4px solid var(--orange); }
.analytics-page label.lbl { display: block; font-size: 12px; font-weight: 500; color: var(--text2); margin-bottom: 4px; }
.analytics-page select, .analytics-page input {
  width: 100%; background: var(--field); border: 0.5px solid var(--border2);
  border-radius: 8px; color: var(--text); font-size: 14px; padding: 0 10px; height: 42px;
  font-family: inherit; outline: none; color-scheme: dark;
}
.analytics-page select:focus, .analytics-page input:focus { border-color: var(--accent); }
.analytics-page .grid { display: grid; gap: 10px; }
.analytics-page .g5 { grid-template-columns: repeat(5, 1fr); }
.analytics-page .g4 { grid-template-columns: repeat(4, 1fr); }
.analytics-page .g3 { grid-template-columns: repeat(3, 1fr); }
.analytics-page .g2 { grid-template-columns: repeat(2, 1fr); }
@media (max-width: 820px) { .analytics-page .g5, .analytics-page .g4, .analytics-page .g3 { grid-template-columns: repeat(2,1fr); } }
.analytics-page .kpi { background: var(--card2); border-radius: 10px; padding: 14px; text-align: center; }
.analytics-page .kpi-t { font-size: 11px; font-weight: 500; color: var(--text2); text-transform: uppercase; letter-spacing: 0.4px; }
.analytics-page .kpi-v { font-size: 23px; font-weight: 500; color: var(--text); margin-top: 6px; }
.analytics-page .btn { height: 42px; border-radius: 8px; border: 0.5px solid var(--border2); background: var(--card2); color: var(--text); cursor: pointer; font-size: 14px; font-family: inherit; padding: 0 14px; }
.analytics-page .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.analytics-page .seg { display: inline-flex; background: var(--card2); border: 0.5px solid var(--border2); border-radius: 8px; overflow: hidden; }
.analytics-page .seg button { border: none; background: transparent; color: var(--text2); height: 40px; padding: 0 16px; cursor: pointer; font-size: 13px; font-family: inherit; }
.analytics-page .seg button.on { background: var(--accent); color: #fff; }
.analytics-page table { width: 100%; border-collapse: collapse; font-size: 13px; }
.analytics-page th, .analytics-page td { padding: 8px 10px; text-align: center; border-bottom: 0.5px solid var(--border); white-space: nowrap; }
.analytics-page th { color: var(--text2); font-weight: 500; background: var(--card2); position: sticky; top: 0; }
.analytics-page td.date { text-align: left; font-weight: 500; }
.analytics-page .table-scroll { overflow-x: auto; border-radius: 8px; border: 0.5px solid var(--border); }
.analytics-page .switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.analytics-page .switch input { width: auto; height: auto; }
.analytics-page .badge-note { font-size: 11px; color: var(--orange-text); }
.analytics-page .badge-swap { font-size: 11px; color: var(--red-text); font-weight: 500; display: block; margin-top: 3px; }
.analytics-page .badge-unknown { font-size: 11px; color: var(--warn-tx); font-weight: 500; display: block; margin-top: 3px; }
.analytics-page .sec-title { font-size: 15px; font-weight: 500; color: var(--text2); margin-bottom: 12px; }
.analytics-page .hidden { display: none; }
.analytics-page .series-row { display: grid; grid-template-columns: 16px 1fr 1fr 1fr 1.2fr 36px; gap: 8px; align-items: center; margin-bottom: 8px; }
.analytics-page .series-row .dot { width: 14px; height: 14px; border-radius: 50%; }
.analytics-page .series-row select, .analytics-page .series-row input { height: 38px; font-size: 13px; }
.analytics-page .series-row .del { height: 38px; border-radius: 8px; border: 0.5px solid var(--border2); background: var(--card); color: var(--red-text); cursor: pointer; font-size: 16px; }
@media (max-width: 820px) {
  .analytics-page .series-row { grid-template-columns: 16px 1fr 1fr; }
  .analytics-page .series-row .nameInput { grid-column: 2 / 4; }
  .analytics-page .series-row .del { grid-column: 3; }
}
`;
