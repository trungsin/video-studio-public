/**
 * myCDN: đẩy file theo hash nội dung, không ghi đè, xoá bản cũ khi render lại; route chỉ chuyển hướng khi file local còn khớp.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import type * as Cdn from "../lib/cdn";
import type * as MediaRoute from "../app/api/media/[...path]/route";
import type * as ThumbRoute from "../app/api/thumb/route";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-cdn-"));
const DATA = path.join(root, "data"), MEDIA = path.join(root, "media");
process.env.DATA_DIR = DATA; process.env.MEDIA_DIR = MEDIA;
const env = { MYCDN_URL: "https://cdn.test", MYCDN_API_KEY__KENH_A: "mcdn_a" };
const OLD = Date.now() - 120_000;

let cdn: typeof Cdn, media: typeof MediaRoute, thumb: typeof ThumbRoute;
const params = (p: string) => ({ params: Promise.resolve({ path: p.split("/") }) });

/** CDN giả: nhớ các path đã có (path -> thumbnailUrl), GET metadata, 409 khi trùng, ghi lại request. */
function fakeCdn() {
  const stored = new Map<string, string | null>(), calls: string[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url} ${(init.headers as Record<string, string>)["X-API-Key"]}`);
    if (init.method !== "POST") {
      const p = decodeURIComponent(url.split("/api/files/")[1]);
      if (init.method === "DELETE") { stored.delete(p); return new Response(null, { status: 204 }); }
      return stored.has(p) ? Response.json({ path: p, url: `https://cdn.test/f/${p}`, thumbnailUrl: stored.get(p) }) : Response.json({ message: "Not found" }, { status: 404 });
    }
    const form = init.body as FormData, file = form.get("file") as File;
    const p = `${form.get("prefix")}/${file.name}`;
    if (stored.has(p)) return Response.json({ items: [], errors: [{ path: p, statusCode: 409, message: "Path already exists" }] });
    stored.set(p, `https://cdn.test/t/${p}`);
    return Response.json({ items: [{ path: p, url: `https://cdn.test/f/${p}`, thumbnailUrl: `https://cdn.test/t/${p}` }], errors: [] }, { status: 201 });
  }) as unknown as typeof fetch;
  return { f, stored, calls };
}

