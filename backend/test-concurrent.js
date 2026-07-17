// Phase 3 — concurrency test (start work order)
// รัน: node test-concurrent.js   (terminal 2, ที่ backend)

const BASE_URL = "http://localhost:3001";

// ★★★ แก้ 3 ค่านี้ให้ตรงกับ id จริงจาก DBeaver ★★★
const MACHINE_ID    = 1;    // SG-01
const KNIFE_ID      = 1;
const OPERATOR_ID   = 1;    // สุชาดา
const SUPERVISOR_ID = 2;    // เต้
const DEFECT_CODE   = "H01"; // ลับบาง-หนา (R)

const N = 5; // จำนวน request ที่ยิงพร้อมกัน

async function startWorkOrder(lotNo, label) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/production-logs/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machineId: MACHINE_ID,
        knifeId: KNIFE_ID,
        lotNo,
        operatorId: OPERATOR_ID,
      }),
    });
    const elapsed = Date.now() - t0;
    let body;
    try { body = await res.json(); } catch { body = await res.text(); }
    return { label, status: res.status, elapsed, body };
  } catch (err) {
    return { label, status: "FETCH_ERROR", elapsed: Date.now() - t0, body: err.message };
  }
}

// ── preflight: ยิง 1 นัดก่อน กันสรุปผลผิด ────────────────
async function preflight() {
  const res = await fetch(`${BASE_URL}/production-logs/in-progress`);
  if (!res.ok) {
    console.log(`✗ server ตอบ ${res.status} — เช็คว่า nest start --watch รันอยู่ที่ port 3001`);
    process.exit(1);
  }
  const rows = await res.json();
  const stuck = rows.filter((r) => r.machine_id === MACHINE_ID);
  if (stuck.length > 0) {
    console.log(`✗ machine ${MACHINE_ID} มีงานค้างอยู่แล้ว ${stuck.length} งาน (id: ${stuck.map(r=>r.id).join(", ")})`);
    console.log("  → ไปเคลียร์ใน DBeaver ก่อน ไม่งั้นผลเทสต์อ่านไม่ออก\n");
    process.exit(1);
  }
  console.log(`✓ preflight ผ่าน — machine ${MACHINE_ID} ว่าง\n`);
}

async function main() {
  await preflight();
  console.log(`=== ยิง ${N} requests พร้อมกัน machineId=${MACHINE_ID} ===\n`);

  // สร้าง promise ทั้งหมดก่อน ค่อย await ทีเดียว = fire พร้อมกันจริง
  const jobs = [];
  for (let i = 1; i <= N; i++) {
    jobs.push(startWorkOrder(`LOT-CONCUR-0${i}`, `req-${i}`));
  }
  const results = await Promise.all(jobs);

  let ok = 0, conflict = 0, other = 0;

  for (const r of results) {
    const tag = r.status === 201 ? "✓ SUCCESS" : r.status === 409 ? "· CONFLICT" : "✗ " + r.status;
    console.log(`${r.label} | ${tag} | ${String(r.elapsed).padStart(5)}ms`);
    console.log(`  ${JSON.stringify(r.body)}\n`);
    if (r.status === 201) ok++;
    else if (r.status === 409) conflict++;
    else other++;
  }

  console.log("=== สรุป ===");
  console.log(`201 Created  : ${ok}       (ควรได้ 1)`);
  console.log(`409 Conflict : ${conflict} (ควรได้ ${N - 1})`);
  console.log(`อื่นๆ         : ${other}    (ควรได้ 0)`);

  if (ok === 1 && conflict === N - 1) {
    console.log("\n✓✓✓ PASS — advisory lock คุมคิวได้จริง");
    console.log("    ★ ดู elapsed: req ที่ชนะควรเร็วสุด ที่เหลือช้ากว่า = หลักฐานว่ารอ lock จริง");
  } else if (ok > 1) {
    console.log("\n✗✗✗ FAIL — เปิดงานได้เกิน 1 = lock รั่ว (หรือ partial unique index ช่วยไว้แต่ lock ไม่ทำงาน)");
  } else {
    console.log("\n✗✗✗ ผลผิดคาด — เช็ค status code ข้างบนก่อน (400 = FK ผิด, 500 = ดู terminal 1)");
  }
}

main();