/**
 * Đồ thị kịch bản ("nối dây") <-> kịch bản JSON (scenes của video / idea.script).
 * Thuần (không fs) để dùng được ở client (canvas) lẫn server (API, test).
 *
 * Nút: idea, hook/scene/cta (cảnh), fact, character (An: ảnh/clip có sẵn), media (ảnh/clip có sẵn khác),
 *      archive (ảnh tư liệu data/archive hoặc truy vấn tự tìm), chart (thẻ số liệu), video (đầu ra).
 * Dây: cảnh.next -> cảnh.prev (thứ tự), cảnh cuối -> video.in; character/media/archive/chart.out -> cảnh.visual; fact.out -> cảnh.fact.
 */
import type { Scene } from "./types";

export type NodeKind = "idea" | "hook" | "scene" | "cta" | "fact" | "character" | "media" | "archive" | "chart" | "video";
export const SCENE_KINDS: NodeKind[] = ["hook", "scene", "cta"];
export const VISUAL_KINDS: NodeKind[] = ["character", "media", "archive", "chart"];
export const isSceneKind = (k?: string) => SCENE_KINDS.includes(k as NodeKind);

export interface GNode { id: string; type: NodeKind; position: { x: number; y: number }; data: Record<string, any> }
export interface GEdge { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
export interface ScriptGraph {
  version: 1; id: string; profile: string; ideaId?: string; videoId?: string;
  nodes: GNode[]; edges: GEdge[];
  /** băm scenes JSON lúc dựng/ghi gần nhất: khác => JSON đã đổi ngoài canvas, dựng lại đồ thị */
  sourceHash?: string; updatedAt?: string;
}
export interface Warn { level: "error" | "warn" | "info"; text: string }

export const NODE_LABEL: Record<NodeKind, string> = {
  idea: "Ý tưởng", hook: "Hook", scene: "Cảnh", cta: "CTA", fact: "Fact", character: "Nhân vật",
  media: "Ảnh/clip có sẵn", archive: "Ảnh tư liệu", chart: "Biểu đồ/KPI", video: "Video",
};

/** Tốc độ đọc VieNeu Thiện Minh đo trên su-11..20 (~4,4 từ/giây) + nghỉ giữa cảnh. */
export const WORDS_PER_SEC = 4.4;
export const SCENE_PAD = 0.35;
export const END_PAD = 0.9;
export const words = (s?: string) => (s || "").trim().split(/\s+/).filter(Boolean).length;
export const sceneSec = (narration?: string) => words(narration) / WORDS_PER_SEC + SCENE_PAD;

/** Độ dài tối đa theo series (06-content-plan.md §2). */
export const SERIES_MAX: Record<string, number> = {
  "Bạn có biết?": 45, "Sự thật ít ai biết": 60, "Nhân vật": 60, "Trận đánh 60 giây": 60, "Ngày này năm xưa": 45,
  "Truyền thuyết hay chính sử?": 60, "Nguồn gốc tên gọi": 45, "Nếu bạn sống ở thời…": 60, "Xưa và nay bằng số liệu": 45,
};
export const maxSecFor = (series?: string) => (series && SERIES_MAX[series]) || 45;

const isVideoRef = (p?: string) => !!p && /\.(mp4|mov|webm)$/i.test(p);
const CTA_RE = /bình luận|theo dõi|hẹn bạn|follow|đăng ký|chia sẻ|lưu lại/i;

// ------------------------------------------------------------------ băm ổn định
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  if (x && typeof x === "object") return `{${Object.keys(x as object).filter((k) => (x as any)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((x as any)[k])}`).join(",")}}`;
  return JSON.stringify(x);
}
export function scenesHash(scenes: Scene[]): string {
  const s = stable(scenes.map(({ title, narration, visual, image, motion, clip, clipStart, archive, chart, ...rest }) => ({ title, narration, visual, image, motion, clip, clipStart, archive, chart, ...rest })));
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0") + s.length.toString(16);
}

// ------------------------------------------------------------------ JSON -> đồ thị
export interface AnMaterial { ref: string; kind: "image" | "clip"; label?: string }
export interface FactRow { claim: string; source: string; verdict: string; url?: string }
export interface BuildCtx {
  profile: string; ideaId?: string; videoId?: string;
  idea?: { title?: string; hook?: string; angle?: string; series?: string; era?: string; eraName?: string; sources?: string };
  title?: string;
  characterId?: string; characterName?: string;
  /** ảnh tham chiếu nhân vật trong profile (để nhận diện cảnh An) */
  characterRefs?: string[];
  facts?: FactRow[];
  /** ảnh An mặc định cho nút Nhân vật mới */
  defaultAnImage?: string;
  /** clip An có sẵn cho Hook / CTA */
  anClips?: { hook?: string; cta?: string };
}

/** Ảnh/clip này là tư liệu An có sẵn? (ảnh ref nhân vật, clip hook/cta, ảnh 01-hook/05-cta) */
export function isAnRef(ref: string | undefined, refs: string[] = []): boolean {
  if (!ref) return false;
  if (refs.includes(ref)) return true;
  const b = ref.split("/").pop() || "";
  return /(^|[-_])(hook|cta)([-_.]|$)|char-an/i.test(b);
}

const SCENE_STD = ["title", "narration", "visual", "motion", "clipStart", "image", "clip", "archive", "chart"];

export function scenesToGraph(scenes: Scene[], ctx: BuildCtx): ScriptGraph {
  const nodes: GNode[] = [], edges: GEdge[] = [];
  const X0 = 300, DX = 320, Y = 320;
  const edge = (source: string, target: string, sourceHandle: string, targetHandle: string) =>
    edges.push({ id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle });
  if (ctx.idea || ctx.ideaId) nodes.push({ id: "idea", type: "idea", position: { x: X0 - 340, y: Y }, data: { ideaId: ctx.ideaId, title: ctx.idea?.title || ctx.title || "", angle: ctx.idea?.angle || "", series: ctx.idea?.series || "", era: ctx.idea?.eraName || ctx.idea?.era || "" } });
  const n = scenes.length;
  scenes.forEach((sc, i) => {
    const kind: NodeKind = i === 0 ? "hook" : i === n - 1 && n > 1 ? "cta" : "scene";
    const extra: Record<string, unknown> = {};
    for (const k of Object.keys(sc)) if (!SCENE_STD.includes(k)) extra[k] = (sc as any)[k];
    const id = `s${i}`;
    nodes.push({ id, type: kind, position: { x: X0 + i * DX, y: Y }, data: {
      title: sc.title || "", narration: sc.narration || "", ...(sc.visual !== undefined ? { visual: sc.visual } : {}),
      ...(sc.motion ? { motion: sc.motion } : {}), ...(sc.clipStart !== undefined ? { clipStart: sc.clipStart } : {}),
      ...(Object.keys(extra).length ? { extra } : {}),
    } });
    if (i === 0 && nodes[0]?.id === "idea") edge("idea", id, "out", "prev");
    if (i > 0) edge(`s${i - 1}`, id, "next", "prev");
    // nguồn hình, xếp chồng phía trên cảnh
    const vis: { type: NodeKind; data: Record<string, any> }[] = [];
    const an = isAnRef(sc.clip, ctx.characterRefs) || (!sc.clip && isAnRef(sc.image, ctx.characterRefs));
    if (an) vis.push({ type: "character", data: { characterId: ctx.characterId || "", name: ctx.characterName || "An", ...(sc.clip ? { clip: sc.clip } : {}), ...(sc.image ? { image: sc.image } : {}) } });
    else {
      if (sc.clip) vis.push({ type: "media", data: { ref: sc.clip } });
      if (sc.image) vis.push({ type: "media", data: { ref: sc.image } });
    }
    const a = sc.archive;
    if (a?.items?.length) for (const it of a.items) vis.push({ type: "archive", data: { ...it } });
    else if (a?.query) vis.push({ type: "archive", data: { query: a.query, topic: a.topic, mode: a.mode, n: a.n } });
    if (sc.chart) vis.push({ type: "chart", data: { chart: sc.chart } });
    vis.forEach((vv, j) => {
      const vid = `${id}-v${j}`;
      nodes.push({ id: vid, type: vv.type, position: { x: X0 + i * DX + (j % 2) * 26, y: Y - 230 - j * 190 }, data: vv.data });
      edge(vid, id, "out", "visual");
    });
  });
  nodes.push({ id: "video", type: "video", position: { x: X0 + n * DX, y: Y }, data: { videoId: ctx.videoId, title: ctx.title || ctx.idea?.title || "" } });
  if (n) edge(`s${n - 1}`, "video", "next", "in");
  // fact: tự nối vào cảnh có lời đọc trùng nhiều từ nhất
  const facts = ctx.facts || [];
  const toks = (s: string) => new Set(s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1));
  const sceneToks = scenes.map((s) => toks(`${s.title} ${s.narration}`));
  facts.forEach((f, k) => {
    const id = `f${k}`;
    const ft = toks(f.claim);
    let best = -1, score = 0;
    sceneToks.forEach((st, i) => { let c = 0; ft.forEach((w) => st.has(w) && c++); const r = ft.size ? c / ft.size : 0; if (r > score) { score = r; best = i; } });
    const col = best >= 0 && score >= 0.3 ? best : k;
    nodes.push({ id, type: "fact", position: { x: X0 + Math.min(col, Math.max(n - 1, 0)) * DX + (k % 2) * 30, y: Y + 300 + Math.floor(k / Math.max(n, 1)) * 40 + (k % 3) * 150 }, data: { ...f } });
    if (best >= 0 && score >= 0.3) edge(id, `s${best}`, "out", "fact");
  });
  return { version: 1, id: ctx.videoId || ctx.ideaId || "graph", profile: ctx.profile, ...(ctx.ideaId ? { ideaId: ctx.ideaId } : {}), ...(ctx.videoId ? { videoId: ctx.videoId } : {}), nodes, edges, sourceHash: scenesHash(scenes) };
}

/** Ý tưởng chưa có kịch bản: khung Hook -> 2 cảnh -> CTA, An dùng ảnh có sẵn, fact từ nguồn trong kế hoạch. */
export function ideaStarterGraph(ctx: BuildCtx): ScriptGraph {
  const i = ctx.idea || {};
  const scenes: Scene[] = [
    { title: (i.title || "").split(":")[0].slice(0, 40), narration: i.hook || "", motion: "video" },
    { title: "", narration: "" },
    { title: "", narration: "" },
    { title: "Bạn nghĩ sao?", narration: "Bạn nghĩ sao? Bình luận nhé. Sử mình hay lắm. Mình là An, hẹn bạn ở trang sử tiếp theo.", motion: "video" },
  ];
  const facts: FactRow[] = (i.sources || "").split(/;\s*/).map((s) => s.trim()).filter(Boolean).map((s) => ({ claim: "", source: s, verdict: "chưa kiểm" }));
  const g = scenesToGraph(scenes, { ...ctx, facts });
  for (const k of ["s0", "s3"]) {
    if (!ctx.defaultAnImage && !ctx.anClips?.[k === "s0" ? "hook" : "cta"]) continue;
    const id = `${k}-an`, sc = g.nodes.find((x) => x.id === k)!;
    g.nodes.push({ id, type: "character", position: { x: sc.position.x, y: sc.position.y - 230 }, data: { characterId: ctx.characterId || "", name: ctx.characterName || "An", ...(ctx.anClips?.[k === "s0" ? "hook" : "cta"] ? { clip: ctx.anClips[k === "s0" ? "hook" : "cta"] } : {}), ...(ctx.defaultAnImage ? { image: ctx.defaultAnImage } : {}) } });
    g.edges.push({ id: `e-${id}-${k}`, source: id, target: k, sourceHandle: "out", targetHandle: "visual" });
  }
  g.sourceHash = undefined;
  return g;
}

// ------------------------------------------------------------------ đồ thị -> JSON
/** Thứ tự cảnh: đi ngược từ nút video theo dây prev. Trả cả các cảnh không nằm trong chuỗi. */
export function sceneOrder(g: Pick<ScriptGraph, "nodes" | "edges">): { order: GNode[]; orphans: GNode[]; loop: boolean } {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const video = g.nodes.find((n) => n.type === "video");
  const order: GNode[] = []; const seen = new Set<string>(); let loop = false;
  let cur = video ? g.edges.find((e) => e.target === video.id && isSceneKind(byId.get(e.source)?.type)) : undefined;
  let node = cur ? byId.get(cur.source) : undefined;
  while (node && isSceneKind(node.type)) {
    if (seen.has(node.id)) { loop = true; break; }
    seen.add(node.id); order.unshift(node);
    const prev = g.edges.find((e) => e.target === node!.id && (e.targetHandle === "prev" || !e.targetHandle) && isSceneKind(byId.get(e.source)?.type));
    node = prev ? byId.get(prev.source) : undefined;
  }
  const orphans = g.nodes.filter((n) => isSceneKind(n.type) && !seen.has(n.id));
  return { order, orphans, loop };
}

const inputs = (g: Pick<ScriptGraph, "nodes" | "edges">, id: string, handle: string) => {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  return g.edges.filter((e) => e.target === id && e.targetHandle === handle).map((e) => byId.get(e.source)).filter(Boolean)
    .sort((a, b) => a!.position.y - b!.position.y || a!.position.x - b!.position.x) as GNode[];
};
// nguồn hình phía trên cùng (y nhỏ nhất) ở xa cảnh nhất: đảo lại để ảnh gần cảnh là ảnh đầu tiên như lúc dựng
const visualInputs = (g: Pick<ScriptGraph, "nodes" | "edges">, id: string) => inputs(g, id, "visual").reverse();

export function nodeToScene(g: Pick<ScriptGraph, "nodes" | "edges">, n: GNode): Scene {
  const d = n.data || {};
  const sc: Scene = { ...(d.extra || {}), title: String(d.title || ""), narration: String(d.narration || "") } as Scene;
  if (d.visual !== undefined && d.visual !== "") sc.visual = String(d.visual);
  if (d.motion) sc.motion = d.motion;
  if (d.clipStart !== undefined && d.clipStart !== "" && d.clipStart !== null) sc.clipStart = Number(d.clipStart);
  const items: NonNullable<Scene["archive"]>["items"] = [];
  for (const v of visualInputs(g, n.id)) {
    const vd = v.data || {};
    if (v.type === "character") {
      if (vd.clip && !sc.clip) sc.clip = vd.clip;
      if (vd.image && !sc.image) sc.image = vd.image;
    } else if (v.type === "media" && vd.ref) {
      if (isVideoRef(vd.ref)) { if (!sc.clip) sc.clip = vd.ref; } else if (!sc.image) sc.image = vd.ref;
    } else if (v.type === "archive") {
      if (vd.id) items!.push({ id: vd.id, ...(vd.label ? { label: vd.label } : {}), ...(vd.mode ? { mode: vd.mode } : {}), ...(vd.focus ? { focus: vd.focus } : {}), ...(vd.credit ? { credit: vd.credit } : {}) });
      else if (vd.query && !sc.archive) sc.archive = { query: vd.query, ...(vd.topic ? { topic: vd.topic } : {}), ...(vd.mode ? { mode: vd.mode } : {}), ...(vd.n ? { n: vd.n } : {}) };
    } else if (v.type === "chart" && vd.chart) sc.chart = vd.chart;
  }
  if (items!.length) sc.archive = { items };
  return sc;
}

export function graphToScenes(g: Pick<ScriptGraph, "nodes" | "edges">): Scene[] {
  return sceneOrder(g).order.map((n) => nodeToScene(g, n));
}

// ------------------------------------------------------------------ cảnh báo
export interface Analysis { byNode: Record<string, Warn[]>; global: Warn[]; totalSec: number; maxSec: number; order: string[]; words: number }

export function analyze(g: Pick<ScriptGraph, "nodes" | "edges">, opts: { maxSec?: number; characterRefs?: string[]; hasCharacter?: boolean } = {}): Analysis {
  const byNode: Record<string, Warn[]> = {}; const global: Warn[] = [];
  const add = (id: string, w: Warn) => (byNode[id] ||= []).push(w);
  const maxSec = opts.maxSec || 45;
  const { order, orphans, loop } = sceneOrder(g);
  const outs = (id: string) => g.edges.filter((e) => e.source === id);
  let total = 0, nw = 0;
  for (const n of order) {
    const d = n.data || {}; const w = words(d.narration);
    nw += w; total += sceneSec(d.narration);
    if (!w) add(n.id, { level: "error", text: "Chưa có lời đọc" });
    else if (w > 45) add(n.id, { level: "warn", text: `Lời đọc dài (${w} từ ≈ ${(w / WORDS_PER_SEC).toFixed(0)}s): nên tách cảnh` });
    if (!String(d.title || "").trim()) add(n.id, { level: "warn", text: "Chưa có tiêu đề trên màn hình" });
    const vis = visualInputs(g, n.id);
    const sc = nodeToScene(g, n);
    if (!sc.clip && !sc.image && !sc.archive && !sc.chart) {
      add(n.id, opts.hasCharacter !== false
        ? { level: "warn", text: "Chưa có hình: khi render sẽ sinh ảnh AI mới (mặt An mới). Nối Nhân vật (ảnh/clip An có sẵn) hoặc Ảnh tư liệu" }
        : { level: "warn", text: "Chưa có hình: khi render sẽ sinh ảnh AI / nền màu" });
    } else if (sc.chart && !sc.clip && !sc.image && !sc.archive) add(n.id, { level: "info", text: "Chỉ có thẻ số liệu: nền sẽ là ảnh AI/nền màu; nên thêm ảnh tư liệu làm nền" });
    if (sc.clip && sc.archive) add(n.id, { level: "warn", text: "Có cả clip và ảnh tư liệu: renderer ưu tiên clip, ảnh tư liệu bị bỏ qua" });
    if (d.motion === "video" && !sc.clip && sc.image && vis.some((v) => v.type === "character")) add(n.id, { level: "warn", text: "Chuyển động image-to-video từ ảnh An: sẽ tạo clip mới (cần GenerateVideo), mặt có thể lệch" });
    if (inputs(g, n.id, "fact").some((f) => /sai/i.test(f.data?.verdict || ""))) add(n.id, { level: "error", text: "Nối với fact bị đánh giá SAI" });
  }
  for (const n of orphans) add(n.id, { level: "warn", text: "Cảnh chưa nối vào chuỗi dẫn tới Video: sẽ không có trong kịch bản" });
  if (loop) global.push({ level: "error", text: "Chuỗi cảnh bị vòng lặp" });
  if (!g.nodes.some((n) => n.type === "video")) global.push({ level: "error", text: "Thiếu nút Video (đầu ra)" });
  if (!order.length) global.push({ level: "error", text: "Chưa có cảnh nào nối tới Video" });
  if (order.length && order[0].type !== "hook") global.push({ level: "warn", text: "Thiếu Hook: cảnh đầu tiên nên là nút Hook" });
  if (order.length && order[order.length - 1].type !== "cta") global.push({ level: "warn", text: "Thiếu CTA: cảnh cuối nên là nút CTA" });
  const last = order[order.length - 1];
  if (last && last.type === "cta" && !CTA_RE.test(last.data?.narration || "")) add(last.id, { level: "info", text: "CTA chưa có lời kêu gọi (bình luận / theo dõi / hẹn bạn…)" });
  if (order.length) total += END_PAD;
  if (total > maxSec) global.push({ level: "warn", text: `Ước tính ${total.toFixed(0)}s, vượt ${maxSec}s của series: rút gọn lời đọc` });
  else if (order.length && total < 20) global.push({ level: "info", text: `Ước tính ${total.toFixed(0)}s: hơi ngắn` });
  for (const n of g.nodes) {
    const d = n.data || {};
    if (n.type === "fact") {
      if (!String(d.source || "").trim() && !String(d.url || "").trim()) add(n.id, { level: "error", text: "Fact chưa có nguồn" });
      if (!String(d.claim || "").trim()) add(n.id, { level: "warn", text: "Chưa ghi khẳng định cần kiểm" });
      if (/sai/i.test(d.verdict || "")) add(n.id, { level: "error", text: "Đánh giá: SAI, không dùng" });
      else if (!d.verdict || /chưa/i.test(d.verdict)) add(n.id, { level: "warn", text: "Chưa có kết luận kiểm chứng" });
      if (!outs(n.id).length) add(n.id, { level: "info", text: "Chưa nối vào cảnh nào" });
    }
    if (n.type === "character") {
      if (!d.image && !d.clip) add(n.id, { level: "error", text: "Chưa chọn ảnh/clip An có sẵn: mặt An sẽ bị sinh mới" });
      else if (!d.clip) add(n.id, { level: "info", text: "Ảnh tĩnh An (Ken Burns). Muốn An cử động: chọn clip có sẵn" });
      if (!outs(n.id).length) add(n.id, { level: "info", text: "Chưa nối vào cảnh nào" });
    }
    if (n.type === "archive") {
      if (!d.id && !d.query) add(n.id, { level: "error", text: "Chưa chọn ảnh tư liệu" });
      if (d.missing) add(n.id, { level: "error", text: `Không thấy ${d.id} trong data/archive` });
      if (!outs(n.id).length) add(n.id, { level: "info", text: "Chưa nối vào cảnh nào" });
    }
    if ((n.type === "media" || n.type === "chart") && !outs(n.id).length) add(n.id, { level: "info", text: "Chưa nối vào cảnh nào" });
    if (n.type === "media" && !d.ref) add(n.id, { level: "error", text: "Chưa chọn file" });
  }
  return { byNode, global, totalSec: total, maxSec, order: order.map((n) => n.id), words: nw };
}

/** Bảng fact-check (07-fact-check.md) của một video: "## vid-su-20 · …" + bảng | # | Khẳng định | Nguồn | Verdict |. */
export function parseFactCheck(md: string, videoId: string, sources: string[] = []): FactRow[] {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${videoId.replace(/[-]/g, "\\-")}\\b`).test(l));
  if (start < 0) return [];
  const out: FactRow[] = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    const m = lines[i].match(/^\|\s*(\d+)\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const cells = m[2].split("|").map((c) => c.trim());
    if (cells.length < 3) continue;
    const [claim, source, verdict] = [cells[0], cells[1], cells.slice(2).join(" | ")];
    const key = source.split(/[;:,(]/)[0].trim().toLowerCase().slice(0, 14);
    const hit = key.length > 3 ? sources.find((s) => s.toLowerCase().includes(key)) : undefined;
    const url = hit?.match(/https?:\/\/\S+/)?.[0];
    out.push({ claim, source, verdict, ...(url ? { url } : {}) });
  }
  return out;
}

