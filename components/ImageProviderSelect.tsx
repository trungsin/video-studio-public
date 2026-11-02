"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Chọn provider ảnh AI cho profile (trống = theo IMAGE_PROVIDER trong .env). */
export default function ImageProviderSelect({ slug, value, envDefault, options, configured }: {
  slug: string; value: string; envDefault: string; options: { id: string; label: string }[]; configured: Record<string, boolean>;
}) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [msg, setMsg] = useState("");
  async function save(next: string) {
    setV(next); setMsg("Đang lưu…");
    const r = await fetch(`/api/profiles/${slug}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ section: "meta", op: "update", item: { imageProvider: next } }) });
    setMsg(r.ok ? "Đã lưu ✓" : "Lỗi lưu"); setTimeout(() => setMsg(""), 1500); router.refresh();
  }
  return (
    <div className="card">
      <div className="card-h"><h2 className="text-sm font-semibold">Ảnh AI cho cảnh</h2><span className="text-[11px] text-slate-500">{msg}</span></div>
      <div className="space-y-2 p-4 text-xs">
        <select className="input" value={v} onChange={(e) => save(e.target.value)}>
          <option value="">Theo .env ({envDefault || "chưa cấu hình"})</option>
          {options.map((o) => <option key={o.id} value={o.id} disabled={!configured[o.id]}>{o.label}{configured[o.id] ? "" : " – thiếu key"}</option>)}
        </select>
        <p className="text-[11px] text-slate-500">Gemini gửi kèm ảnh ref nhân vật/bối cảnh (giữ mặt An nhất quán). Quanlop chỉ nhận prompt (API giới hạn 16 KB, chưa nhận ảnh ref); lỗi thì tự chuyển sang Gemini. Thêm provider khác (CLIProxyAPI…) ở trang <a className="text-blue-600 underline" href="/provider">Provider AI</a>.</p>
      </div>
    </div>
  );
}
