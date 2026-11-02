/**
 * Canvas "nối dây": đồ thị <-> scenes (không mất dữ liệu), cảnh báo, nối dây, API lưu/ghi kịch bản.
 */
import "./channel-env";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { analyze, autoLayout, canConnect, connectEdges, graphToScenes, ideaStarterGraph, parseFactCheck, sceneOrder, scenesHash, scenesToGraph, validateGraph, type ScriptGraph } from "../lib/graph";
import { draftFromIdea } from "../lib/suggest";
import type { Idea, Scene } from "../lib/types";

const SCENES: Scene[] = [
  { title: "Bạn có biết?", narration: "Bạn có biết trận Bạch Đằng năm 938 dùng cọc gỗ?", clip: "assets/kenh-lich-su/hook-a.mp4", clipStart: 0.5, motion: "video" },
  { title: "938", narration: "Ngô Quyền cho đóng cọc nhọn bịt sắt dưới lòng sông Bạch Đằng.", archive: { items: [{ id: "bach-dang-coc", label: "Cọc Bạch Đằng", mode: "frame" }, { id: "bach-dang-map", mode: "detail" }] } },
  { title: "Số liệu", narration: "Hai con số.", image: "img/x.png", chart: { type: "kpi", values: [938, 1288], labels: ["Ngô Quyền", "Trần Hưng Đạo"], units: ["", ""] }, visual: "bản đồ" },
  { title: "Tìm ảnh", narration: "Tự tìm ảnh.", archive: { query: "Bạch Đằng", topic: "bach-dang", mode: "pan", n: 2 }, custom: { keep: 1 } } as Scene,
  { title: "Bạn nghĩ sao?", narration: "Bạn nghĩ sao? Bình luận nhé. Mình là An, hẹn bạn ở trang sử tiếp theo.", clip: "assets/kenh-lich-su/cta-a.mp4", image: "assets/kenh-lich-su/cta.png", motion: "video" },
];
const ctx = { profile: "p", videoId: "vid-t", ideaId: "idea-t", title: "Thử", characterId: "char-an", characterName: "An", characterRefs: ["assets/kenh-lich-su/an.png"],
  facts: [{ claim: "Ngô Quyền đóng cọc dưới lòng sông Bạch Đằng", source: "Toàn thư", verdict: "Đúng" }, { claim: "Không liên quan gì", source: "", verdict: "chưa kiểm" }] };

describe("đồ thị <-> scenes", () => {
  it("khứ hồi không mất trường (clip, archive items/query, chart, trường lạ)", () => {
    const g = scenesToGraph(SCENES, ctx);
    assert.deepEqual(graphToScenes(g), SCENES);
    assert.equal(g.sourceHash, scenesHash(SCENES));
    assert.deepEqual(g.nodes.filter((n) => ["hook", "scene", "cta"].includes(n.type)).map((n) => n.type), ["hook", "scene", "scene", "scene", "cta"]);
    assert.ok(g.nodes.some((n) => n.type === "character" && n.data.clip === SCENES[0].clip), "clip An -> nút Nhân vật");
    assert.equal(g.nodes.filter((n) => n.type === "archive").length, 3);
    const f0 = g.edges.find((e) => e.source === "f0"); assert.equal(f0?.target, "s1"); assert.equal(f0?.targetHandle, "fact");
    assert.ok(!g.edges.some((e) => e.source === "f1"), "fact không khớp không tự nối");
  });
  it("thứ tự theo dây prev, đổi dây là đổi thứ tự", () => {
    const g = scenesToGraph(SCENES.slice(0, 3), ctx);
    assert.deepEqual(sceneOrder(g).order.map((n) => n.id), ["s0", "s1", "s2"]);
    // s0 -> s2 -> s1 -> video
    let e = g.edges.filter((x) => !(x.targetHandle === "prev" || x.targetHandle === "in"));
    for (const c of [["s0", "s2"], ["s2", "s1"]]) e = connectEdges(e, { source: c[0], target: c[1], sourceHandle: "next", targetHandle: "prev" });
    e = connectEdges(e, { source: "s1", target: "video", sourceHandle: "next", targetHandle: "in" });
    assert.deepEqual(graphToScenes({ nodes: g.nodes, edges: e }).map((s) => s.title), ["Bạn có biết?", "Số liệu", "938"]);
  });
  it("connectEdges giữ chuỗi tuyến tính", () => {
    let e = connectEdges([], { source: "a", target: "b", sourceHandle: "next", targetHandle: "prev" });
    e = connectEdges(e, { source: "a", target: "c", sourceHandle: "next", targetHandle: "prev" });
    assert.deepEqual(e.map((x) => x.target), ["c"]);
    e = connectEdges(e, { source: "img", target: "c", sourceHandle: "out", targetHandle: "visual" });
    e = connectEdges(e, { source: "img2", target: "c", sourceHandle: "out", targetHandle: "visual" });
    assert.equal(e.filter((x) => x.targetHandle === "visual").length, 2);
  });
  it("canConnect", () => {
    assert.ok(canConnect("scene", "next", "cta", "prev"));
    assert.ok(canConnect("cta", "next", "video", "in"));
    assert.ok(canConnect("archive", "out", "scene", "visual"));
    assert.ok(canConnect("fact", "out", "hook", "fact"));
    assert.ok(!canConnect("fact", "out", "scene", "visual"));
    assert.ok(!canConnect("archive", "out", "video", "in"));
    assert.ok(!canConnect("scene", "next", "scene", "visual"));
  });
});

