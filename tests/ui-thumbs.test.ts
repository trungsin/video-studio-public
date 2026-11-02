/**
 * Ảnh đại diện trong UI: ảnh tư liệu (data/archive), poster clip, phục vụ file an toàn qua /api/assets và /api/thumb.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-thumb-"));
const DATA = path.join(root, "data"), MEDIA = path.join(root, "media");
process.env.DATA_DIR = DATA; process.env.MEDIA_DIR = MEDIA;

const ff = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
let thumbs: typeof import("../lib/thumbs");
let mu: typeof import("../lib/media-url");
let assets: any, thumbRoute: any, media: any;
const params = (p: string) => ({ params: Promise.resolve({ path: p.split("/") }) });

before(async () => {
  fs.mkdirSync(path.join(DATA, "archive", "cuu-dinh"), { recursive: true });
  fs.mkdirSync(path.join(DATA, "assets", "kenh", "clips"), { recursive: true });
  fs.mkdirSync(MEDIA, { recursive: true });
  ff(["-f", "lavfi", "-i", "color=c=red:s=320x240", "-frames:v", "1", path.join(DATA, "archive", "cuu-dinh", "ho.jpg")]);
  ff(["-f", "lavfi", "-i", "color=c=blue:s=180x320:d=2", "-pix_fmt", "yuv420p", path.join(DATA, "assets", "kenh", "clips", "hook.mp4")]);
  ff(["-f", "lavfi", "-i", "color=c=green:s=200x300", "-frames:v", "1", path.join(DATA, "assets", "kenh", "an.png")]);
  fs.writeFileSync(path.join(DATA, "archive", "cuu-dinh", "index.json"), JSON.stringify({ items: [
    { id: "cuu-dinh/ho", file: "cuu-dinh/ho.jpg", title: "File:Hổ.jpg", author: "Phương Huy", license: "CC BY-SA 4.0", page: "https://commons.wikimedia.org/wiki/File:H.jpg", attributionRequired: true },
    { id: "cuu-dinh/pd", file: "cuu-dinh/ho.jpg", title: "File:PD.jpg", author: "Unknown", license: "Public domain", date: "1920s", attributionRequired: false },
  ] }));
  fs.writeFileSync(path.join(root, "secret.txt"), "x");
  thumbs = await import("../lib/thumbs");
  mu = await import("../lib/media-url");
  assets = await import("../app/api/assets/[...path]/route");
  thumbRoute = await import("../app/api/thumb/route");
  media = await import("../app/api/media/[...path]/route");
});

const scene = (o: any) => ({ title: "", narration: "", ...o });
const video = (scenes: any[], render: any = { state: "idle" }) => ({ id: "v", scenes, render } as any);

describe("ảnh đại diện", () => {
  it("mediaUrl cho assets/archive/media", () => {
    assert.equal(mu.mediaUrl("assets/kenh/an.png"), "/api/assets/kenh/an.png");
    assert.equal(mu.mediaUrl("archive/cuu-dinh/ho.jpg"), "/api/assets/archive/cuu-dinh/ho.jpg");
    assert.equal(mu.mediaUrl("out/v 1.mp4"), "/api/media/out/v%201.mp4");
    assert.ok(mu.isVideoRef("a/b.MP4") && !mu.isVideoRef("a.png"));
  });
  it("cảnh chỉ có ảnh tư liệu -> ảnh đầu tiên, số ảnh, nhãn, ghi công", () => {
    const sc = scene({ archive: { items: [{ id: "cuu-dinh/ho", label: "Hổ · Cao Đỉnh" }, { id: "cuu-dinh/pd" }, { id: "cuu-dinh/khong-co" }] } });
    const vis = thumbs.sceneVisual(sc);
    assert.equal(vis.kind, "archive"); assert.equal(vis.count, 2); assert.equal(vis.label, "Hổ · Cao Đỉnh");
    assert.equal(vis.credit, "Phương Huy / Wikimedia Commons, CC BY-SA 4.0");
    assert.equal(vis.thumb, mu.thumbUrl("archive/cuu-dinh/ho.jpg", 360));
    const items = thumbs.archiveItems(sc);
    assert.equal(items[1].credit, "tác giả không rõ, 1920s (phạm vi công cộng), Wikimedia Commons");
    assert.ok(items[2].missing);
    assert.deepEqual(Object.keys(thumbs.archiveMap(video([sc]))).sort(), ["cuu-dinh/ho", "cuu-dinh/khong-co", "cuu-dinh/pd"]);
  });
  it("videoThumb: ảnh tĩnh/ảnh tư liệu trước, rồi poster clip, rồi MP4 đã render", () => {
    const clip = scene({ clip: "assets/kenh/clips/hook.mp4" });
    const arch = scene({ archive: { items: [{ id: "cuu-dinh/ho" }] } });
    assert.equal(thumbs.videoThumb(video([clip, arch])).kind, "archive");
    assert.equal(thumbs.videoThumb(video([clip])).kind, "clip");
    assert.equal(thumbs.videoThumb(video([scene({})], { state: "done", output: "out/v.mp4" })).kind, "render");
    assert.equal(thumbs.videoThumb(video([scene({})])).kind, "none");
    assert.equal(thumbs.sceneVisual(scene({ clip: "assets/kenh/clips/hook.mp4", archive: { items: [{ id: "cuu-dinh/ho" }] } })).kind, "clip");
  });
  it("ideaThumb: chưa có video -> nhân vật của profile", () => {
    const p = { cast: { characters: [{ id: "char-an", name: "An", description: "", refs: ["assets/kenh/an.png"] }], settings: [] } } as any;
    const t = thumbs.ideaThumb({ id: "i", characterId: "char-an" } as any, new Map(), p);
    assert.equal(t.kind, "cast"); assert.equal(t.label, "An");
    assert.equal(thumbs.ideaThumb({ id: "i" } as any, new Map(), null).kind, "none");
    const v = video([scene({ archive: { items: [{ id: "cuu-dinh/ho" }] } })]);
    assert.equal(thumbs.ideaThumb({ id: "i", videoId: "v" } as any, new Map([["v", v]]), p).kind, "archive");
  });
});

describe("phục vụ file", () => {
  it("/api/assets/archive chỉ trả ảnh, chặn index.json và thoát thư mục", async () => {
    const ok = await assets.GET(new Request("http://x/api/assets/archive/cuu-dinh/ho.jpg"), params("archive/cuu-dinh/ho.jpg"));
    assert.equal(ok.status, 200); assert.equal(ok.headers.get("content-type"), "image/jpeg");
    for (const bad of ["archive/cuu-dinh/index.json", "archive/../../secret.txt", "archive/..%2F..%2Fsecret.txt", "../secret.txt"]) {
      const r = await assets.GET(new Request("http://x/"), params(bad));
      assert.equal(r.status, 404, bad);
    }
  });
  it("/api/assets trả clip có Range", async () => {
    const r = await assets.GET(new Request("http://x/", { headers: { range: "bytes=0-99" } }), params("kenh/clips/hook.mp4"));
    assert.equal(r.status, 206); assert.equal(r.headers.get("content-type"), "video/mp4"); assert.equal(r.headers.get("content-length"), "100");
  });
  it("chặn symlink trỏ ra ngoài", async () => {
    fs.symlinkSync(path.join(root, "secret.txt"), path.join(DATA, "archive", "cuu-dinh", "leak.jpg"));
    const r = await assets.GET(new Request("http://x/"), params("archive/cuu-dinh/leak.jpg"));
    assert.equal(r.status, 404);
    assert.equal((await media.GET(new Request("http://x/"), params("../secret.txt"))).status, 404);
  });
  it("/api/thumb: ảnh thu nhỏ và poster clip (JPEG, có cache), từ chối tham chiếu lạ", async () => {
    for (const src of ["archive/cuu-dinh/ho.jpg", "assets/kenh/clips/hook.mp4", "assets/kenh/an.png"]) {
      const r = await thumbRoute.GET(new Request(`http://x/api/thumb?src=${encodeURIComponent(src)}&w=120`));
      assert.equal(r.status, 200, src); assert.equal(r.headers.get("content-type"), "image/jpeg");
      const buf = Buffer.from(await r.arrayBuffer()); assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8);
    }
    assert.ok(fs.readdirSync(path.join(MEDIA, ".thumbs")).filter((f) => f.endsWith(".jpg")).length >= 3);
    for (const src of ["../secret.txt", "archive/cuu-dinh/index.json", "assets/../../secret.txt", ".thumbs/x.jpg"]) {
      const r = await thumbRoute.GET(new Request(`http://x/api/thumb?src=${encodeURIComponent(src)}`));
      assert.equal(r.status, 404, src);
    }
  });
});
