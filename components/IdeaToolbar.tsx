"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function IdeaToolbar({ llm }: { llm: boolean }) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({ title: "", hook: "" });

  async function gen() {
    setBusy(true);
    const r = await fetch("/api/ideas/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, count }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) alert(j.error); else router.refresh();
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!manual.title.trim()) return;
    const r = await fetch("/api/ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(manual) });
    if (!r.ok) alert((await r.json()).error); else { setManual({ title: "", hook: "" }); router.refresh(); }
  }
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">✨ AI sinh ý tưởng</h3>
          <span className={`pill ${llm ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{llm ? "LLM đã cấu hình" : "Chưa cấu hình LLM · chế độ mẫu"}</span>
        </div>
        <div className="flex gap-2">
          <input className="input" placeholder="Chủ đề (tuỳ chọn), VD: bữa sáng 5 phút" value={topic} onChange={(e) => setTopic(e.target.value)} />
          <select className="input w-20" value={count} onChange={(e) => setCount(Number(e.target.value))}>{[3, 5, 8, 10].map((n) => <option key={n}>{n}</option>)}</select>
          <button className="btn-primary whitespace-nowrap" disabled={busy} onClick={gen}>{busy ? "Đang nghĩ…" : "Sinh ý tưởng"}</button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Dùng giọng văn &amp; thông tin trong Profile &amp; kênh làm ngữ cảnh.</p>
      </div>
      <form className="card p-4" onSubmit={add}>
        <h3 className="mb-2 text-sm font-semibold">+ Thêm ý tưởng thủ công</h3>
        <div className="flex gap-2">
          <input className="input" placeholder="Tiêu đề" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
          <input className="input" placeholder="Hook (tuỳ chọn)" value={manual.hook} onChange={(e) => setManual({ ...manual, hook: e.target.value })} />
          <button className="btn">Thêm</button>
        </div>
      </form>
    </div>
  );
}