describe("cảnh báo", () => {
  it("bắt lỗi thiếu nguồn, thiếu hình, quá dài, thiếu hook/CTA", () => {
    const long = Array.from({ length: 60 }, () => "chữ").join(" ");
    const g = scenesToGraph([{ title: "", narration: long }, { title: "x", narration: "ngắn" }], { profile: "p", facts: [] });
    g.nodes.push({ id: "n-f", type: "fact", position: { x: 0, y: 0 }, data: { claim: "abc", source: "", verdict: "chưa kiểm" } });
    g.nodes.forEach((n) => { if (n.type === "hook" || n.type === "cta") n.type = "scene"; });
    const a = analyze(g, { maxSec: 10 });
    const all = JSON.stringify(a);
    assert.match(all, /nguồn/i);
    assert.match(all, /mặt An mới/);
    assert.match(a.byNode.s0.map((w) => w.text).join(), /Lời đọc dài/);
    assert.match(a.global.map((w) => w.text).join(), /Hook/);
    assert.match(a.global.map((w) => w.text).join(), /CTA/);
    assert.ok(a.totalSec > 10 && a.global.some((w) => /dài|vượt/i.test(w.text)));
  });
  it("kịch bản tốt: không có lỗi", () => {
    const a = analyze(scenesToGraph(SCENES, { ...ctx, facts: ctx.facts.slice(0, 1) }), { maxSec: 45, characterRefs: ctx.characterRefs });
    const errs = [...a.global, ...Object.values(a.byNode).flat()].filter((w) => w.level === "error");
    assert.deepEqual(errs, []);
    assert.equal(a.order.length, 5);
  });
});

