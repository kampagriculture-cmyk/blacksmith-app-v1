"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type InProgressLog } from "@/lib/api";
import { BackLink } from "@/components/BackLink";

export default function DashboardPage() {
  const [logs, setLogs] = useState<InProgressLog[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<string>("-");

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await api.getInProgress();
      setLogs(data);
      setErr(null);
      setLastSync(new Date().toLocaleTimeString("th-TH"));
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 10_000); // poll ทุก 10 วิ — ข้ามตอนแท็บไม่ได้แสดงอยู่

    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return (
    <main className="min-h-screen bg-graphite-night text-ink p-4">
      <BackLink />
      <div className="flex items-baseline justify-between mb-5">
        <h1 className="text-2xl font-bold">งานที่ค้างอยู่</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-faint">อัปเดต {lastSync}</span>
          <button
            onClick={load}
            disabled={refreshing}
            aria-label="รีเฟรช"
            className="text-xs text-shift-blue-text hover:text-ink disabled:text-ink-faint transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-shift-blue-text rounded"
          >
            {refreshing ? "กำลังรีเฟรช..." : "รีเฟรช"}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl bg-alert-rose-bg border-[0.5px] border-alert-rose-text/40 text-alert-rose-text p-4 mb-4">
          {err}
        </div>
      )}

      {loading && !err && <p className="text-ink-faint">กำลังโหลด...</p>}
      {!loading && !err && logs.length === 0 && <p className="text-ink-faint">ไม่มีงานค้าง</p>}

      <div className="space-y-3">
        {logs.map((l) => (
          <div key={l.id} className="rounded-2xl bg-graphite-surface border-[0.5px] border-hairline p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xl font-bold text-shift-blue-text">
                {l.machines?.code ?? `machine ${l.machine_id}`}
              </span>
              <span className="text-xs text-ink-faint">#{l.id}</span>
            </div>
            <div className="text-sm text-ink-muted space-y-1">
              <div>lot: {l.lot_no}</div>
              <div>มีด: {l.knives?.code ?? l.knife_id}</div>
              <div>
                พนักงาน:{" "}
                {l.employees_production_logs_operator_idToemployees?.name ?? l.operator_id}
              </div>
              <div>เริ่ม: {new Date(l.started_at).toLocaleTimeString("th-TH")}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}