/** Chuỗi URL dạng "…: https://…" từ fact mới (không trùng) để nối thêm vào sources của video. */
export function newSourceLines(g: Pick<ScriptGraph, "nodes">, existing: string[] = []): string[] {
  const have = existing.join("\n");
  return g.nodes.filter((n) => n.type === "fact" && n.data?.url && !have.includes(n.data.url))
    .map((n) => `${String(n.data.source || n.data.claim || "Nguồn").slice(0, 160)}: ${n.data.url}`);
}

/** Kiểm tra đồ thị gửi lên từ client trước khi lưu/ghi. */
export function validateGraph(g: ScriptGraph | undefined): string | null {
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) return "Đồ thị không hợp lệ";
  if (g.nodes.length > 500 || g.edges.length > 1500) return "Quá nhiều nút/dây";
  const kinds = new Set(["idea", "hook", "scene", "cta", "fact", "character", "media", "archive", "chart", "video"]);
  for (const n of g.nodes) {
    if (typeof n.id !== "string" || !kinds.has(n.type) || typeof n.position?.x !== "number" || typeof n.position?.y !== "number") return `Nút không hợp lệ: ${String(n?.id).slice(0, 40)}`;
    for (const k of ["ref", "image", "clip"]) {
      const r = n.data?.[k];
      if (r !== undefined && (typeof r !== "string" || r.includes("..") || r.startsWith("/"))) return `Đường dẫn không hợp lệ ở nút ${n.id}`;
    }
  }
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const e of g.edges) if (!ids.has(e.source) || !ids.has(e.target)) return "Dây nối tới nút không tồn tại";
  return null;
}

