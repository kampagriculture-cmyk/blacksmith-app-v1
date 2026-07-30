/**
 * One-time migration: import historical production-log and inventory data
 * from the old Google Sheets ("PD-CS-SG-01 REV.001" / "PD-CS-SG-02 REV.001")
 * into Neon Postgres.
 *
 * Source data: database/source-data/sg01_production_log.csv (691 rows,
 * 19/03/2026–25/07/2026, columns unchanged from the original sheet export).
 * The small inventory dataset (7 withdrawals, 1 receipt, 2 item_master rows)
 * is small enough to embed directly below instead of a second CSV.
 *
 * Safe to re-run: every insert is guarded by an existence check first, so
 * running this twice does not create duplicate rows.
 *
 * Usage (from backend/):
 *   npx tsx scripts/migrate-gsheet-history.ts            # dry run — prints a plan, writes nothing
 *   npx tsx scripts/migrate-gsheet-history.ts --commit    # actually writes to the DB in DATABASE_URL
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const COMMIT = process.argv.includes("--commit");
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const CSV_PATH = path.join(__dirname, "../../database/source-data/sg01_production_log.csv");

// ---------- known operator-name variants in the source sheet → canonical name ----------
// The sheet accumulated nicknames/typos over time (e.g. someone started writing
// "...(เต้)" instead of "เต้" partway through). Confirmed with the shop manager
// during migration review — see MANAGER_GUIDE.md / CONCURRENCY.md siblings.
const NAME_ALIASES: Record<string, string> = {
  "ป้อม": "ป้อม",
  "...พี่ป้อม": "ป้อม",
  "...(ป้อม)": "ป้อม",
  "สุชาดา": "สุชาดา",
  "ส้ม": "สุชาดา", // confirmed nickname for สุชาดา
  "สุชาดา(ส้ม)": "สุชาดา",
  "เต้": "เต้",
  "...(เต้)": "เต้",
  "รัตนา": "รัตนา",
  "...(รัตนา)": "รัตนา",
  "ศักดิ์สิทธิ์": "ศักดิ์สิทธิ์", // exists as a supervisor; also appears once as an operator — kept as-is, flagged in the summary
  "...พี่เดือน": "เดือน",
  "ปรียะดา": "ปรียะดา",
  "ภาวิณี": "ภาวิณี",
  "ปิยะดา": "ปิยะดา",
};

const H_CODES = [
  "H01", "H02", "H03", "H04", "H05", "H06", "H07",
  "H08", "H09", "H10", "H11", "H12", "H13", "H14", "H15",
];

// ---------- tiny RFC4180 CSV parser (handles quoted fields with embedded commas/newlines) ----------
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function parseDateOnly(s: string): { d: number; mo: number; y: number } | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return { d: +m[1], mo: +m[2], y: +m[3] };
}

function parseTime(s: string): { h: number; mi: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return { h: +m[1], mi: +m[2] };
}

/** วันผลิตสิ้นสุด if present, else the date portion of Timestamp (covers 13 rows where Timestamp is missing its time part). */
function buildEndedAt(row: Record<string, string>): Date | null {
  const endDateStr = row["วันผลิตสิ้นสุด"].trim();
  const dateParts = endDateStr ? parseDateOnly(endDateStr) : parseDateOnly(row["Timestamp"].slice(0, 10));
  if (!dateParts) return null;
  const timeParts = parseTime(row["เวลาผลิตสิ้นสุด"]) ?? { h: 0, mi: 0 };
  return new Date(Date.UTC(dateParts.y, dateParts.mo - 1, dateParts.d, timeParts.h, timeParts.mi, 0));
}

