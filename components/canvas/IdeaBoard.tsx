"use client";
import "@xyflow/react/dist/style.css";
import { Background, Controls, MiniMap, type Node, type NodeProps, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { useRouter } from "next/navigation";
import { memo, useMemo, useState } from "react";
import type { BoardCard, BoardStatus } from "@/lib/graph-store";

export const STATUS_META: Record<BoardStatus, { label: string; bg: string; border: string; dot: string; hex: string }> = {
  idea: { label: "Ý tưởng", bg: "bg-slate-50", border: "border-slate-300", dot: "bg-slate-400", hex: "#94a3b8" },
  scripted: { label: "Có kịch bản", bg: "bg-sky-50", border: "border-sky-400", dot: "bg-sky-500", hex: "#0ea5e9" },
  rendered: { label: "Đã render", bg: "bg-amber-50", border: "border-amber-400", dot: "bg-amber-500", hex: "#f59e0b" },
  scheduled: { label: "Chờ đăng", bg: "bg-indigo-50", border: "border-indigo-400", dot: "bg-indigo-500", hex: "#6366f1" },
  published: { label: "Đã đăng", bg: "bg-emerald-50", border: "border-emerald-500", dot: "bg-emerald-500", hex: "#10b981" },
};
const ORDER: BoardStatus[] = ["idea", "scripted", "rendered", "scheduled", "published"];

const CW = 168, CH = 74, GAP = 8, PER = 2, LABEL_W = 170, HEAD_H = 70;
const COL_W = PER * (CW + GAP) + 24;

type CardData = BoardCard & { dim: boolean };
const Card = memo(function Card({ data }: NodeProps) {
  const c = data as unknown as CardData; const m = STATUS_META[c.status];
  return (
    <div title={`${c.title}\n${c.hook || ""}`} style={{ width: CW, height: CH, opacity: c.dim ? 0.13 : 1 }}
      className={`flex cursor-pointer gap-1.5 overflow-hidden rounded-md border-2 ${m.border} ${m.bg} p-1 shadow-sm transition-opacity hover:shadow-md`}>
      {c.thumb?.thumb ? <img src={c.thumb.thumb.replace(/w=\d+/, "w=90")} alt="" loading="lazy" decoding="async" className="h-full w-[36px] shrink-0 rounded object-cover" />
        : <div className="h-full w-[36px] shrink-0 rounded bg-slate-200" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[9px] text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} /><span className="font-mono">{c.stt ? `#${c.stt}` : ""}</span><span className="truncate">{c.videoId || ""}</span></div>
        <div className="line-clamp-3 text-[10.5px] font-semibold leading-tight text-slate-800">{c.title}</div>
      </div>
    </div>
  );
});
const EraHead = memo(function EraHead({ data }: NodeProps) {
  const d = data as { code: string; name: string; years: string; n: number; dim: boolean };
  return <div style={{ width: COL_W - 12, opacity: d.dim ? 0.3 : 1 }} className="rounded-lg bg-slate-800 px-2 py-1.5 text-white"><div className="text-[10px] font-mono text-slate-300">{d.code} · {d.years} · {d.n}</div><div className="line-clamp-2 text-[12px] font-semibold leading-tight">{d.name}</div></div>;
});
const SeriesHead = memo(function SeriesHead({ data }: NodeProps) {
  const d = data as { name: string; n: number; h: number; dim: boolean; code?: string };
  return <div style={{ width: LABEL_W - 14, height: d.h - 8, opacity: d.dim ? 0.3 : 1 }} className="flex flex-col justify-center rounded-lg border border-violet-200 bg-violet-50 px-2"><div className="text-[12px] font-bold leading-tight text-violet-900">{d.name}</div><div className="text-[10px] text-violet-600">{d.n} ý tưởng{d.code ? ` · ${d.code}` : ""}</div></div>;
});
const Band = memo(function Band({ data }: NodeProps) {
  const d = data as { w: number; h: number; odd: boolean };
  return <div style={{ width: d.w, height: d.h }} className={`pointer-events-none rounded-lg ${d.odd ? "bg-slate-100/70" : "bg-white/60"}`} />;
});
const nodeTypes = { card: Card, era: EraHead, series: SeriesHead, band: Band };

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

export interface EraMeta { code: string; name: string; years: string }
export interface SeriesMeta { name: string; code?: string }

function Inner({ cards, eras, series }: { cards: BoardCard[]; eras: EraMeta[]; series: SeriesMeta[] }) {
  const router = useRouter();
  const { fitView } = useReactFlow();
  const [q, setQ] = useState("");
  const [st, setSt] = useState<Set<BoardStatus>>(new Set(ORDER));
  const [ser, setSer] = useState("");
  const [era, setEra] = useState("");

  const counts = useMemo(() => Object.fromEntries(ORDER.map((s) => [s, cards.filter((c) => c.status === s).length])) as Record<BoardStatus, number>, [cards]);
  const match = useMemo(() => {
    const toks = fold(q).split(/\s+/).filter(Boolean);
    return (c: BoardCard) => st.has(c.status) && (!ser || c.series === ser) && (!era || c.era === era)
      && toks.every((t) => fold(`${c.title} ${c.id} ${c.videoId || ""} ${c.hook || ""} ${c.stt ? `#${c.stt}` : ""}`).includes(t));
  }, [q, st, ser, era]);
  const nMatch = cards.filter(match).length;

  // bố cục cố định: cột = thời kỳ, hàng = series
  const layout = useMemo(() => {
    const allSeries = [...series.map((s) => s.name), ...[...new Set(cards.map((c) => c.series))].filter((s) => !series.some((x) => x.name === s))];
    const allEras = [...eras, ...[...new Set(cards.map((c) => c.era))].filter((e) => !eras.some((x) => x.code === e)).map((code) => ({ code, name: cards.find((c) => c.era === code)?.eraName || code, years: "" }))];
    const cell = new Map<string, BoardCard[]>();
    for (const c of cards) { const k = `${c.series}|${c.era}`; (cell.get(k) || cell.set(k, []).get(k)!).push(c); }
    const rows = allSeries.map((s) => Math.max(1, ...allEras.map((e) => Math.ceil((cell.get(`${s}|${e.code}`)?.length || 0) / PER))));
    const rowY: number[] = []; let y = HEAD_H;
    rows.forEach((r) => { rowY.push(y); y += r * (CH + GAP) + 18; });
    return { allSeries, allEras, cell, rows, rowY, totalW: LABEL_W + allEras.length * COL_W, totalH: y };
  }, [cards, eras, series]);

  const nodes: Node[] = useMemo(() => {
    const out: Node[] = [];
    const { allSeries, allEras, cell, rows, rowY, totalW } = layout;
    allSeries.forEach((s, r) => {
      const h = rows[r] * (CH + GAP) + 10;
      out.push({ id: `band-${r}`, type: "band", position: { x: 0, y: rowY[r] - 6 }, data: { w: totalW, h, odd: r % 2 === 1 }, draggable: false, selectable: false, focusable: false, zIndex: -1 });
      const n = cards.filter((c) => c.series === s).length;
      out.push({ id: `ser-${r}`, type: "series", position: { x: 4, y: rowY[r] - 2 }, data: { name: s, n, h, dim: !!ser && ser !== s, code: series.find((x) => x.name === s)?.code }, draggable: false, selectable: false });
    });
    allEras.forEach((e, k) => {
      out.push({ id: `era-${e.code}`, type: "era", position: { x: LABEL_W + k * COL_W, y: 0 }, data: { ...e, n: cards.filter((c) => c.era === e.code).length, dim: !!era && era !== e.code }, draggable: false, selectable: false });
      allSeries.forEach((s, r) => {
        (cell.get(`${s}|${e.code}`) || []).forEach((c, j) => out.push({
          id: c.id, type: "card", position: { x: LABEL_W + k * COL_W + (j % PER) * (CW + GAP), y: rowY[r] + Math.floor(j / PER) * (CH + GAP) },
          data: { ...c, dim: !match(c) } as unknown as Record<string, unknown>, draggable: false, connectable: false,
        }));
      });
    });
    return out;
  }, [layout, cards, match, ser, era, series]);

  const toggle = (s: BoardStatus) => setSt((cur) => { const n = new Set(cur); if (n.has(s)) n.delete(s); else n.add(s); return n.size ? n : new Set(ORDER); });
  const focus = () => { const ids = cards.filter(match).map((c) => ({ id: c.id })); if (ids.length) setTimeout(() => fitView({ nodes: ids, padding: 0.2, duration: 350, maxZoom: 1.2 }), 30); };

  return (
    <div className="fixed inset-y-0 left-[200px] right-0 z-10 flex flex-col bg-slate-50">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Bảng ý tưởng</div><div className="text-sm font-bold">{cards.length} ý tưởng · thời kỳ × series</div></div>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && focus()} placeholder="Tìm: Bạch Đằng, #42, vid-su-20…" className="ml-2 w-56 rounded border border-slate-200 px-2 py-1 text-xs" />
        <select value={era} onChange={(e) => setEra(e.target.value)} className="rounded border border-slate-200 px-1 py-1 text-xs"><option value="">Mọi thời kỳ</option>{layout.allEras.map((e) => <option key={e.code} value={e.code}>{e.code} · {e.name}</option>)}</select>
        <select value={ser} onChange={(e) => setSer(e.target.value)} className="rounded border border-slate-200 px-1 py-1 text-xs"><option value="">Mọi series</option>{layout.allSeries.map((s) => <option key={s}>{s}</option>)}</select>
        <button className="btn" onClick={focus}>Phóng tới {nMatch} kết quả</button>
        <button className="btn" onClick={() => fitView({ padding: 0.05, duration: 300 })}>Toàn cảnh</button>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {ORDER.map((s) => (
            <button key={s} onClick={() => toggle(s)} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${st.has(s) ? `${STATUS_META[s].border} ${STATUS_META[s].bg}` : "border-slate-200 text-slate-300 line-through"}`}>
              <span className={`h-2 w-2 rounded-full ${STATUS_META[s].dot}`} />{STATUS_META[s].label} <b>{counts[s]}</b>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
          onNodeClick={(_, n) => n.type === "card" && router.push((n.data as unknown as BoardCard).href)}
          fitView fitViewOptions={{ padding: 0.03 }} minZoom={0.08} maxZoom={2} onlyRenderVisibleElements proOptions={{ hideAttribution: true }} panOnScroll={false}>
          <Background gap={40} size={1} />
          <MiniMap pannable zoomable nodeColor={(n) => (n.type === "card" ? STATUS_META[(n.data as unknown as BoardCard).status].hex : n.type === "band" ? "transparent" : "#334155")} className="!h-28 !w-48" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function IdeaBoard(props: { cards: BoardCard[]; eras: EraMeta[]; series: SeriesMeta[] }) {
  return <ReactFlowProvider><Inner {...props} /></ReactFlowProvider>;
}