/** Sắp xếp lại: chuỗi cảnh nằm ngang, nguồn hình xếp chồng phía trên từng cảnh, fact phía dưới, nút lẻ ở hàng cuối. */
export function autoLayout(g: Pick<ScriptGraph, "nodes" | "edges">): GNode[] {
  const X0 = 300, DX = 320, Y = 320;
  const pos = new Map<string, { x: number; y: number }>();
  const { order, orphans } = sceneOrder(g);
  const chain = [...order, ...orphans];
  const idea = g.nodes.find((n) => n.type === "idea");
  if (idea) pos.set(idea.id, { x: X0 - 340, y: Y });
  const factCount = new Map<number, number>();
  chain.forEach((s, i) => {
    const x = X0 + i * DX;
    pos.set(s.id, { x, y: order.includes(s) ? Y : Y + 40 });
    g.edges.filter((e) => e.target === s.id && e.targetHandle === "visual").forEach((e, j) => { if (!pos.has(e.source)) pos.set(e.source, { x: x + (j % 2) * 26, y: Y - 230 - j * 190 }); });
    g.edges.filter((e) => e.target === s.id && e.targetHandle === "fact").forEach((e) => {
      if (pos.has(e.source)) return;
      const k = factCount.get(i) || 0; factCount.set(i, k + 1);
      pos.set(e.source, { x: x + (k % 2) * 30, y: Y + 300 + k * 160 });
    });
  });
  const video = g.nodes.find((n) => n.type === "video");
  if (video) pos.set(video.id, { x: X0 + order.length * DX, y: Y });
  const maxFacts = Math.max(0, ...factCount.values());
  let k = 0;
  for (const n of g.nodes) if (!pos.has(n.id)) { pos.set(n.id, { x: X0 + (k % Math.max(chain.length, 4)) * DX, y: Y + 320 + maxFacts * 160 + Math.floor(k / Math.max(chain.length, 4)) * 170 }); k++; }
  return g.nodes.map((n) => ({ ...n, position: pos.get(n.id)! }));
}

