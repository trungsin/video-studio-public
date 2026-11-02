"use client";
import { useState } from "react";
import { type GNode, NODE_LABEL, type NodeKind, sceneSec, type Warn, words } from "@/lib/graph";
import type { CanvasCtx } from "@/lib/graph-store";
import { isVideoRef, thumbUrl } from "@/lib/media-url";
import type { ArchiveView } from "@/lib/thumbs";

type Change = (id: string, patch: Record<string, any> | null, newType?: NodeKind) => void;
const L = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="block space-y-0.5"><span className="text-[10px] font-semibold uppercase text-slate-400">{t}</span>{children}</label>;
const inp = "w-full rounded border border-slate-200 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none";

interface CommonsHit { title: string; page: string; author: string; license: string; width: number; height: number; thumb: string; description?: string; date?: string }

function ArchivePicker({ onPick, onAdded, defaultQuery }: { onPick: (a: ArchiveView) => void; onAdded: (a: ArchiveView) => void; defaultQuery?: string }) {
  const [q, setQ] = useState(defaultQuery || "");
  const [res, setRes] = useState<{ local: ArchiveView[]; commons: CommonsHit[]; error?: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [topic, setTopic] = useState("canvas");
  const search = async (commons: boolean) => {
    setBusy(commons ? "commons" : "local");
    try { const r = await fetch(`/api/archive?q=${encodeURIComponent(q)}${commons ? "&commons=1" : ""}`); setRes(await r.json()); } finally { setBusy(""); }
  };
  const add = async (h: CommonsHit) => {
    setBusy(h.title);
    try {
      const r = await fetch("/api/archive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, title: h.title }) });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "Lỗi tải ảnh"); return; }
      onAdded(j.item); onPick(j.item);
    } finally { setBusy(""); }
  };
  return (
    <div className="space-y-1.5 rounded border border-slate-200 p-2">
      <div className="flex gap-1"><input className={inp} value={q} placeholder="VD: Bạch Đằng, trống đồng…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search(false)} />
        <button className="btn !px-2" onClick={() => search(false)} disabled={!!busy}>Thư viện</button></div>
      <button className="btn w-full justify-center" onClick={() => search(true)} disabled={!!busy || !q}>{busy === "commons" ? "Đang tìm Commons…" : "Tìm thêm trên Wikimedia Commons"}</button>
      {res?.error && <div className="text-[10px] text-rose-600">{res.error}</div>}
      {res && (
        <div className="max-h-[360px] space-y-1 overflow-y-auto">
          {res.local.length > 0 && <div className="text-[10px] font-semibold text-slate-400">Thư viện ({res.local.length})</div>}
          <div className="grid grid-cols-3 gap-1">
            {res.local.slice(0, 30).map((a) => (
              <button key={a.id} title={`${a.label}\n${a.credit}`} onClick={() => onPick(a)} className="overflow-hidden rounded border border-slate-200 text-left hover:border-blue-400">
                <img src={a.thumb.replace("w=360", "w=160")} alt="" loading="lazy" className="h-16 w-full object-cover" />
                <div className="truncate px-0.5 text-[9px]">{a.label}</div>
              </button>
            ))}
          </div>
          {res.commons.length > 0 && <>
            <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400">Commons ({res.commons.length}) · lưu vào chủ đề <input className="w-20 rounded border px-1 text-[10px]" value={topic} onChange={(e) => setTopic(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} /></div>
            {res.commons.map((h) => (
              <div key={h.title} className="flex gap-1.5 rounded border border-slate-100 p-1">
                {h.thumb && <img src={h.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-14 w-14 shrink-0 rounded object-cover" />}
                <div className="min-w-0 flex-1 text-[9.5px]">
                  <a href={h.page} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium text-blue-700">{h.title.replace(/^File:/, "")}</a>
                  <div className="truncate text-slate-500">{h.author} · <b>{h.license}</b> · {h.width}×{h.height}</div>
                  <button className="mt-0.5 rounded bg-blue-600 px-1.5 text-[9.5px] text-white disabled:opacity-50" disabled={!!busy} onClick={() => add(h)}>{busy === h.title ? "Đang tải…" : "Tải về + dùng"}</button>
                </div>
              </div>
            ))}
          </>}
          {!res.local.length && !res.commons.length && <div className="text-[10px] text-slate-400">Không thấy ảnh phù hợp.</div>}
        </div>
      )}
    </div>
  );
}

export default function NodePanel({ node, ctx, warns, onChange, onDelete, onArchiveAdded, archive }: {
  node: GNode; ctx: CanvasCtx; warns: Warn[]; onChange: Change; onDelete: (id: string) => void; onArchiveAdded: (a: ArchiveView) => void; archive: Record<string, ArchiveView>;
}) {
  const d = node.data || {};
  const set = (patch: Record<string, any>) => onChange(node.id, patch);
  const kind = node.type;
  const scene = kind === "hook" || kind === "scene" || kind === "cta";
  const a = d.id ? archive[d.id] : undefined;
  return (
    <div className="space-y-2.5 p-3 text-xs">
      <div className="flex items-center gap-2">
        <div className="flex-1 text-sm font-bold">{NODE_LABEL[kind]}</div>
        {kind !== "video" && kind !== "idea" && <button className="btn-danger !px-2 !py-0.5" onClick={() => onDelete(node.id)}>Xoá nút</button>}
      </div>
      {warns.length > 0 && <div className="space-y-0.5 rounded bg-slate-50 p-2">{warns.map((w, k) => <div key={k} className={w.level === "error" ? "text-rose-600" : w.level === "warn" ? "text-amber-700" : "text-slate-500"}>{w.level === "error" ? "⛔" : w.level === "warn" ? "⚠" : "ℹ"} {w.text}</div>)}</div>}

      {scene && <>
        <L t="Loại cảnh"><select className={inp} value={kind} onChange={(e) => onChange(node.id, null, e.target.value as NodeKind)}><option value="hook">Hook (mở đầu)</option><option value="scene">Cảnh</option><option value="cta">CTA (kết)</option></select></L>
        <L t="Tiêu đề cảnh (chữ trên màn hình)"><input className={inp} value={d.title || ""} onChange={(e) => set({ title: e.target.value })} /></L>
        <L t={`Lời đọc · ${words(d.narration)} từ · ≈${sceneSec(d.narration).toFixed(1)}s`}><textarea className={`${inp} h-32`} value={d.narration || ""} onChange={(e) => set({ narration: e.target.value })} /></L>
        <L t="Mô tả hình (prompt nếu phải sinh ảnh AI)"><textarea className={`${inp} h-16`} value={d.visual || ""} onChange={(e) => set({ visual: e.target.value })} /></L>
        <div className="grid grid-cols-2 gap-2">
          <L t="Chuyển động"><select className={inp} value={d.motion || ""} onChange={(e) => set({ motion: e.target.value || undefined })}><option value="">Mặc định</option><option value="kenburns">Ken Burns (ảnh tĩnh)</option><option value="video">Clip / image-to-video</option></select></L>
          <L t="Clip bắt đầu (s)"><input className={inp} type="number" step="0.1" min="0" value={d.clipStart ?? ""} onChange={(e) => set({ clipStart: e.target.value === "" ? undefined : Number(e.target.value) })} /></L>
        </div>
        {d.extra && <div className="text-[10px] text-slate-400">Giữ nguyên trường khác: {Object.keys(d.extra).join(", ")}</div>}
      </>}

      {kind === "fact" && <>
        <L t="Khẳng định"><textarea className={`${inp} h-20`} value={d.claim || ""} onChange={(e) => set({ claim: e.target.value })} /></L>
        <L t="Nguồn (tên sách/trang)"><input className={inp} value={d.source || ""} onChange={(e) => set({ source: e.target.value })} /></L>
        <L t="URL nguồn"><input className={inp} value={d.url || ""} placeholder="https://…" onChange={(e) => set({ url: e.target.value })} /></L>
        {d.url && /^https?:\/\//.test(d.url) && <a href={d.url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-700">Mở nguồn ↗</a>}
        <L t="Kết luận"><select className={inp} value={["Đúng", "Đúng (có lưu ý)", "Chưa kiểm", "Không chắc", "Sai"].includes(d.verdict) ? d.verdict : "__"} onChange={(e) => e.target.value !== "__" && set({ verdict: e.target.value })}>
          <option>Đúng</option><option>Đúng (có lưu ý)</option><option>Chưa kiểm</option><option>Không chắc</option><option>Sai</option><option value="__">{d.verdict || "(khác)"}</option></select></L>
        <textarea className={`${inp} h-14`} value={d.verdict || ""} onChange={(e) => set({ verdict: e.target.value })} />
        <div className="text-[10px] text-slate-400">Nối chấm trên của fact vào chấm dưới của cảnh. URL mới sẽ được thêm vào nguồn của video khi “Tạo kịch bản”.</div>
      </>}

      {kind === "character" && <>
        <div className="text-[11px]"><b>{ctx.characterName || d.name || "An"}</b> — chọn ảnh/clip có sẵn để không phải sinh khuôn mặt mới.</div>
        <div className="grid grid-cols-3 gap-1">
          {ctx.an.map((m) => {
            const on = m.kind === "clip" ? d.clip === m.ref : d.image === m.ref && !d.clip;
            return (
              <button key={m.ref} title={m.ref} onClick={() => set(m.kind === "clip" ? { clip: m.ref } : { image: m.ref, ...(on ? {} : {}) })} className={`overflow-hidden rounded border text-left ${on || d.clip === m.ref || d.image === m.ref ? "border-blue-500 ring-1 ring-blue-400" : "border-slate-200"}`}>
                <div className="relative"><img src={thumbUrl(m.ref, 120)} alt="" loading="lazy" className="h-20 w-full object-cover" />{m.kind === "clip" && <span className="absolute bottom-0 right-0 bg-black/60 px-1 text-[9px] text-white">▶ clip</span>}</div>
                <div className="truncate px-0.5 text-[9px]">{m.label || m.ref.split("/").pop()}</div>
              </button>
            );
          })}
        </div>
        <div className="flex gap-1">{d.clip && <button className="btn !px-2 !py-0.5" onClick={() => set({ clip: undefined })}>Bỏ clip</button>}{d.image && <button className="btn !px-2 !py-0.5" onClick={() => set({ image: undefined })}>Bỏ ảnh</button>}</div>
        <div className="text-[10px] text-slate-400">Clip được ưu tiên hơn ảnh. Ảnh + chuyển động “Clip/i2v” sẽ gọi image-to-video (có thể đổi mặt).</div>
      </>}

      {kind === "media" && <>
        <L t="Đường dẫn (MEDIA_DIR hoặc assets/…)"><input className={inp} value={d.ref || ""} onChange={(e) => set({ ref: e.target.value.replace(/^\/+/, "") })} /></L>
        {d.ref && <img src={thumbUrl(d.ref, 270)} alt="" className="max-h-56 rounded" />}
        <div className="text-[10px] text-slate-400">{isVideoRef(d.ref || "") ? "Clip (tiếng bị tắt)" : "Ảnh tĩnh"}</div>
      </>}

      {kind === "archive" && <>
        {a ? <div className="space-y-1"><img src={a.thumb} alt="" className="max-h-56 rounded" /><div className="text-[10px] text-slate-500">{a.title}</div><div className="text-[10px]"><b>{a.license}</b> · {a.author} · <a className="text-blue-700" href={a.page} target="_blank" rel="noreferrer">Commons ↗</a></div><div className="text-[10px] text-slate-400">Credit: {a.credit}</div></div>
          : d.id ? <div className="text-rose-600">Không thấy {d.id} trong thư viện</div> : null}
        <div className="grid grid-cols-2 gap-2">
          <L t="Nhãn trên ảnh"><input className={inp} value={d.label || ""} onChange={(e) => set({ label: e.target.value || undefined })} /></L>
          <L t="Kiểu khung"><select className={inp} value={d.mode || "frame"} onChange={(e) => set({ mode: e.target.value })}><option value="frame">frame (khung tư liệu)</option><option value="detail">detail (cận)</option><option value="pan">pan (lia)</option><option value="backdrop">backdrop (nền mờ)</option></select></L>
        </div>
        {!d.id && <L t="Hoặc tự tìm theo từ khoá khi render"><input className={inp} value={d.query || ""} onChange={(e) => set({ query: e.target.value || undefined })} /></L>}
        <ArchivePicker defaultQuery={d.label || d.query} onAdded={onArchiveAdded} onPick={(x) => set({ id: x.id, query: undefined, topic: undefined, n: undefined, label: d.label || x.label })} />
        <div className="text-[10px] text-slate-400">Chỉ nhận PD / CC0 / CC BY / CC BY-SA; credit tự ghi vào caption.</div>
      </>}

      {kind === "chart" && (() => {
        const c = d.chart || { type: "kpi", values: [] };
        const n = Math.max(c.values?.length || 0, c.labels?.length || 0);
        const setAt = (key: "values" | "labels" | "units", k: number, val: string) => {
          const arr = [...(c[key] || [])]; while (arr.length < n) arr.push(key === "values" ? 0 : "");
          arr[k] = key === "values" ? Number(val) || 0 : val; set({ chart: { ...c, [key]: arr } });
        };
        return <>
          <L t="Loại"><input className={inp} value={c.type || ""} onChange={(e) => set({ chart: { ...c, type: e.target.value } })} /></L>
          {Array.from({ length: n }).map((_, k) => (
            <div key={k} className="grid grid-cols-[1fr_80px_50px_20px] gap-1">
              <input className={inp} placeholder="nhãn" value={c.labels?.[k] || ""} onChange={(e) => setAt("labels", k, e.target.value)} />
              <input className={inp} type="number" value={c.values?.[k] ?? 0} onChange={(e) => setAt("values", k, e.target.value)} />
              <input className={inp} placeholder="đơn vị" value={c.units?.[k] || ""} onChange={(e) => setAt("units", k, e.target.value)} />
              <button className="text-rose-500" onClick={() => set({ chart: { ...c, values: (c.values || []).filter((_: unknown, j: number) => j !== k), labels: (c.labels || []).filter((_: unknown, j: number) => j !== k), units: (c.units || []).filter((_: unknown, j: number) => j !== k), ...(c.decs ? { decs: c.decs.filter((_: unknown, j: number) => j !== k) } : {}) } })}>×</button>
            </div>
          ))}
          <button className="btn" onClick={() => set({ chart: { ...c, values: [...(c.values || []), 0], labels: [...(c.labels || []), ""], units: [...(c.units || []), ""], ...(c.decs ? { decs: [...c.decs, 0] } : {}) } })}>+ Thêm số</button>
        </>;
      })()}

      {kind === "idea" && <div className="space-y-1"><div className="font-semibold">{d.title}</div><div className="text-slate-500">{d.angle}</div>{ctx.ideaId && <a className="text-blue-700" href={`/y-tuong/${ctx.ideaId}`}>Mở trang ý tưởng ↗</a>}</div>}

      {kind === "video" && <div className="space-y-1 text-slate-600">
        <div className="font-semibold">{d.title}</div>
        {ctx.video ? <>
          <div>Trạng thái: <b>{ctx.video.status}</b> · render: {ctx.video.renderState}</div>
          {ctx.video.output && ctx.video.renderState === "done" && <video src={`/api/media/${ctx.video.output.split("/").map(encodeURIComponent).join("/")}`} controls preload="none" poster={thumbUrl(ctx.video.output, 360)} className="w-full rounded" />}
        </> : <div>Chưa có video: “Tạo kịch bản” sẽ ghi vào kịch bản của ý tưởng.</div>}
      </div>}
    </div>
  );
}
