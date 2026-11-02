import fs from "node:fs";
import path from "node:path";
import { loadAutoConfig } from "./autopublish";
import { castOf } from "./cast";
import { DATA_DIR, getIdea, getProfile, getSchedule, getVideo, listIdeas, listVideos, safeSlug, writeJson } from "./data";
import { type AnMaterial, type BuildCtx, ideaStarterGraph, maxSecFor, parseFactCheck, scenesHash, scenesToGraph, type ScriptGraph } from "./graph";
import { archiveItems, type ArchiveView, creditLine, ideaThumb, videoThumb, type Visual } from "./thumbs";
import type { Idea, Profile, Video } from "./types";

const gfile = (id: string) => path.join(DATA_DIR, "graphs", `${safeSlug(id)}.json`);

export function readGraph(id: string): ScriptGraph | null {
  try { return JSON.parse(fs.readFileSync(gfile(id), "utf8")) as ScriptGraph; } catch { return null; }
}
export function writeGraph(g: ScriptGraph) {
  fs.mkdirSync(path.join(DATA_DIR, "graphs"), { recursive: true });
  writeJson(gfile(g.id), { ...g, updatedAt: new Date().toISOString() });
}

/** File fact-check (07-fact-check.md): FACT_CHECK_FILE, hoặc cạnh file kế hoạch nội dung của autopublish. */
export function factCheckFile(profile?: string): string | null {
  if (process.env.FACT_CHECK_FILE) return process.env.FACT_CHECK_FILE;
  const cfg = loadAutoConfig().find((c) => !profile || c.profile === profile) || loadAutoConfig()[0];
  const plan = cfg?.planFile || process.env.CONTENT_PLAN_FILE;
  if (!plan) return null;
  const f = path.join(path.dirname(plan), "07-fact-check.md");
  return fs.existsSync(f) ? f : null;
}

/** Ảnh/clip An có sẵn: ảnh ref nhân vật + mọi ảnh/clip hook, cta trong data/assets/<profile>/. */
export function anMaterials(p: Profile | null | undefined, characterId?: string): AnMaterial[] {
  const ch = castOf(p).characters.find((c) => c.id === characterId) || castOf(p).characters[0];
  const out: AnMaterial[] = (ch?.refs || []).map((r) => ({ ref: r, kind: "image" as const, label: path.basename(r) }));
  if (!p) return out;
  const root = path.join(DATA_DIR, "assets", p.slug);
  const walk = (d: string, depth: number) => {
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      const f = path.join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(f, depth + 1);
      else if (/(^|[-_])(hook|cta)([-_][^/]*)?\.(png|jpe?g|mp4)$/i.test(e.name)) {
        const ref = `assets/${path.relative(path.join(DATA_DIR, "assets"), f).split(path.sep).join("/")}`;
        if (!out.some((x) => x.ref === ref)) out.push({ ref, kind: /\.mp4$/i.test(e.name) ? "clip" : "image", label: path.relative(root, f) });
      }
    }
  };
  walk(root, 0);
  return out;
}

/** Toàn bộ thư viện ảnh tư liệu (mọi topic) cho bộ chọn ảnh. */
export function archiveLibrary(): ArchiveView[] {
  const root = path.join(DATA_DIR, "archive");
  let topics: string[] = [];
  try { topics = fs.readdirSync(root).filter((t) => fs.existsSync(path.join(root, t, "index.json"))); } catch { return []; }
  const out: ArchiveView[] = [];
  for (const t of topics) {
    try {
      const items = JSON.parse(fs.readFileSync(path.join(root, t, "index.json"), "utf8")).items || [];
      out.push(...archiveItems({ archive: { items: items.map((x: { id: string }) => ({ id: x.id })) } }));
    } catch { /* bỏ qua index hỏng */ }
  }
  return out;
}
export { creditLine };

export interface CanvasCtx {
  graphId: string; profile: string; ideaId?: string; videoId?: string; title: string;
  series?: string; era?: string; maxSec: number;
  video?: { status: string; renderState: string; output?: string; finishedAt?: string; inQueue: boolean };
  characterId?: string; characterName?: string; characterRefs: string[];
  an: AnMaterial[]; archive: ArchiveView[]; charts: unknown[];
  notice?: string; hasFactCheck: boolean;
}

function buildCtx(p: Profile | null, i: Idea | null, v: Video | null): BuildCtx & { ch?: { id: string; name: string; refs: string[] } } {
  const ch = castOf(p).characters.find((c) => c.id === (v?.characterId || i?.characterId)) || castOf(p).characters[0];
  return {
    profile: v?.profile || i?.profile || p?.slug || "", ideaId: i?.id || v?.ideaId, videoId: v?.id, title: v?.title || i?.title || "",
    idea: i ? { title: i.title, hook: i.hook, angle: i.angle, series: i.plan?.series || i.pillar, era: i.plan?.era, eraName: i.plan?.eraName, sources: i.plan?.sources } : undefined,
    characterId: ch?.id, characterName: ch?.name?.split("(")[0].trim() || "An", characterRefs: ch?.refs || [],
    defaultAnImage: ch?.refs?.find((r) => /study|oil/i.test(r)) || ch?.refs?.[0], ch,
  };
}

