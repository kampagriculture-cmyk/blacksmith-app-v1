// ข้อ 1
function checkLowStock(current: number, threshold: number): boolean {
  return current < threshold;
}

// ข้อ 2
interface Material {
  id: number;
  name: string;
  unit: "kg" | "pcs";
  quantity: number;
}

// ทดสอบเรียกใช้ดู
console.log(checkLowStock(5, 10));

const m: Material = { id: 1, name: "หินเจียร", unit: "kg", quantity: 50 };
console.log(m);