describe("tiện ích", () => {
  it("parseFactCheck đọc bảng của đúng video, gắn URL theo nguồn", () => {
    const md = "## vid-su-19\n| 1 | khác | x | Đúng |\n## vid-su-20 · Tên\n| # | Khẳng định | Nguồn | Kết luận |\n|---|---|---|---|\n| 1 | Cọc gỗ | Bảo tàng Lịch sử QG | Đúng |\n| 2 | Năm 938 | Toàn thư; quyển 5 | Đúng (có lưu ý) |\n## vid-su-21\n| 1 | y | y | y |";
    const f = parseFactCheck(md, "vid-su-20", ["Bảo tàng Lịch sử Quốc gia: https://baotanglichsu.vn/x"]);
    assert.equal(f.length, 2);
    assert.equal(f[0].url, "https://baotanglichsu.vn/x");
    assert.equal(f[1].verdict, "Đúng (có lưu ý)");
  });
  it("autoLayout xếp cảnh theo thứ tự từ trái sang phải", () => {
    const g = scenesToGraph(SCENES, ctx);
    g.nodes.forEach((n) => (n.position = { x: 0, y: 0 }));
    const pos = new Map(autoLayout(g).map((n) => [n.id, n.position]));
    const xs = ["s0", "s1", "s2", "s3", "s4", "video"].map((id) => pos.get(id)!.x);
    assert.deepEqual([...xs].sort((a, b) => a - b), xs);
    assert.ok(pos.get("s1-v0")!.y < pos.get("s1")!.y, "hình ở trên cảnh");
  });
  it("validateGraph chặn kiểu lạ và đường dẫn ..", () => {
    const g = scenesToGraph(SCENES, ctx);
    assert.equal(validateGraph(g), null);
    assert.ok(validateGraph({ ...g, nodes: [...g.nodes, { id: "z", type: "evil" as any, position: { x: 0, y: 0 }, data: {} }] }));
    assert.ok(validateGraph({ ...g, nodes: [...g.nodes, { id: "z", type: "media", position: { x: 0, y: 0 }, data: { ref: "../../etc/passwd" } }] }));
    assert.ok(validateGraph(undefined));
  });
  it("draftFromIdea + ideaStarterGraph: có Hook, CTA, An dùng ảnh có sẵn", () => {
    const i = { id: "idea-x", profile: "p", title: "Cọc Bạch Đằng: mưu kế", hook: "Cọc gỗ đánh bại thuyền chiến?", angle: "", status: "idea", plan: { main: "Năm 938 Ngô Quyền đóng cọc. Thuỷ triều rút. Thuyền giặc vỡ.", sources: "Toàn thư; Bảo tàng", year: "938" } } as unknown as Idea;
    const d = draftFromIdea(i);
    assert.equal(d.scenes[0].narration, i.hook);
    assert.match(d.scenes.at(-1)!.narration, /Mình là An/);
    assert.equal(d.facts.length, 3);
    const g = ideaStarterGraph({ profile: "p", idea: i, ideaId: i.id, characterId: "char-an", characterRefs: ["assets/a.png"], defaultAnImage: "assets/a.png" });
    assert.ok(g.nodes.some((n) => n.type === "hook") && g.nodes.some((n) => n.type === "cta"));
    assert.ok(g.nodes.some((n) => n.type === "character"));
  });
});