const put = (rel: string, body: string, mtime = OLD) => {
  const file = path.join(MEDIA, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  fs.utimesSync(file, mtime / 1000, mtime / 1000);
};

before(async () => {
  fs.mkdirSync(path.join(DATA, "profiles"), { recursive: true });
  fs.mkdirSync(path.join(DATA, "videos"), { recursive: true });
  fs.mkdirSync(path.join(DATA, "assets", "kenh-a"), { recursive: true });
  fs.writeFileSync(path.join(DATA, "profiles", "kenh-a.json"), JSON.stringify({ slug: "kenh-a", name: "A" }));
  fs.writeFileSync(path.join(DATA, "assets", "kenh-a", "cover.png"), "cover");
  fs.utimesSync(path.join(DATA, "assets", "kenh-a", "cover.png"), OLD / 1000, OLD / 1000);
  fs.writeFileSync(path.join(DATA, "assets", "kenh-a", "notes.txt"), "không phải media");
  fs.writeFileSync(path.join(DATA, "videos", "vid-a.json"), JSON.stringify({
    id: "vid-a", profile: "kenh-a", createdAt: "2026-10-30", scenes: [{ title: "", narration: "", image: "uploads/vid-a/s0.png" }],
    render: { state: "done", output: "out/vid-a.mp4" },
  }));
  fs.writeFileSync(path.join(DATA, "videos", "vid-b.json"), JSON.stringify({
    id: "vid-b", profile: "kenh-a", createdAt: "2026-10-30", scenes: [{ title: "", narration: "" }],
    render: { state: "running", output: "out/vid-b.mp4" },
  }));
  put("uploads/vid-a/s0.png", "png-1");
  put("out/vid-a.mp4", "mp4-1");
  put("out/vid-b.mp4", "đang render dở");
  cdn = await import("../lib/cdn");
  media = await import("../app/api/media/[...path]/route");
  thumb = await import("../app/api/thumb/route");
});

describe("cdn sync", () => {
  it("chỉ lấy media phục vụ: ảnh cảnh, MP4 đã render xong, assets của profile", () => {
    assert.deepEqual(cdn.profileRefs("kenh-a"), ["assets/kenh-a/cover.png", "out/vid-a.mp4", "uploads/vid-a/s0.png"]);
  });

  it("profile không có key thì không gọi CDN", async () => {
    const { f, calls } = fakeCdn();
    assert.equal((await cdn.syncProfile("kenh-a", { env: { MYCDN_URL: "https://cdn.test" }, fetch: f })).uploaded, 0);
    assert.equal(calls.length, 0);
  });

  it("đẩy theo hash nội dung, lượt sau không đẩy lại; render lại -> đường dẫn mới và xoá bản cũ", async () => {
    const c = fakeCdn();
    const r1 = await cdn.syncProfile("kenh-a", { env, fetch: c.f });
    assert.equal(r1.uploaded, 3);
    const e1 = cdn.cdnFor("out/vid-a.mp4")!;
    assert.match(e1.path, /^kenh-a\/out\/vid-a-[0-9a-f]{12}\.mp4$/);
    assert.ok(c.calls.every((x) => x.endsWith(" mcdn_a")));

    assert.equal((await cdn.syncProfile("kenh-a", { env, fetch: c.f })).uploaded, 0);

    put("out/vid-a.mp4", "mp4-2", OLD + 1000);
    assert.equal(cdn.cdnFor("out/vid-a.mp4"), null, "file local đổi: không chuyển hướng sang bản cũ");
    await cdn.syncProfile("kenh-a", { env, fetch: c.f });
    const e2 = cdn.cdnFor("out/vid-a.mp4")!;
    assert.notEqual(e2.path, e1.path);
    assert.ok(!c.stored.has(e1.path) && c.stored.has(e2.path));
  });

  it("file vừa ghi chờ lượt sau; touch cùng nội dung giữ bản CDN", async () => {
    const c = fakeCdn();
    put("uploads/vid-a/s0.png", "png-new", Date.now());
    const r = await cdn.syncProfile("kenh-a", { env, fetch: c.f });
    assert.equal(r.pending, 1);
    assert.equal(c.calls.length, 0);

    const before = cdn.cdnFor("assets/kenh-a/cover.png")!;
    const cover = path.join(DATA, "assets", "kenh-a", "cover.png");
    fs.utimesSync(cover, OLD / 1000 - 10, OLD / 1000 - 10);
    await cdn.syncProfile("kenh-a", { env, fetch: c.f, now: Date.now() });
    assert.equal(cdn.cdnFor("assets/kenh-a/cover.png")!.path, before.path);
    assert.ok(!c.calls.some((x) => x.includes("cover")));
  });

  it("CDN đã có bản (manifest mất / lượt trước bị 524) -> dùng metadata có sẵn, không gửi lại file", async () => {
    fs.rmSync(path.join(MEDIA, ".cdn"), { recursive: true });
    const c = fakeCdn();
    put("uploads/vid-a/s0.png", "png-1");
    const sha = crypto.createHash("sha256").update("png-1").digest("hex");
    const p = cdn.cdnPathFor("kenh-a", "uploads/vid-a/s0.png", sha);
    c.stored.set(p, null);
    const r = await cdn.syncProfile("kenh-a", { env, fetch: c.f });
    assert.deepEqual(r.failed, []);
    const e = cdn.cdnFor("uploads/vid-a/s0.png")!;
    assert.equal(e.url, `https://cdn.test/f/${p}`);
    assert.equal(e.thumb, null, "thumbnail lấy từ CDN, không đoán");
    assert.ok(!c.calls.some((x) => x.startsWith("POST") && x.includes("s0")));
  });

  it("render xong -> syncVideo đẩy MP4 ngay (không chờ 30 s); đang render thì không đụng", async () => {
    const c = fakeCdn();
    const write = (state: string) => fs.writeFileSync(path.join(DATA, "videos", "vid-c.json"), JSON.stringify({
      id: "vid-c", profile: "kenh-a", createdAt: "2026-10-30", scenes: [{ title: "", narration: "" }], render: { state, output: "out/vid-c.mp4" },
    }));
    put("out/vid-c.mp4", "mp4-c", Date.now());
    write("running");
    assert.equal((await cdn.syncVideo("vid-c", { env, fetch: c.f })).uploaded, 0);
    assert.equal(c.calls.length, 0);
    write("done");
    assert.equal((await cdn.syncVideo("vid-c", { env, fetch: c.f })).uploaded, 1);
    assert.match(cdn.cdnFor("out/vid-c.mp4")!.path, /^kenh-a\/out\/vid-c-[0-9a-f]{12}\.mp4$/);
  });
});

describe("cdn routes", () => {
  it("media/thumb chuyển hướng khi đã lên CDN, còn lại phục vụ local", async () => {
    const e = cdn.cdnFor("out/vid-a.mp4")!;
    const res = await media.GET(new Request("http://x/api/media/out/vid-a.mp4"), params("out/vid-a.mp4"));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), e.url);
    const t = await thumb.GET(new Request(`http://x/api/thumb?src=${encodeURIComponent("out/vid-a.mp4")}&w=360`));
    assert.equal(t.headers.get("location"), e.thumb);
    const big = await thumb.GET(new Request(`http://x/api/thumb?src=${encodeURIComponent("uploads/vid-a/s0.png")}&w=720`));
    assert.equal(big.headers.get("location"), cdn.cdnFor("uploads/vid-a/s0.png")!.url);

    const local = await media.GET(new Request("http://x/api/media/out/vid-b.mp4"), params("out/vid-b.mp4"));
    assert.equal(local.status, 200);
    assert.equal(await local.text(), "đang render dở");
  });
});
