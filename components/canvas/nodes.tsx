"use client";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { createContext, memo, useContext } from "react";
import { type Analysis, NODE_LABEL, type NodeKind, sceneSec, type Warn, words } from "@/lib/graph";
import { isVideoRef, thumbUrl } from "@/lib/media-url";
import type { ArchiveView } from "@/lib/thumbs";

export interface CanvasShared { analysis: Analysis; archive: Record<string, ArchiveView>; maxSec: number; videoStatus?: string }
export const CanvasCtx = createContext<CanvasShared>({ analysis: { byNode: {}, global: [], totalSec: 0, maxSec: 45, order: [], words: 0 }, archive: {}, maxSec: 45 });

const HEAD: Record<NodeKind, string> = {
  idea: "bg-violet-600", hook: "bg-rose-600", scene: "bg-slate-700", cta: "bg-emerald-600", fact: "bg-sky-600",
  character: "bg-amber-600", media: "bg-stone-500", archive: "bg-yellow-700", chart: "bg-teal-600", video: "bg-blue-700",
};
const ICON: Record<NodeKind, string> = { idea: "💡", hook: "🎣", scene: "🎬", cta: "📣", fact: "📚", character: "🧑", media: "🖼", archive: "📷", chart: "📊", video: "▶" };
const host = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };
const H = "!h-3 !w-3 !border-2 !border-white";

function Warns({ list }: { list?: Warn[] }) {
  if (!list?.length) return null;
  const err = list.some((w) => w.level === "error"), warn = list.some((w) => w.level === "warn");
  const shown = list.filter((w) => w.level !== "info");
  return (
    <div className="space-y-0.5 border-t border-slate-100 px-2 py-1" title={list.map((w) => w.text).join("\n")}>
      {(shown.length ? shown : list).slice(0, 2).map((w, k) => (
        <div key={k} className={`line-clamp-2 text-[9.5px] leading-tight ${w.level === "error" ? "text-rose-600" : w.level === "warn" ? "text-amber-700" : "text-slate-400"}`}>{w.level === "error" ? "⛔" : w.level === "warn" ? "⚠" : "ℹ"} {w.text}</div>
      ))}
      {list.length > 2 && <div className="text-[9px] text-slate-400">+{list.length - 2} lưu ý</div>}
      <span className="hidden">{err ? "e" : warn ? "w" : "i"}</span>
    </div>
  );
}