function readRows(): Record<string, string>[] {
  const csv = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCSV(csv);
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.length > 1 && r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// ---------- inventory sheet ("PD-CS-SG-02 REV.001") — small enough to inline ----------
const INVENTORY_ITEMS = [
  { id: "SGW", name: "หินเจียรชนิดแผ่น", unit: "ก้อน", reorderPoint: 180 },
  { id: "VB", name: "สายพาน L3310", unit: "เส้น", reorderPoint: 10 },
];

const INVENTORY_WITHDRAWALS = [
  { ts: "2026-07-06T15:16:26Z", itemId: "SGW", qty: 2, who: "เพชร", machine: "SG-01", reason: "เปลี่ยนพอดีขีดมาตรฐาน", remark: "ไม่มีไร เทสระบบเฉยๆ" },
  { ts: "2026-07-06T15:25:53Z", itemId: "SGW", qty: 4, who: "เพชร", machine: "SG-02", reason: "เปลี่ยนพอดีขีดมาตรฐาน", remark: null },
  { ts: "2026-07-06T15:26:28Z", itemId: "SGW", qty: 10, who: "เพชร", machine: "SG-01", reason: "เปลี่ยนก่อนถึงขีด", remark: "หินต๊อง" },
  { ts: "2026-07-06T15:26:52Z", itemId: "SGW", qty: 5, who: "เพชร", machine: "SG-01", reason: "เลยขีดวงในไปแล้ว", remark: null },
  { ts: "2026-07-06T15:28:26Z", itemId: "SGW", qty: 5, who: "ดรีม", machine: "SG-01", reason: "เลยขีดวงในไปแล้ว", remark: "ประหยัดให้ทุกดอก แล้วบอกผมขี้เกียจเปลี่ยนหินซะงั้น" },
  { ts: "2026-07-06T15:30:19Z", itemId: "SGW", qty: 5, who: "ดรีม", machine: "SG-02", reason: "เปลี่ยนก่อนถึงขีด", remark: "รีบครับ" },
  { ts: "2026-07-06T15:31:35Z", itemId: "SGW", qty: 5, who: "เพชร", machine: "SG-02", reason: "เปลี่ยนก่อนถึงขีด", remark: "รีบอีกละครับ" },
];

const INVENTORY_RECEIPTS = [
  { ts: "2026-07-06T15:24:15Z", itemId: "SGW", qty: 216, who: "แอดมิน A", source: "PO-2026-01", remark: "เข้า 1 พาเลท" },
];

async function main() {
  console.log(COMMIT ? "=== COMMIT MODE — writing to DB ===" : "=== DRY RUN — no writes will happen (pass --commit to write) ===");

  const rows = readRows();
  console.log(`Read ${rows.length} production-log rows from ${CSV_PATH}`);

  // ---------- 1. reference data: employees, machines, knives ----------
  const employees = await prisma.employees.findMany();
  const employeeIdByName = new Map(employees.map((e) => [e.name, e.id]));

  const machines = await prisma.machines.findMany();
  const machineIdByCode = new Map(machines.map((m) => [m.code, m.id]));

  const knives = await prisma.knives.findMany();
  const knifeIdByCode = new Map(knives.map((k) => [k.code, k.id]));

  const neededOperatorNames = new Set<string>();
  const neededKnifeCodes = new Set<string>();
  const unmappedOperatorRaw = new Set<string>();

  for (const row of rows) {
    const raw = row["ชื่อผู้ผลิต"].trim();
    const canonical = NAME_ALIASES[raw];
    if (!canonical) { unmappedOperatorRaw.add(raw); continue; }
    if (!employeeIdByName.has(canonical)) neededOperatorNames.add(canonical);

    const knifeCode = row["เบอร์มีด"].trim();
    if (knifeCode && !knifeIdByCode.has(knifeCode)) neededKnifeCodes.add(knifeCode);
  }

  // inventory-sheet people
  for (const w of INVENTORY_WITHDRAWALS) if (!employeeIdByName.has(w.who)) neededOperatorNames.add(w.who);
  for (const r of INVENTORY_RECEIPTS) if (!employeeIdByName.has(r.who)) neededOperatorNames.add(r.who);

  console.log("\n--- New employees to create (role=operator) ---");
  console.log([...neededOperatorNames]);
  console.log("--- New knife codes to create ---");
  console.log([...neededKnifeCodes]);
  if (unmappedOperatorRaw.size) {
    console.log("\n!!! UNMAPPED operator names found in the CSV — add these to NAME_ALIASES before running again:");
    console.log([...unmappedOperatorRaw]);
    if (COMMIT) { console.log("Aborting commit — resolve unmapped names first."); await prisma.$disconnect(); return; }
  }

  if (COMMIT) {
    for (const name of neededOperatorNames) {
      const created = await prisma.employees.create({ data: { name, role: "operator" } });
      employeeIdByName.set(name, created.id);
      console.log(`created employee ${name} -> id ${created.id}`);
    }
    for (const code of neededKnifeCodes) {
      const created = await prisma.knives.create({ data: { code } });
      knifeIdByCode.set(code, created.id);
      console.log(`created knife ${code} -> id ${created.id}`);
    }
  } else {
    // dry run: assign placeholder ids so the row loop below can still validate
    // every row end-to-end (otherwise every row needing a not-yet-created
    // employee/knife would wrongly show up as "missing FK").
    let placeholder = -1;
    for (const name of neededOperatorNames) employeeIdByName.set(name, placeholder--);
    for (const code of neededKnifeCodes) knifeIdByCode.set(code, placeholder--);
  }

  // ---------- 2. production_logs + defect_entries + stone_changes ----------
  let imported = 0, skippedExisting = 0, skippedBadDate = 0;
  const flaggedRows: string[] = [];

  for (const row of rows) {
    const rawOperator = row["ชื่อผู้ผลิต"].trim();
    const operatorName = NAME_ALIASES[rawOperator];
    if (!operatorName) continue; // already reported above

    const machineCode = row["หมายเลขเครื่อง"].trim();
    const knifeCode = row["เบอร์มีด"].trim();
    const lotNo = row["Lot_No"].trim();
    const totalQty = parseInt(row["ยอดผลิตรวม"], 10);
    const supervisorName = row["หัวหน้า/ช่างประจำเครื่อง"].trim();

    const endedAt = buildEndedAt(row);
    if (!endedAt) { skippedBadDate++; continue; }

    const machineId = machineIdByCode.get(machineCode);
    const knifeId = knifeIdByCode.get(knifeCode);
    const operatorId = employeeIdByName.get(operatorName);
    const supervisorId = supervisorName ? employeeIdByName.get(supervisorName) : undefined;

    if (!machineId || !knifeId || !operatorId) {
      flaggedRows.push(`lot=${lotNo} missing FK (machine=${machineCode}:${machineId} knife=${knifeCode}:${knifeId} operator=${operatorName}:${operatorId})`);
      continue;
    }
    if (operatorName === "ศักดิ์สิทธิ์") {
      flaggedRows.push(`lot=${lotNo} — supervisor "ศักดิ์สิทธิ์" listed as the operator (kept as-is)`);
    }

    // fold stray/unstructured columns into remark rather than dropping them
    const remarkParts = [row["หมายเหตุ"].trim()];
    const qcCell = row["QC Approved"].trim();
    if (qcCell) { remarkParts.push(`QC: ${qcCell}`); flaggedRows.push(`lot=${lotNo} — non-boolean QC Approved cell "${qcCell}" moved to remark`); }
    const tuneDetail = row["รายละเอียดจูนทุกรอบ"].trim();
    const tuneMinutes = row["เวลาจูนรวม (นาที)"].trim();
    if (tuneDetail || tuneMinutes) {
      remarkParts.push(`จูน: ${tuneDetail}${tuneMinutes ? ` (${tuneMinutes} นาที)` : ""}`);
    }
    const remark = remarkParts.filter(Boolean).join("\n") || null;

    const defects = H_CODES
      .map((code) => ({ code, qty: parseInt(row[code] || "0", 10) || 0 }))
      .filter((d) => d.qty > 0);

    const leftChanged = row["เปลี่ยนหินซ้าย"].trim() === "เปลี่ยน";
    const rightChanged = row["เปลี่ยนหินขวา"].trim() === "เปลี่ยน";
    const stoneChange = (leftChanged || rightChanged)
      ? {
          qtyBeforeChange: parseInt(row["ยอดก่อนเปลี่ยนหิน"], 10) || 0,
          sizeLeft: row["ขนาดหินซ้าย"].trim() || null,
          sizeRight: row["ขนาดหินขวา"].trim() || null,
          downtimeStart: parseTime(row["เวลาเริ่มเปลี่ยนหิน"]),
          downtimeEnd: parseTime(row["เวลาจบเปลี่ยนหิน"]),
        }
      : null;

    const existing = await prisma.production_logs.findFirst({
      where: { machine_id: machineId, lot_no: lotNo, ended_at: endedAt },
      select: { id: true },
    });
    if (existing) { skippedExisting++; continue; }

    imported++;
    if (!COMMIT) continue;

    await prisma.$transaction(async (tx) => {
      const log = await tx.production_logs.create({
        data: {
          machine_id: machineId,
          knife_id: knifeId,
          lot_no: lotNo,
          status: "completed",
          started_at: null,
          ended_at: endedAt,
          total_qty: totalQty,
          operator_id: operatorId,
          supervisor_id: supervisorId ?? null,
          qc_approved: null,
          remark,
        },
      });

      if (defects.length) {
        await tx.defect_entries.createMany({
          data: defects.map((d) => ({ production_log_id: log.id, defect_type_code: d.code, qty: d.qty })),
        });
      }

      if (stoneChange) {
        await tx.stone_changes.create({
          data: {
            production_log_id: log.id,
            qty_before_change: stoneChange.qtyBeforeChange,
            size_left: stoneChange.sizeLeft,
            size_right: stoneChange.sizeRight,
            downtime_start: stoneChange.downtimeStart
              ? new Date(Date.UTC(1970, 0, 1, stoneChange.downtimeStart.h, stoneChange.downtimeStart.mi))
              : null,
            downtime_end: stoneChange.downtimeEnd
              ? new Date(Date.UTC(1970, 0, 1, stoneChange.downtimeEnd.h, stoneChange.downtimeEnd.mi))
              : null,
          },
        });
      }
    });
  }

  console.log(`\nproduction_logs: ${COMMIT ? "imported" : "would import"}=${imported} skipped(already present)=${skippedExisting} skipped(bad date)=${skippedBadDate}`);

  // ---------- 3. inventory: item_master, withdrawal_log, receipt_log ----------
  for (const item of INVENTORY_ITEMS) {
    const exists = await prisma.item_master.findUnique({ where: { id: item.id } });
    if (exists) continue;
    console.log(`${COMMIT ? "creating" : "would create"} item_master ${item.id} (${item.name})`);
    if (COMMIT) {
      await prisma.item_master.create({
        data: { id: item.id, name: item.name, unit: item.unit, reorder_point: item.reorderPoint, active: true },
      });
    }
  }

  for (const w of INVENTORY_WITHDRAWALS) {
    const withdrawerId = employeeIdByName.get(w.who);
    const machineId = machineIdByCode.get(w.machine);
    if (!withdrawerId) { console.log(`!!! skip withdrawal — unknown employee ${w.who}`); continue; }
    const dup = await prisma.withdrawal_log.findFirst({
      where: { item_id: w.itemId, qty: w.qty, withdrawer_id: withdrawerId, created_at: new Date(w.ts) },
    });
    if (dup) continue;
    console.log(`${COMMIT ? "creating" : "would create"} withdrawal ${w.itemId} qty=${w.qty} by ${w.who}`);
    if (COMMIT) {
      await prisma.withdrawal_log.create({
        data: {
          created_at: new Date(w.ts),
          item_id: w.itemId,
          qty: w.qty,
          withdrawer_id: withdrawerId,
          machine_id: machineId ?? null,
          reason: w.reason,
          remark: w.remark,
        },
      });
    }
  }

  for (const r of INVENTORY_RECEIPTS) {
    const receiverId = employeeIdByName.get(r.who);
    if (!receiverId) { console.log(`!!! skip receipt — unknown employee ${r.who}`); continue; }
    const dup = await prisma.receipt_log.findFirst({
      where: { item_id: r.itemId, qty: r.qty, receiver_id: receiverId, created_at: new Date(r.ts) },
    });
    if (dup) continue;
    console.log(`${COMMIT ? "creating" : "would create"} receipt ${r.itemId} qty=${r.qty} by ${r.who}`);
    if (COMMIT) {
      await prisma.receipt_log.create({
        data: { created_at: new Date(r.ts), item_id: r.itemId, qty: r.qty, receiver_id: receiverId, source: r.source, remark: r.remark },
      });
    }
  }

  console.log("\n--- Flagged rows worth a human look (not errors, just noted) ---");
  console.log(flaggedRows.length ? flaggedRows.join("\n") : "(none)");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
