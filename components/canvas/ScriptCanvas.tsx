"use client";
import "@xyflow/react/dist/style.css";
import { Background, type Connection, Controls, type Edge, MiniMap, type Node, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow } from "@xyflow/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyze, autoLayout, canConnect, connectEdges, type GEdge, type GNode, graphToScenes, NODE_LABEL, type NodeKind, sceneOrder, sceneSec, type ScriptGraph } from "@/lib/graph";
import type { CanvasCtx as Ctx } from "@/lib/graph-store";
import { CanvasCtx, nodeTypes } from "./nodes";
import NodePanel from "./NodePanel";

const toRF = (g: ScriptGraph) => ({
  nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })) as Node[],
  edges: g.edges.map((e) => ({ ...e, type: "smoothstep", animated: e.targetHandle === "prev" || e.targetHandle === "in" })) as Edge[],
});
const fromRF = (nodes: Node[], edges: Edge[]): Pick<ScriptGraph, "nodes" | "edges"> => ({
  nodes: nodes.map((n) => ({ id: n.id, type: n.type as NodeKind, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data as Record<string, any> })),
  edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null })),
});

const ADD: { kind: NodeKind; data: () => Record<string, any> }[] = [
  { kind: "hook", data: () => ({ title: "", narration: "", motion: "video" }) },
  { kind: "scene", data: () => ({ title: "", narration: "" }) },
  { kind: "cta", data: () => ({ title: "Bạn nghĩ sao?", narration: "Bạn nghĩ sao? Bình luận nhé. Sử mình hay lắm. Mình là An, hẹn bạn ở trang sử tiếp theo.", motion: "video" }) },
  { kind: "fact", data: () => ({ claim: "", source: "", url: "", verdict: "chưa kiểm" }) },
  { kind: "character", data: () => ({ name: "An" }) },
  { kind: "archive", data: () => ({ mode: "frame" }) },
  { kind: "media", data: () => ({ ref: "" }) },
  { kind: "chart", data: () => ({ chart: { type: "kpi", values: [0, 0], labels: ["", ""], units: ["", ""], decs: [0, 0] } }) },
];