describe("API canvas", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-graph-"));
  const data = path.join(tmp, "data");
  let PUT: any, APPLY: any, GET: any, dataMod: typeof import("../lib/data");
  const P = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  before(async () => {
    for (const d of ["ideas", "videos", "profiles", "graphs"]) fs.mkdirSync(path.join(data, d), { recursive: true });
    fs.writeFileSync(path.join(data, "profiles", "p.json"), JSON.stringify({ slug: "p", name: "P", sections: { hashtags: ["#a"] }, cast: [{ id: "char-an", name: "An", refs: [] }] }));
    fs.writeFileSync(path.join(data, "ideas", "idea-t.json"), JSON.stringify({ id: "idea-t", profile: "p", title: "Thử", status: "production", history: [], videoId: "vid-t", characterId: "char-an", plan: { series: "Bạn có biết?" } }));
    fs.writeFileSync(path.join(data, "ideas", "idea-n.json"), JSON.stringify({ id: "idea-n", profile: "p", title: "Mới", status: "idea", history: [], plan: { series: "Nhân vật", main: "Một. Hai." } }));
    fs.writeFileSync(path.join(data, "videos", "vid-t.json"), JSON.stringify({ id: "vid-t", ideaId: "idea-t", profile: "p", title: "Thử", status: "review", scenes: SCENES, caption: "c", hashtags: [], tts: { engine: "edge", voice: "v", rate: "+0%" }, render: { state: "done", output: "out/vid-t.mp4" }, sources: ["A: https://a.vn"] }));
    fs.mkdirSync(path.join(data, "assets", "p", "su-1", "clips"), { recursive: true });
    for (const f of ["su-1/clips/01-hook.mp4", "su-1/05-cta.png", "su-1/02-other.png"]) fs.writeFileSync(path.join(data, "assets", "p", f), "x");
    fs.writeFileSync(path.join(data, "schedule.json"), JSON.stringify({ entries: [] }));
    fs.writeFileSync(path.join(tmp, "fc.md"), "## vid-t\n| 1 | Ngô Quyền đóng cọc dưới lòng sông Bạch Đằng | Toàn thư | Đúng |\n");
    Object.assign(process.env, { DATA_DIR: data, MEDIA_DIR: path.join(tmp, "media"), FACT_CHECK_FILE: path.join(tmp, "fc.md") });
    ({ GET, PUT } = await import("../app/api/graphs/[id]/route"));
    ({ POST: APPLY } = await import("../app/api/graphs/[id]/apply/route"));
    dataMod = await import("../lib/data");
  });
  it("mở video dựng đồ thị kèm fact; PUT chỉ ghi data/graphs", async () => {
    const r = await (await GET(new Request("http://x"), P("vid-t"))).json();
    assert.equal(r.ctx.videoId, "vid-t"); assert.equal(r.ctx.maxSec, 45); assert.equal(r.ctx.video.inQueue, true);
    assert.ok(r.graph.nodes.some((n: any) => n.type === "fact" && n.data.verdict === "Đúng"));
    const before = fs.readFileSync(path.join(data, "videos", "vid-t.json"), "utf8");
    const g: ScriptGraph = r.graph; g.nodes.find((n) => n.id === "s1")!.data.narration = "ĐỔI";
    const res = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ graph: g }) }), P("vid-t"));
    assert.equal(res.status, 200);
    assert.equal(fs.readFileSync(path.join(data, "videos", "vid-t.json"), "utf8"), before);
    const again = await (await GET(new Request("http://x"), P("vid-t"))).json();
    assert.equal(again.graph.nodes.find((n: any) => n.id === "s1").data.narration, "ĐỔI", "bản nháp trên canvas được giữ");
  });
  it("Tạo kịch bản: video trong hàng đợi cần xác nhận, sau đó về 'doing' và thêm nguồn", async () => {
    const g: ScriptGraph = (await (await GET(new Request("http://x"), P("vid-t"))).json()).graph;
    g.nodes.push({ id: "n-fact-1", type: "fact", position: { x: 0, y: 0 }, data: { claim: "x", source: "Bảo tàng", url: "https://btls.vn/a", verdict: "Đúng" } });
    let res = await APPLY(req({ graph: g }), P("vid-t"));
    assert.equal(res.status, 409); assert.equal((await res.json()).needConfirm, true);
    assert.equal(dataMod.getVideo("vid-t")!.scenes[1].narration, SCENES[1].narration);
    res = await APPLY(req({ graph: g, confirmQueued: true }), P("vid-t"));
    const j = await res.json();
    assert.equal(res.status, 200); assert.equal(j.changed, true); assert.equal(j.status, "doing");
    const v = dataMod.getVideo("vid-t")!;
    assert.equal(v.scenes[1].narration, "ĐỔI"); assert.deepEqual(v.scenes[1].archive, SCENES[1].archive);
    assert.ok((v as any).sources.some((s: string) => s.includes("https://btls.vn/a")));
    assert.equal((v as any).sources[0], "A: https://a.vn");
    const saved = JSON.parse(fs.readFileSync(path.join(data, "graphs", "vid-t.json"), "utf8"));
    assert.equal(saved.sourceHash, scenesHash(v.scenes));
    // ghi lại y hệt: không đổi gì
    const r2 = await (await APPLY(req({ graph: g }), P("vid-t"))).json();
    assert.equal(r2.changed, false);
  });
  it("ý tưởng chưa có video: khung starter, ghi vào idea.script", async () => {
    const r = await (await GET(new Request("http://x"), P("idea-n"))).json();
    assert.equal(r.ctx.videoId, undefined); assert.equal(r.ctx.maxSec, 60);
    assert.deepEqual(r.ctx.an.map((m: any) => `${m.kind} ${m.ref}`).sort(), ["clip assets/p/su-1/clips/01-hook.mp4", "image assets/p/su-1/05-cta.png"]);
    assert.ok(r.graph.nodes.some((n: any) => n.type === "character" && n.data.clip === "assets/p/su-1/clips/01-hook.mp4"), "hook dùng clip An có sẵn");
    const g: ScriptGraph = r.graph;
    g.nodes.filter((n) => n.type === "scene").forEach((n, k) => (n.data.narration = `Cảnh ${k}`));
    const j = await (await APPLY(req({ graph: g }), P("idea-n"))).json();
    assert.equal(j.target, "idea");
    const i = dataMod.getIdea("idea-n")!;
    assert.equal(i.status, "script"); assert.ok(i.script!.scenes.length >= 3);
  });
  it("chặn id lạ và đồ thị rỗng", async () => {
    assert.equal((await GET(new Request("http://x"), P("vid-khong-co"))).status, 404);
    const res = await APPLY(req({ graph: { version: 1, id: "vid-t", profile: "p", nodes: [{ id: "video", type: "video", position: { x: 0, y: 0 }, data: {} }], edges: [] } }), P("vid-t"));
    assert.equal(res.status, 400);
  });
});