function Shell({ id, kind, selected, children, width = 220 }: { id: string; kind: NodeKind; selected?: boolean; children: React.ReactNode; width?: number }) {
  const { analysis } = useContext(CanvasCtx);
  const ws = analysis.byNode[id];
  const border = ws?.some((w) => w.level === "error") ? "border-rose-400" : ws?.some((w) => w.level === "warn") ? "border-amber-300" : "border-slate-200";
  return (
    <div style={{ width }} className={`rounded-lg border-2 bg-white text-[11px] shadow-sm ${border} ${selected ? "ring-2 ring-blue-400" : ""}`}>
      <div className={`flex items-center gap-1 rounded-t-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white ${HEAD[kind]}`}>
        <span>{ICON[kind]}</span><span className="flex-1">{NODE_LABEL[kind]}</span>
        {analysis.order.includes(id) && <span className="rounded bg-white/25 px-1 font-mono">#{analysis.order.indexOf(id) + 1}</span>}
      </div>
      {children}
      <Warns list={ws} />
    </div>
  );
}

const Img = ({ src, video }: { src?: string; video?: boolean }) => src
  ? <div className="relative h-[86px] w-[48px] shrink-0 overflow-hidden rounded bg-slate-200"><img src={thumbUrl(src, 120)} alt="" loading="lazy" className="h-full w-full object-cover" />{video && <span className="absolute bottom-0 right-0 bg-black/60 px-0.5 text-[8px] text-white">▶</span>}</div>
  : <div className="grid h-[86px] w-[48px] shrink-0 place-items-center rounded bg-slate-100 text-[9px] text-slate-400">trống</div>;

export const SceneNode = memo(function SceneNode({ id, data, selected, type }: NodeProps) {
  const d = data as Record<string, any>; const kind = type as NodeKind;
  const w = words(d.narration);
  return (
    <Shell id={id} kind={kind} selected={selected} width={240}>
      <Handle type="target" position={Position.Left} id="prev" className={`${H} !bg-slate-500`} title="Cảnh trước" />
      <Handle type="target" position={Position.Top} id="visual" className={`${H} !bg-amber-500`} title="Hình: Nhân vật / Ảnh tư liệu / Ảnh có sẵn / Biểu đồ" />
      <Handle type="target" position={Position.Bottom} id="fact" className={`${H} !bg-sky-500`} title="Fact" />
      <Handle type="source" position={Position.Right} id="next" className={`${H} !bg-slate-700`} title="Cảnh sau / Video" />
      <div className="space-y-1 px-2 py-1.5">
        <div className="truncate font-semibold text-slate-800">{d.title || <span className="text-slate-400">(chưa có tiêu đề)</span>}</div>
        <div className="line-clamp-4 text-[10.5px] leading-snug text-slate-600">{d.narration || <span className="italic text-slate-400">Chưa có lời đọc</span>}</div>
        <div className="flex gap-2 text-[9.5px] text-slate-400"><span>≈{sceneSec(d.narration).toFixed(1)}s</span><span>{w} từ</span>{d.motion && <span>{d.motion === "video" ? "clip/i2v" : "Ken Burns"}</span>}{d.clipStart ? <span>từ {d.clipStart}s</span> : null}</div>
      </div>
    </Shell>
  );
});

export const FactNode = memo(function FactNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, any>;
  const v = String(d.verdict || "chưa kiểm");
  const cls = /^đúng/i.test(v) ? "bg-emerald-50 text-emerald-700" : /sai/i.test(v) ? "bg-rose-50 text-rose-700" : /không/i.test(v) ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700";
  return (
    <Shell id={id} kind="fact" selected={selected}>
      <Handle type="source" position={Position.Top} id="out" className={`${H} !bg-sky-500`} />
      <div className="space-y-1 px-2 py-1.5">
        <div className="line-clamp-3 text-[10.5px] leading-snug text-slate-700">{d.claim || <span className="italic text-slate-400">Chưa ghi khẳng định</span>}</div>
        <div className="line-clamp-2 text-[9.5px] text-slate-500">📎 {d.source || (d.url ? host(d.url) : <span className="text-rose-500">chưa có nguồn</span>)}</div>
        <span className={`inline-block max-w-full truncate rounded px-1 text-[9.5px] ${cls}`}>{v.slice(0, 60)}</span>
      </div>
    </Shell>
  );
});

export const CharacterNode = memo(function CharacterNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, any>;
  return (
    <Shell id={id} kind="character" selected={selected} width={200}>
      <Handle type="source" position={Position.Bottom} id="out" className={`${H} !bg-amber-500`} />
      <div className="flex gap-2 px-2 py-1.5">
        <Img src={d.clip || d.image} video={!!d.clip} />
        <div className="min-w-0 text-[10px] text-slate-600">
          <div className="font-semibold text-slate-800">{d.name || "An"}</div>
          {d.clip && <div className="truncate" title={d.clip}>🎞 {String(d.clip).split("/").slice(-3).join("/")}</div>}
          {d.image && <div className="truncate" title={d.image}>🖼 {String(d.image).split("/").pop()}</div>}
          <div className="mt-1 text-[9.5px] text-slate-400">{d.clip ? "Dùng lại clip có sẵn" : d.image ? "Ảnh có sẵn" : ""}</div>
        </div>
      </div>
    </Shell>
  );
});

export const MediaNode = memo(function MediaNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, any>;
  return (
    <Shell id={id} kind="media" selected={selected} width={200}>
      <Handle type="source" position={Position.Bottom} id="out" className={`${H} !bg-amber-500`} />
      <div className="flex gap-2 px-2 py-1.5"><Img src={d.ref} video={isVideoRef(d.ref || "")} /><div className="min-w-0 break-all text-[10px] text-slate-600">{String(d.ref || "").split("/").slice(-2).join("/")}</div></div>
    </Shell>
  );
});

