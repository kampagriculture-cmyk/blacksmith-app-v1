// Audit trail — concurrency test (concurrent edits on the same log)
// รัน: node test-concurrent-edit.js   (backend ต้องรันอยู่ที่ port 3001)
//
// ต่างจาก test-concurrent.js (start work order): ตรงนั้นคาดหวังแค่ 1 ใน N สำเร็จ
// (advisory lock กันชนกัน) แต่ตรงนี้คาดหวัง "ทุก request สำเร็จ" เพราะ edit ไม่ใช่
// operation ที่ควรชนกัน — สิ่งที่ทดสอบคือ row lock (FOR UPDATE) ทำให้แต่ละ request
// เข้าคิวอ่าน-แก้-เขียนทีละตัวจริง ไม่ race กันจนหลุด update บางตัวไป (lost update)

const BASE_URL = "http://localhost:3001";

// ★★★ แก้ให้ตรงกับ log id จริงที่มีอยู่ (status อะไรก็ได้ ไม่กระทบ endpoint นี้) ★★★
const LOG_ID = 1;

const N = 5; // จำนวน request ที่ยิงพร้อมกัน

async function editLog(i) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/production-logs/${LOG_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        totalQty: 100 + i, // ค่าต่างกันแต่ละ request เพื่อแยกแยะได้
        editedBy: `test-concurrent-edit req-${i}`,
        editReason: "concurrency test",
      }),
    });
    const elapsed = Date.now() - t0;
    let body;
    try { body = await res.json(); } catch { body = await res.text(); }
    return { label: `req-${i}`, status: res.status, elapsed, body };
  } catch (err) {
    return { label: `req-${i}`, status: "FETCH_ERROR", elapsed: Date.now() - t0, body: err.message };
  }
}

async function getVersion() {
  const res = await fetch(`${BASE_URL}/production-logs/${LOG_ID}/history`);
  if (!res.ok) {
    console.log(`✗ server ตอบ ${res.status} ตอนดึง history — เช็คว่า log id ${LOG_ID} มีอยู่จริง`);
    process.exit(1);
  }
  return res.json();
}

async function main() {
  const before = await getVersion();
  console.log(`✓ preflight — log ${LOG_ID} เริ่มที่ version=${before.current_version}, มีประวัติ ${before.total_edits} รายการอยู่แล้ว\n`);

  console.log(`=== ยิง ${N} PATCH requests พร้อมกันไปที่ log id ${LOG_ID} ===\n`);

  const jobs = [];
  for (let i = 1; i <= N; i++) jobs.push(editLog(i));
  const results = await Promise.all(jobs);

  let ok = 0, other = 0;
  for (const r of results) {
    const tag = r.status === 200 ? "✓ SUCCESS" : "✗ " + r.status;
    console.log(`${r.label} | ${tag} | ${String(r.elapsed).padStart(5)}ms`);
    if (r.status === 200) ok++;
    else { other++; console.log(`  ${JSON.stringify(r.body)}`); }
  }

  const after = await getVersion();
  const expectedVersion = before.current_version + N;
  const expectedEdits = before.total_edits + N;

  console.log("\n=== สรุป ===");
  console.log(`200 OK       : ${ok}       (ควรได้ ${N})`);
  console.log(`อื่นๆ         : ${other}    (ควรได้ 0)`);
  console.log(`version      : ${before.current_version} → ${after.current_version} (ควรได้ ${expectedVersion})`);
  console.log(`total_edits  : ${before.total_edits} → ${after.total_edits} (ควรได้ ${expectedEdits})`);

  const versionsInHistory = after.history.map((h) => h.version).sort((a, b) => a - b);
  console.log(`versions ใน history: [${versionsInHistory.join(", ")}]`);

  if (ok === N && after.current_version === expectedVersion && after.total_edits === expectedEdits) {
    console.log("\n✓✓✓ PASS — row lock กันไม่ให้แก้พร้อมกันแล้วหลุด update (lost update) — ทุกแก้ไขถูกบันทึกครบ ไม่มีตัวไหนหาย");
  } else {
    console.log("\n✗✗✗ FAIL — version/total_edits ไม่ตรงที่คาด = มี update บางตัวหายไป (lost update) ตรวจ row lock ใน updateLog() อีกที");
  }
}

main();