/** Dây hợp lệ? (nguồn kiểu/handle -> đích kiểu/handle) */
export function canConnect(src?: NodeKind, srcHandle?: string | null, dst?: NodeKind, dstHandle?: string | null): boolean {
  if (!src || !dst) return false;
  if (isSceneKind(src) && srcHandle === "next") return (isSceneKind(dst) && dstHandle === "prev") || (dst === "video" && dstHandle === "in");
  if (src === "idea") return isSceneKind(dst) && dstHandle === "prev";
  if (VISUAL_KINDS.includes(src)) return isSceneKind(dst) && dstHandle === "visual";
  if (src === "fact") return isSceneKind(dst) && dstHandle === "fact";
  return false;
}

/** Nối dây giữ chuỗi tuyến tính: mỗi cảnh chỉ 1 dây vào "prev", 1 dây ra "next"; video chỉ 1 dây vào. */
export function connectEdges(edges: GEdge[], c: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }): GEdge[] {
  const single = c.targetHandle === "prev" || c.targetHandle === "in";
  const kept = edges.filter((e) => !(single && e.target === c.target && e.targetHandle === c.targetHandle)
    && !(c.sourceHandle === "next" && e.source === c.source && e.sourceHandle === "next")
    && !(e.source === c.source && e.target === c.target && e.sourceHandle === c.sourceHandle && e.targetHandle === c.targetHandle));
  return [...kept, { id: `e-${c.source}-${c.sourceHandle}-${c.target}-${c.targetHandle}-${Date.now().toString(36)}`, source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? null, targetHandle: c.targetHandle ?? null }];
}