export const ArchiveNode = memo(function ArchiveNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, any>;
  const { archive } = useContext(CanvasCtx);
  const a = d.id ? archive[d.id] : undefined;
  return (
    <Shell id={id} kind="archive" selected={selected} width={220}>
      <Handle type="source" position={Position.Bottom} id="out" className={`${H} !bg-amber-500`} />
      <div className="flex gap-2 px-2 py-1.5">
        {a?.thumb ? <div className="h-[86px] w-[64px] shrink-0 overflow-hidden rounded bg-slate-200"><img src={a.thumb.replace("w=360", "w=160")} alt="" loading="lazy" className="h-full w-full object-cover" /></div> : <Img />}
        <div className="min-w-0 space-y-0.5 text-[10px]">
          <div className="line-clamp-2 font-semibold text-slate-800">{d.label || a?.label || d.query || "(chưa chọn ảnh)"}</div>
          {a && <div className="line-clamp-2 text-slate-500">{a.credit}</div>}
          {d.query && !d.id && <div className="text-slate-500">Tự tìm: “{d.query}”</div>}
          <div className="text-[9.5px] text-slate-400">{d.mode || "frame"}</div>
        </div>
      </div>
    </Shell>
  );
});

export const ChartNode = memo(function ChartNode({ id, data, selected }: NodeProps) {
  const c = ((data as Record<string, any>).chart || {}) as { type?: string; values?: number[]; labels?: string[]; units?: string[] };
  return (
    <Shell id={id} kind="chart" selected={selected} width={200}>
      <Handle type="source" position={Position.Bottom} id="out" className={`${H} !bg-amber-500`} />
      <div className="space-y-0.5 px-2 py-1.5 text-[10.5px]">
        <div className="text-[9.5px] uppercase text-slate-400">{c.type || "kpi"}</div>
        {(c.values || []).map((v, k) => <div key={k} className="flex justify-between gap-2"><span className="truncate text-slate-500">{c.labels?.[k]}</span><b>{v.toLocaleString("vi-VN")}{c.units?.[k] || ""}</b></div>)}
      </div>
    </Shell>
  );
});

export const IdeaNode = memo(function IdeaNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, any>;
  return (
    <Shell id={id} kind="idea" selected={selected} width={240}>
      <Handle type="source" position={Position.Right} id="out" className={`${H} !bg-violet-500`} />
      <div className="space-y-1 px-2 py-1.5">
        <div className="font-semibold text-slate-800">{d.title}</div>
        <div className="text-[9.5px] text-violet-700">{[d.series, d.era].filter(Boolean).join(" · ")}</div>
        <div className="line-clamp-4 text-[10px] text-slate-500">{d.angle}</div>
      </div>
    </Shell>
  );
});

export const VideoNode = memo(function VideoNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, any>;
  const { analysis, maxSec, videoStatus } = useContext(CanvasCtx);
  const pct = Math.min(100, (analysis.totalSec / maxSec) * 100);
  return (
    <Shell id={id} kind="video" selected={selected} width={210}>
      <Handle type="target" position={Position.Left} id="in" className={`${H} !bg-blue-600`} />
      <div className="space-y-1 px-2 py-1.5">
        <div className="line-clamp-2 font-semibold text-slate-800">{d.title}</div>
        <div className="text-[10px] text-slate-500">{analysis.order.length} cảnh · {analysis.words} từ · ≈{analysis.totalSec.toFixed(0)}s / {maxSec}s</div>
        <div className="h-1.5 overflow-hidden rounded bg-slate-100"><div className={`h-full ${analysis.totalSec > maxSec ? "bg-rose-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} /></div>
        <div className="text-[9.5px] text-slate-400">{d.videoId || "chưa có video (ghi vào kịch bản ý tưởng)"}{videoStatus ? ` · ${videoStatus}` : ""}</div>
      </div>
    </Shell>
  );
});

export const nodeTypes = { idea: IdeaNode, hook: SceneNode, scene: SceneNode, cta: SceneNode, fact: FactNode, character: CharacterNode, media: MediaNode, archive: ArchiveNode, chart: ChartNode, video: VideoNode };