function Inner({ initial, ctx }: { initial: ScriptGraph; ctx: Ctx }) {
  const rf0 = useMemo(() => toRF(initial), [initial]);
  const [nodes, setNodes, onNodesChange] = useNodesState(rf0.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rf0.edges);
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone?: "ok" | "err" | "info" } | null>(ctx.notice ? { text: ctx.notice, tone: "info" } : null);
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState<string>("");
  const [video, setVideo] = useState(ctx.video);
  const [sourceHash, setSourceHash] = useState(initial.sourceHash);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);

  const graph = useMemo(() => fromRF(nodes, edges), [nodes, edges]);
  const analysis = useMemo(() => analyze(graph, { maxSec: ctx.maxSec, characterRefs: ctx.characterRefs, hasCharacter: !!ctx.characterId }), [graph, ctx]);
  const archiveMap = useMemo(() => Object.fromEntries(ctx.archive.map((a) => [a.id, a])), [ctx.archive]);
  const [extraArchive, setExtraArchive] = useState<Record<string, (typeof ctx.archive)[number]>>({});
  const shared = useMemo(() => ({ analysis, archive: { ...archiveMap, ...extraArchive }, maxSec: ctx.maxSec, videoStatus: video?.status }), [analysis, archiveMap, extraArchive, ctx.maxSec, video?.status]);

  // tự lưu bố cục (data/graphs) sau 1,5s không thao tác
  const lastSaved = useRef(JSON.stringify([fromRF(rf0.nodes, rf0.edges), initial.sourceHash]));
  useEffect(() => {
    const key = JSON.stringify([graph, sourceHash]);
    if (key === lastSaved.current) return;
    const t = setTimeout(async () => {
      lastSaved.current = key;
      const r = await fetch(`/api/graphs/${ctx.graphId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ graph: { ...graph, version: 1, id: ctx.graphId, profile: ctx.profile, sourceHash } }) });
      setSaved(r.ok ? `Đã lưu bố cục ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Lưu bố cục lỗi");
    }, 1500);
    return () => clearTimeout(t);
  }, [graph, ctx.graphId, ctx.profile, sourceHash]);

  const isValidConnection = useCallback((c: Connection | Edge) => {
    const s = nodes.find((n) => n.id === c.source), t = nodes.find((n) => n.id === c.target);
    return c.source !== c.target && canConnect(s?.type as NodeKind, c.sourceHandle, t?.type as NodeKind, c.targetHandle);
  }, [nodes]);
  const onConnect = useCallback((c: Connection) => setEdges((es) => connectEdges(es as unknown as GEdge[], c).map((e) => ({ ...e, type: "smoothstep", animated: e.targetHandle === "prev" || e.targetHandle === "in" })) as Edge[]), [setEdges]);

  const addNode = (kind: NodeKind, data: Record<string, any>) => {
    const r = wrap.current?.getBoundingClientRect();
    const p = screenToFlowPosition({ x: (r?.left || 0) + (r?.width || 800) / 2 - 110, y: (r?.top || 0) + (r?.height || 600) / 2 - 60 });
    const id = `n-${kind}-${Date.now().toString(36)}`;
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: kind, position: { x: p.x + Math.random() * 40, y: p.y + Math.random() * 40 }, data, selected: true }]);
    setSel(id);
  };
  const updateNode = useCallback((id: string, patch: Record<string, any> | null, newType?: NodeKind) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...(newType ? { type: newType } : {}), data: patch ? { ...n.data, ...patch } : n.data } : n)));
  }, [setNodes]);
  const removeNode = (id: string) => { setNodes((ns) => ns.filter((n) => n.id !== id)); setEdges((es) => es.filter((e) => e.source !== id && e.target !== id)); setSel(null); };

  const relayout = () => { setNodes((ns) => { const pos = new Map(autoLayout(fromRF(ns, edges)).map((n) => [n.id, n.position])); return ns.map((n) => ({ ...n, position: pos.get(n.id) || n.position })); }); setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50); };

  const apply = async (confirmQueued = false) => {
    setBusy("apply");
    try {
      const r = await fetch(`/api/graphs/${ctx.graphId}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ graph: { ...graph, version: 1, id: ctx.graphId, profile: ctx.profile }, confirmQueued }) });
      const j = await r.json();
      if (r.status === 409 && j.needConfirm) { setBusy(""); if (confirm(j.error)) return apply(true); return; }
      if (!r.ok) { setMsg({ text: j.error || "Lỗi", tone: "err" }); return; }
      setSourceHash(j.sourceHash);
      if (j.target === "video") {
        setVideo((v) => (v ? { ...v, status: j.status } : v));
        setMsg({ text: j.changed ? `Đã ghi ${j.scenes} cảnh vào ${ctx.videoId}.json (≈${Math.round(j.totalSec)}s). Bấm Render để dựng lại video.${j.addedSources ? ` Thêm ${j.addedSources} nguồn.` : ""}` : `Kịch bản không đổi so với ${ctx.videoId}.json${j.addedSources ? `; thêm ${j.addedSources} nguồn` : ""}.`, tone: "ok" });
      } else setMsg({ text: j.changed ? `Đã ghi ${j.scenes} cảnh vào kịch bản của ý tưởng (${ctx.ideaId}). Video sẽ được tạo khi ý tưởng qua MOW + Legal.` : "Kịch bản ý tưởng không đổi.", tone: "ok" });
    } finally { setBusy(""); }
  };
  const render = async () => {
    if (!ctx.videoId) return;
    if (!confirm(`Render lại ${ctx.videoId}? (dùng kịch bản đã ghi trong JSON; bấm "Tạo kịch bản" trước nếu vừa sửa)`)) return;
    setBusy("render");
    const r = await fetch(`/api/videos/${ctx.videoId}/render`, { method: "POST" }); const j = await r.json(); setBusy("");
    if (r.ok) { setVideo((v) => (v ? { ...v, renderState: "queued", status: "doing" } : v)); setMsg({ text: "Đã đưa vào hàng đợi render. Theo dõi tiến độ ở trang Sản xuất.", tone: "ok" }); } else setMsg({ text: j.error || "Lỗi render", tone: "err" });
  };
  const review = async () => {
    if (!ctx.videoId) return;
    if (!confirm("Đánh dấu review: video vào hàng đợi đăng tự động theo thứ tự kế hoạch. Tiếp tục?")) return;
    const r = await fetch(`/api/videos/${ctx.videoId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "review" }) }); const j = await r.json();
    if (r.ok) { setVideo((v) => (v ? { ...v, status: "review" } : v)); setMsg({ text: "Đã đánh dấu review.", tone: "ok" }); } else setMsg({ text: j.error || "Lỗi", tone: "err" });
  };
  const suggest = async () => {
    if (analysis.words > 0 && !confirm("Gợi ý sẽ thay toàn bộ đồ thị hiện tại bằng bản nháp mới (chưa ghi vào JSON cho tới khi bấm Tạo kịch bản). Tiếp tục?")) return;
    setBusy("suggest");
    try {
      const r = await fetch(`/api/graphs/${ctx.graphId}/suggest`, { method: "POST" }); const j = await r.json();
      if (!r.ok) { setMsg({ text: j.error || "Lỗi", tone: "err" }); return; }
      const g = toRF(j.graph); setNodes(g.nodes); setEdges(g.edges); setSourceHash(undefined);
      setMsg({ text: j.message, tone: j.source === "draft" ? "info" : "ok" });
      setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
    } finally { setBusy(""); }
  };

  const order = useMemo(() => sceneOrder(graph).order, [graph]);
  const selNode = nodes.find((n) => n.id === sel);
  const allWarn = Object.entries(analysis.byNode).flatMap(([id, ws]) => ws.filter((w) => w.level !== "info").map((w) => ({ id, ...w })));
  const pct = Math.min(100, (analysis.totalSec / ctx.maxSec) * 100);

  return (
    <CanvasCtx.Provider value={shared}>
      <div className="fixed inset-y-0 left-[200px] right-0 z-10 flex flex-col bg-slate-50">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <Link href="/y-tuong/bang" className="text-xs text-slate-500">‹ Bảng</Link>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{ctx.title}</div>
            <div className="text-[10px] text-slate-500">{[ctx.videoId || ctx.ideaId, ctx.series, ctx.era, video ? `video: ${video.status} · render ${video.renderState}${video.inQueue ? " · trong hàng đợi đăng" : ""}` : "chưa có video"].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="ml-2 w-44">
            <div className="flex justify-between text-[10px] text-slate-500"><span>≈{analysis.totalSec.toFixed(0)}s · {analysis.words} từ</span><span>tối đa {ctx.maxSec}s</span></div>
            <div className="h-1.5 overflow-hidden rounded bg-slate-100"><div className={`h-full ${analysis.totalSec > ctx.maxSec ? "bg-rose-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-400">{saved}</span>
            <button className="btn" disabled={!!busy} onClick={suggest} title="Nháp hook/fact/cảnh từ ý tưởng (LLM nếu có)">{busy === "suggest" ? "Đang gợi ý…" : "✨ Gợi ý"}</button>
            <button className="btn" onClick={relayout}>⇄ Sắp xếp</button>
            <button className="btn-primary" disabled={!!busy} onClick={() => apply()} title="Ghi đồ thị thành scenes trong JSON (video hoặc kịch bản ý tưởng)">{busy === "apply" ? "Đang ghi…" : "📝 Tạo kịch bản"}</button>
            {ctx.videoId && <button className="btn" disabled={!!busy || video?.renderState === "running" || video?.renderState === "queued"} onClick={render}>{busy === "render" ? "…" : "▶ Render"}</button>}
            {ctx.videoId && <button className="btn" disabled={video?.renderState !== "done" || video?.status === "review" || video?.status === "published"} onClick={review} title="Cần đã render">✓ Review</button>}
            {ctx.videoId && <Link className="btn" href={`/san-xuat/${ctx.videoId}`}>Trình sửa</Link>}
          </div>
        </div>
        {msg && <div className={`flex items-start gap-2 px-3 py-1.5 text-xs ${msg.tone === "err" ? "bg-rose-50 text-rose-700" : msg.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}><span className="flex-1">{msg.text}</span><button onClick={() => setMsg(null)}>×</button></div>}
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[118px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-slate-200 bg-white p-2">
            <div className="text-[10px] font-semibold uppercase text-slate-400">Thêm nút</div>
            {ADD.map((a) => <button key={a.kind} className="rounded border border-slate-200 px-2 py-1 text-left text-[11px] hover:border-blue-300 hover:bg-blue-50" onClick={() => addNode(a.kind, a.data())}>+ {NODE_LABEL[a.kind]}</button>)}
            <div className="mt-2 text-[9.5px] leading-snug text-slate-400">Kéo dây từ chấm tròn: cảnh → cảnh → Video; Nhân vật/Ảnh/Biểu đồ → đỉnh cảnh; Fact → đáy cảnh. Chọn dây/nút + Delete để xoá.</div>
          </div>
          <div ref={wrap} className="min-w-0 flex-1">
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
              isValidConnection={isValidConnection} onNodeClick={(_, n) => setSel(n.id)} onPaneClick={() => setSel(null)}
              onNodesDelete={(ds) => ds.some((d) => d.id === sel) && setSel(null)} fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.15} maxZoom={1.8}
              onlyRenderVisibleElements proOptions={{ hideAttribution: true }} deleteKeyCode={["Delete", "Backspace"]}>
              <Background gap={24} size={1} />
              <MiniMap pannable zoomable nodeStrokeWidth={2} className="!h-24 !w-36" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <div className="w-[330px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white">
            {selNode ? (
              <NodePanel node={selNode as unknown as GNode} ctx={ctx} warns={analysis.byNode[selNode.id] || []} onChange={updateNode} onDelete={removeNode}
                onArchiveAdded={(a) => setExtraArchive((m) => ({ ...m, [a.id]: a }))} archive={shared.archive} />
            ) : (
              <div className="space-y-3 p-3 text-xs">
                <div>
                  <div className="text-[10px] font-semibold uppercase text-slate-400">Cảnh báo</div>
                  {!analysis.global.length && !allWarn.length && <div className="text-emerald-700">✓ Không có cảnh báo</div>}
                  {analysis.global.map((w, k) => <div key={k} className={w.level === "error" ? "text-rose-600" : w.level === "warn" ? "text-amber-700" : "text-slate-500"}>{w.level === "error" ? "⛔" : w.level === "warn" ? "⚠" : "ℹ"} {w.text}</div>)}
                  {allWarn.map((w, k) => <button key={k} onClick={() => setSel(w.id)} className={`block text-left ${w.level === "error" ? "text-rose-600" : "text-amber-700"}`}>{w.level === "error" ? "⛔" : "⚠"} <b>{(nodes.find((n) => n.id === w.id)?.data as any)?.title || NODE_LABEL[nodes.find((n) => n.id === w.id)?.type as NodeKind] || w.id}</b>: {w.text}</button>)}
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase text-slate-400">Lời đọc theo thứ tự ({order.length} cảnh, ≈{analysis.totalSec.toFixed(0)}s)</div>
                  <ol className="mt-1 space-y-1.5">
                    {order.map((n, k) => (
                      <li key={n.id}><button className="w-full text-left" onClick={() => setSel(n.id)}>
                        <span className="font-mono text-[10px] text-slate-400">{k + 1}. {NODE_LABEL[n.type]} · ≈{sceneSec(n.data.narration).toFixed(1)}s</span>
                        <span className="block font-semibold text-slate-700">{n.data.title}</span>
                        <span className="block text-slate-600">{n.data.narration}</span>
                      </button></li>
                    ))}
                  </ol>
                </div>
                <details><summary className="cursor-pointer text-[10px] font-semibold uppercase text-slate-400">Xem JSON scenes sẽ ghi</summary><pre className="mt-1 max-h-80 overflow-auto rounded bg-slate-50 p-2 text-[9.5px]">{JSON.stringify(graphToScenes(graph), null, 1)}</pre></details>
              </div>
            )}
          </div>
        </div>
      </div>
    </CanvasCtx.Provider>
  );
}

export default function ScriptCanvas(props: { initial: ScriptGraph; ctx: Ctx }) {
  return <ReactFlowProvider><Inner {...props} /></ReactFlowProvider>;
}
