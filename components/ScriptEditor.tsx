"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Script } from "@/lib/types";

export default function ScriptEditor({ id, script, readOnly }: { id: string; script?: Script; readOnly?: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<Script>(script || { scenes: [{ title: "", narration: "" }], caption: "", hashtags: [] });
  const [saved, setSaved] = useState(false);
  const words = s.scenes.reduce((n, x) => n + (x.narration.trim() ? x.narration.trim().split(/\s+/).length : 0), 0);
  const upd = (k: number, patch: Partial<Script["scenes"][number]>) => setS({ ...s, scenes: s.scenes.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
  async function save() {
    const r = await fetch(`/api/ideas/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ script: s }) });
    if (!r.ok) alert((await r.json()).error); else { setSaved(true); setTimeout(() => setSaved(false), 1500); router.refresh(); }
  }
  return (
    <div className="card">
      <div className="card-h">
        <h2 className="text-sm font-semibold">Kịch bản <span className="ml-1 text-xs font-normal text-slate-400">{s.scenes.length} cảnh · {words} từ · ~{Math.round(words / 2.4)}s</span></h2>
        {!readOnly && <button className="btn-primary" onClick={save}>{saved ? "Đã lưu ✓" : "Lưu kịch bản"}</button>}
      </div>
      <div className="divide-y divide-slate-100">
        {s.scenes.map((sc, k) => (
          <div key={k} className="grid grid-cols-[28px_1fr] gap-3 px-4 py-3">
            <div className="font-mono text-xs text-slate-400">{k + 1}</div>
            <div className="space-y-1.5">
              <input disabled={readOnly} className="input font-semibold" placeholder="Tiêu đề trên màn hình" value={sc.title} onChange={(e) => upd(k, { title: e.target.value })} />
              <textarea disabled={readOnly} className="input min-h-[56px]" placeholder="Lời đọc" value={sc.narration} onChange={(e) => upd(k, { narration: e.target.value })} />
              <input disabled={readOnly} className="input text-xs text-slate-500" placeholder="Hình ảnh / prompt ảnh AI" value={sc.visual || ""} onChange={(e) => upd(k, { visual: e.target.value })} />
              {!readOnly && <button className="text-[11px] text-red-500" onClick={() => setS({ ...s, scenes: s.scenes.filter((_, j) => j !== k) })}>Xoá cảnh</button>}
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t border-slate-100 px-4 py-3">
        {!readOnly && <button className="btn" onClick={() => setS({ ...s, scenes: [...s.scenes, { title: "", narration: "" }] })}>+ Thêm cảnh</button>}
        <textarea disabled={readOnly} className="input" placeholder="Caption đăng bài" value={s.caption} onChange={(e) => setS({ ...s, caption: e.target.value })} />
        <input disabled={readOnly} className="input font-mono text-xs" placeholder="#hashtag cách nhau bởi dấu cách" value={s.hashtags.join(" ")} onChange={(e) => setS({ ...s, hashtags: e.target.value.split(/\s+/).filter(Boolean) })} />
      </div>
    </div>
  );
}
