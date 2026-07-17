// Phase 3 — concurrency test (checkout) — พิสูจน์ SELECT ... FOR UPDATE
// รัน: node test-concurrent-checkout.js

const BASE_URL = "http://localhost:3001";

const MACHINE_ID    = 1;    // SG-01
const KNIFE_ID      = 1;
const OPERATOR_ID   = 1;    // สุชาดา
const SUPERVISOR_ID = 2;    // เต้
const DEFECT_CODE   = "H01"; // ลับบาง-หนา (R)

const N = 3;

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let b; try { b = await res.json(); } catch { b = await res.text(); }
  return { status: res.status, body: b };
}

async function checkout(id, label) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/production-logs/${id}/checkout`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        totalQty: 100,
        supervisorId: SUPERVISOR_ID,
        defects: [{ code: DEFECT_CODE, qty: 5 }],
      }),
    });
    const elapsed = Date.now() - t0;
    let b; try { b = await res.json(); } catch { b = await res.text(); }
    return { label, status: res.status, elapsed, body: b };
  } catch (err) {
    return { label, status: "FETCH_ERROR", elapsed: Date.now() - t0, body: err.message };
  }
}

async function main() {
  const lot = "LOT-CHKOUT-" + Date.now().toString().slice(-6);
  const created = await post("/production-logs/start", {
    machineId: MACHINE_ID, knifeId: KNIFE_ID, lotNo: lot, operatorId: OPERATOR_ID,
  });

  if (created.status !== 201) {
    console.log(`✗ เปิดงานไม่สำเร็จ (${created.status}) — เคลียร์งานค้าง machine ${MACHINE_ID} ก่อน`);
    console.log(`  ${JSON.stringify(created.body)}`);
    process.exit(1);
  }

  const id = created.body.id;
  console.log(`✓ เปิดงานแล้ว: log id = ${id} (lot ${lot})`);
  console.log(`\n=== ยิง ${N} checkout พร้อมกัน id เดียวกัน ===\n`);

  const jobs = [];
  for (let i = 1; i <= N; i++) jobs.push(checkout(id, `chk-${i}`));
  const results = await Promise.all(jobs);

  let ok = 0, conflict = 0, other = 0;
  for (const r of results) {
    const tag = r.status === 200 ? "✓ SUCCESS" : r.status === 409 ? "· CONFLICT" : "✗ " + r.status;
    console.log(`${r.label} | ${tag} | ${String(r.elapsed).padStart(5)}ms`);
    console.log(`  ${JSON.stringify(r.body)}\n`);
    if (r.status === 200) ok++;
    else if (r.status === 409) conflict++;
    else other++;
  }

  console.log("=== สรุป ===");
  console.log(`200 OK       : ${ok}       (ควรได้ 1)`);
  console.log(`409 Conflict : ${conflict} (ควรได้ ${N - 1})`);
  console.log(`อื่นๆ         : ${other}    (ควรได้ 0)`);
  console.log(`\n★ ไปเช็คใน DBeaver: log id = ${id} ต้องมี defect_entries แค่ 1 แถว qty=5`);
  console.log(`   SELECT * FROM defect_entries WHERE production_log_id = ${id};`);

  if (ok === 1 && conflict === N - 1) {
    console.log("\n✓✓✓ PASS — FOR UPDATE คุมแถวได้จริง");
  } else {
    console.log("\n✗✗✗ FAIL — เช็ค defect_entries ว่าเบิ้ลไหม");
  }
}

main();