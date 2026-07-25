import Link from "next/link";

const LINKS = [
  { href: "/start", label: "เปิดงาน", desc: "เริ่มงานใหม่บนเครื่องจักร" },
  { href: "/checkout", label: "ปิดงาน", desc: "บันทึกผลงานและปิดงานที่ค้างอยู่" },
  { href: "/dashboard", label: "แดชบอร์ด", desc: "ดูงานที่กำลังดำเนินอยู่" },
  { href: "/inventory", label: "เบิก-รับเข้าวัสดุ", desc: "เบิก/รับเข้าวัสดุสิ้นเปลืองและดูสต็อค" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-graphite-night text-ink p-4 flex flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-bold">ระบบบันทึกการผลิต</h1>

      <div className="w-full max-w-md space-y-3">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="block rounded-2xl bg-graphite-surface border-[0.5px] border-hairline p-4 hover:bg-graphite-surface-2 transition-colors"
          >
            <div className="text-lg font-semibold text-shift-blue-text">{l.label}</div>
            <div className="text-sm text-ink-muted">{l.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