/** Đồ thị cho video hoặc ý tưởng (id = vid-… hoặc idea-…). Video có đồ thị đã lưu nhưng JSON đổi -> dựng lại, giữ vị trí nút. */
export function loadCanvas(id: string): { graph: ScriptGraph; ctx: CanvasCtx } | null {
  let v = id.startsWith("vid-") ? getVideo(id) : null;
  let i = v ? getIdea(v.ideaId) : getIdea(id);
  if (!v && i?.videoId) v = getVideo(i.videoId);
  if (!v && !i) return null;
  const graphId = v?.id || i!.id;
  const p = getProfile(v?.profile || i!.profile);
  const b = buildCtx(p, i, v);
  const scenes = v?.scenes || i?.script?.scenes;
  let notice: string | undefined;
  const fcf = factCheckFile(b.profile);
  const facts = v && fcf ? parseFactCheck(fs.readFileSync(fcf, "utf8"), v.id, (v as Video & { sources?: string[] }).sources || []) : [];
  const saved = readGraph(graphId);
  let graph: ScriptGraph;
  if (scenes?.length) {
    const h = scenesHash(scenes);
    if (saved && saved.sourceHash === h) graph = saved;
    else {
      graph = scenesToGraph(scenes, { ...b, facts });
      graph.sourceHash = h;
      if (saved) {
        const pos = new Map(saved.nodes.map((n) => [n.id, n.position]));
        graph.nodes = graph.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n));
        // giữ fact người dùng thêm trên canvas
        const keep = saved.nodes.filter((n) => n.type === "fact" && n.id.startsWith("n-"));
        graph.nodes.push(...keep);
        graph.edges.push(...saved.edges.filter((e) => keep.some((k) => k.id === e.source) && graph.nodes.some((n) => n.id === e.target)));
        notice = "Kịch bản JSON đã thay đổi ngoài canvas: đồ thị được dựng lại từ JSON (giữ vị trí nút và fact đã thêm).";
      }
    }
  } else {
    const rev = [...anMaterials(p, b.characterId)].reverse();
    const clip = (k: string) => rev.find((m) => m.kind === "clip" && new RegExp(k, "i").test(m.ref))?.ref;
    graph = saved || ideaStarterGraph({ ...b, anClips: { hook: clip("hook"), cta: clip("cta") } });
  }
  graph.id = graphId; graph.profile = b.profile;
  const now = new Date().toISOString().slice(0, 10);
  const inQueue = !!v && ["review", "done"].includes(v.status) && v.render.state === "done" && !getSchedule().some((e) => e.videoId === v!.id && e.status === "published" && e.date < now);
  const charts = (scenes || []).map((s) => s.chart).filter(Boolean);
  return {
    graph,
    ctx: {
      graphId, profile: b.profile, ideaId: b.ideaId, videoId: v?.id, title: b.title || "", series: b.idea?.series, era: b.idea?.eraName,
      maxSec: maxSecFor(b.idea?.series), characterId: b.characterId, characterName: b.characterName, characterRefs: b.characterRefs || [],
      video: v ? { status: v.status, renderState: v.render.state, output: v.render.output, finishedAt: v.render.finishedAt, inQueue } : undefined,
      an: anMaterials(p, b.characterId), archive: archiveLibrary(), charts, notice, hasFactCheck: facts.length > 0,
    },
  };
}

// ------------------------------------------------------------------ bảng tổng quan
export type BoardStatus = "idea" | "scripted" | "rendered" | "scheduled" | "published";
export interface BoardCard { id: string; title: string; era: string; eraName: string; series: string; status: BoardStatus; thumb: Visual; href: string; stt?: number; videoId?: string; hook?: string }

export function boardCards(profile: string): BoardCard[] {
  const vids = listVideos(profile); const vmap = new Map(vids.map((v) => [v.id, v]));
  const p = getProfile(profile);
  const sched = getSchedule().filter((e) => e.profile === profile);
  return listIdeas(profile).filter((i) => !i.sample).map((i) => {
    const v = i.videoId ? vmap.get(i.videoId) : undefined;
    let status: BoardStatus = "idea";
    if (i.script || v) status = "scripted";
    if (v?.render.state === "done") status = "rendered";
    if (v && v.render.state === "done" && (["review", "done"].includes(v.status) || sched.some((e) => e.videoId === v.id && e.status !== "published"))) status = "scheduled";
    if (i.status === "published" || v?.status === "published") status = "published";
    return {
      id: i.id, title: i.title, era: i.plan?.era || "?", eraName: i.plan?.eraName || "Khác", series: i.plan?.series || i.pillar || "Khác", status,
      thumb: ideaThumb(i, vmap, p), href: `/y-tuong/canvas/${v?.id || i.id}`, stt: i.plan?.stt, videoId: v?.id, hook: i.hook,
    };
  }).sort((a, b) => (a.stt ?? 1e6) - (b.stt ?? 1e6) || a.id.localeCompare(b.id));
}
export { videoThumb };
