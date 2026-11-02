"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EditorialPreview, EditorialScheduleConfig } from "@/lib/editorial-schedule";

export default function EditorialScheduleControls({ preview, name }: { preview: EditorialPreview; name: string }) {
  const router = useRouter();
  const [config, setConfig] = useState(preview.config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function update(patch: Partial<EditorialScheduleConfig> & { restoreDate?: string }) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/schedule", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Không thể lưu cấu hình");
      setConfig(body);
      router.refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="card p-4 space-y-3" aria-label={`Lịch tự động ${name}`}>
    <div><h2 className="font-semibold">{name} · đề xuất 07:00 và 11:30 (giờ Việt Nam)</h2>
      <p className="text-xs text-slate-500">Mỗi khung dùng một video riêng đã render và có nguồn/kịch bản duyệt. Đăng thật là công tắc riêng; tắt lịch không hủy bài đã đặt.</p></div>
    <div className="flex flex-wrap gap-4 text-sm">
      <label><input type="checkbox" checked={config.enabled} disabled={busy} onChange={(e) => update({ enabled: e.target.checked })} /> Bật tự động đặt lịch</label>
      <label><input type="checkbox" checked={config.paused} disabled={busy} onChange={(e) => update({ paused: e.target.checked })} /> Tạm dừng đặt mới</label>
      <label><input type="checkbox" checked={config.publishEnabled} disabled={busy} onChange={(e) => update({ publishEnabled: e.target.checked })} /> Cho phép publisher xử lý bài đến giờ</label>
    </div>
    <p className="text-xs text-amber-700">Worker đặt lịch còn cần EDITORIAL_SCHEDULE_ENABLED=1; PUBLISH_DRY_RUN=1 chỉ mô phỏng, không đánh dấu đã đăng. Bỏ lịch đã tạo sẽ tạm ngừng tự đặt thêm cho cả ngày đó cho tới khi bật lại.</p>
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    {config.suppressedDates.length > 0 && <div className="text-xs">Ngày đã bỏ qua: {config.suppressedDates.map((date) =>
      <button key={date} disabled={busy} className="btn ml-2" onClick={() => update({ restoreDate: date })}>{date} · cho phép đặt lại</button>)}</div>}
    {preview.proposals.length > 0 && <div className="space-y-1 text-xs">{preview.proposals.map((p) =>
      <div key={`${p.date}-${p.time}`} className="rounded border border-slate-200 p-2"><strong>{p.date} {p.time}</strong> · {p.title} ({p.pillar || "chưa gán trụ cột"})
        <div>Nền tảng có thể đăng: {p.platforms.join(", ")}</div>
        {p.blocked.length > 0 && <div className="text-amber-700">Loại khỏi bài này: {p.blocked.join("; ")}</div>}
      </div>)}</div>}
    {preview.blockers.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-700">{[...new Set(preview.blockers)].map((b) => <li key={b}>{b}</li>)}</ul>}
  </section>;
}
