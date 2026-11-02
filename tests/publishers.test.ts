/**
 * Test adapter đăng bài với fetch giả (không gọi mạng).  Chạy: npm test
 */
import "./channel-env";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { aiDisclosureOn, aiDisclosureText, DEFAULT_AI_TEXT, withAiLine } from "../lib/publishers/ai";
import { facebook, scheduleUnix } from "../lib/publishers/facebook";
import { ytCredentialKey } from "../lib/youtube-credentials";
import { pickPublisher, pickReal, publishTo } from "../lib/publishers/index";
import { instagram } from "../lib/publishers/instagram";
import { tiktok } from "../lib/publishers/tiktok";
import type { PublishCtx, PublishJob } from "../lib/publishers/types";
import { youtube } from "../lib/publishers/youtube";
import { zernio, zernioPlatformData, zernioTikTokSettings } from "../lib/publishers/zernio";
import { tiktokConsentValid, validateTikTokInput } from "../lib/tiktok";

type Call = { method: string; url: string; headers: Record<string, string>; body: string; bytes: number };
type Handler = (c: Call) => Response | undefined;

const SIZE = 6000;
let dir = "", file = "";
const realFetch = globalThis.fetch;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-pub-"));
  file = path.join(dir, "v.mp4");
  fs.writeFileSync(file, Buffer.alloc(SIZE, 7));
  // chặn mọi request mạng thật trong toàn bộ test
  globalThis.fetch = (async () => { throw new Error("NETWORK BLOCKED IN TESTS"); }) as typeof fetch;
});
after(() => { globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); });

const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });

function mockCtx(env: Record<string, string>, handlers: Handler[]): { ctx: PublishCtx; calls: Call[]; logs: string[] } {
  const calls: Call[] = [], logs: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers || {}).forEach((v, k) => { headers[k] = v; });
    let body = "", bytes = 0;
    const b = init?.body as unknown;
    if (typeof b === "string") body = b;
    else if (b && typeof (b as ReadableStream).getReader === "function") {
      const rd = (b as ReadableStream<Uint8Array>).getReader();
      for (;;) { const { done, value } = await rd.read(); if (done) break; bytes += value.length; }
      body = `<stream ${bytes}>`;
    }
    const c: Call = { method: (init?.method || "GET").toUpperCase(), url, headers, body, bytes };
    calls.push(c);
    for (const h of handlers) { const r = h(c); if (r) return r; }
    return json({ error: { message: `unmocked ${c.method} ${url}` } }, 599);
  }) as typeof fetch;
  return { ctx: { fetch: f, env, sleep: async () => {}, log: (l) => logs.push(l), dryRun: false }, calls, logs };
}

const job = (over: Partial<PublishJob> = {}): PublishJob => ({ videoPath: file, title: "Tiền giấy đầu tiên", caption: "Caption\n\nNội dung minh họa có sử dụng AI.", platform: "facebook", aiGenerated: true, ...over });

describe("AI disclosure", () => {
  it("mặc định bật, video/profile ghi đè được", () => {
    assert.equal(aiDisclosureOn(null, null, {}), true);
    assert.equal(aiDisclosureOn(null, null, { AI_DISCLOSURE: "0" }), false);
    assert.equal(aiDisclosureOn({ aiDisclosure: true }, { aiDisclosure: { enabled: false } }, { AI_DISCLOSURE: "0" }), true);
    assert.equal(aiDisclosureOn({}, { aiDisclosure: { enabled: false } }, {}), false);
  });
  it("text: profile > env > mặc định", () => {
    assert.equal(aiDisclosureText(null, {}), DEFAULT_AI_TEXT);
    assert.equal(aiDisclosureText(null, { AI_DISCLOSURE_TEXT: "AI env" }), "AI env");
    assert.equal(aiDisclosureText({ aiDisclosure: { text: "AI hồ sơ" } }, { AI_DISCLOSURE_TEXT: "AI env" }), "AI hồ sơ");
  });
  it("thêm dòng AI một lần, không lặp", () => {
    const once = withAiLine("Xin chào", true, DEFAULT_AI_TEXT);
    assert.equal(once, `Xin chào\n\n${DEFAULT_AI_TEXT}`);
    assert.equal(withAiLine(once, true, DEFAULT_AI_TEXT), once);
    assert.equal(withAiLine("Xin chào", false, DEFAULT_AI_TEXT), "Xin chào");
  });
});

const FB_ENV = { FB_PAGE_ID: "111", FB_PAGE_TOKEN: "tok-fb" };
const fbStatus = (s: object) => json({ id: "v1", status: s });
const DONE = { video_status: "ready", uploading_phase: { status: "complete" }, processing_phase: { status: "complete" }, publishing_phase: { status: "complete" } };

describe("Facebook Reels", () => {
  it("start -> rupload stream -> finish (is_ai_generated) -> poll", async () => {
    let polls = 0;
    const { ctx, calls } = mockCtx(FB_ENV, [
      (c) => c.method === "POST" && c.url === "https://graph.facebook.com/v26.0/111/video_reels" && c.body.includes('"upload_phase":"start"') ? json({ video_id: "v1", upload_url: "https://rupload.facebook.com/video-upload/v26.0/v1" }) : undefined,
      (c) => c.url.startsWith("https://rupload.facebook.com/video-upload/") ? json({ success: true }) : undefined,
      (c) => c.method === "POST" && c.url.endsWith("/video_reels") ? json({ success: true }) : undefined,
      (c) => c.url.includes("fields=status") ? (++polls < 2 ? fbStatus({ video_status: "processing", processing_phase: { status: "in_progress" }, publishing_phase: { status: "not_started" } }) : fbStatus(DONE)) : undefined,
    ]);
    const r = await facebook.publish(job(), ctx);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.id, "v1");
    assert.equal(r.url, "https://www.facebook.com/reel/v1");
    const up = calls[1];
    assert.equal(up.headers.authorization, "OAuth tok-fb");
    assert.equal(up.headers.offset, "0");
    assert.equal(up.headers.file_size, String(SIZE));
    assert.equal(up.bytes, SIZE);
    assert.equal(up.headers["content-length"], String(SIZE));
    assert.equal(up.headers["x-entity-length"], String(SIZE));
    const fin = new URLSearchParams(calls[2].body);
    assert.equal(fin.get("upload_phase"), "finish");
    assert.equal(fin.get("video_state"), "PUBLISHED");
    assert.equal(fin.get("is_ai_generated"), "true");
    assert.match(fin.get("description") || "", /AI/);
    assert.equal(polls, 2);
  });

  it("status ngay sau finish trả code 100/sub 33 -> coi là tạm thời, poll tiếp", async () => {
    let polls = 0;
    const { ctx } = mockCtx(FB_ENV, [
      (c) => c.body.includes('"upload_phase":"start"') ? json({ video_id: "v7" }) : undefined,
      (c) => c.url.includes("rupload") ? json({ success: true }) : undefined,
      (c) => c.method === "POST" ? json({ success: true, post_id: "p7" }) : undefined,
      (c) => c.url.includes("fields=status") ? (++polls === 1 ? json({ error: { message: "Unsupported get request. Object with ID 'v7' does not exist", type: "GraphMethodException", code: 100, error_subcode: 33 } }, 400) : fbStatus(DONE)) : undefined,
    ]);
    const r = await facebook.publish(job(), ctx);
    assert.equal(r.ok, true, r.error);
    assert.equal(polls, 2);
  });

  it("upload đứt giữa chừng -> đọc bytes_transfered và gửi tiếp từ offset", async () => {
    let n = 0;
    const { ctx, calls } = mockCtx(FB_ENV, [
      (c) => c.body.includes('"upload_phase":"start"') ? json({ video_id: "v2", upload_url: "https://rupload.facebook.com/video-upload/v26.0/v2" }) : undefined,
      (c) => c.url.includes("rupload") ? (++n === 1 ? json({ debug_info: { retriable: true, type: "PartialRequestError", message: "cut" } }, 500) : json({ success: true })) : undefined,
      (c) => c.url.includes("fields=status") ? fbStatus(n < 2 ? { uploading_phase: { status: "in_progress", bytes_transfered: 4000 } } : DONE) : undefined,
      (c) => c.method === "POST" && c.url.endsWith("/video_reels") ? json({ success: true }) : undefined,
    ]);
    const r = await facebook.publish(job(), ctx);
    assert.equal(r.ok, true, r.error);
    const ups = calls.filter((c) => c.url.includes("rupload"));
    assert.equal(ups.length, 2);
    assert.equal(ups[1].headers.offset, "4000");
    assert.equal(ups[1].bytes, SIZE - 4000);
    assert.equal(ups[1].headers["content-length"], String(SIZE - 4000));
    assert.equal(ups[1].headers["x-entity-length"], String(SIZE));
  });

  it("lỗi xử lý phía Facebook -> ok:false kèm thông báo rõ", async () => {
    const { ctx } = mockCtx(FB_ENV, [
      (c) => c.body.includes('"upload_phase":"start"') ? json({ video_id: "v3" }) : undefined,
      (c) => c.url.includes("rupload") ? json({ success: true }) : undefined,
      (c) => c.method === "POST" ? json({ success: true }) : undefined,
      (c) => c.url.includes("fields=status") ? fbStatus({ processing_phase: { status: "error", error: { message: "Resolution too low" } } }) : undefined,
    ]);
    const r = await facebook.publish(job(), ctx);
    assert.equal(r.ok, false);
    assert.match(r.error!, /Resolution too low/);
    assert.match(r.error!, /v3/);
  });

  it("lỗi upload không retriable -> dừng ngay, báo đúng số lần thử", async () => {
    const { ctx, calls } = mockCtx(FB_ENV, [
      (c) => c.body.includes('"upload_phase":"start"') ? json({ video_id: "v6" }) : undefined,
      (c) => c.url.includes("rupload") ? json({ debug_info: { retriable: false, type: "ParameterValidationError", message: "Invalid Header format" } }, 400) : undefined,
    ]);
    const r = await facebook.publish(job(), ctx);
    assert.equal(r.ok, false);
    assert.equal(calls.filter((c) => c.url.includes("rupload")).length, 1);
    assert.match(r.error!, /Invalid Header format .*đã thử 1 lần/);
  });

  it("lỗi Graph ở bước start không lộ token", async () => {
    const { ctx } = mockCtx(FB_ENV, [() => json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190, fbtrace_id: "T" } }, 400)]);
    const r = await facebook.publish(job(), ctx);
    assert.equal(r.ok, false);
    assert.match(r.error!, /Facebook start: HTTP 400 - Invalid OAuth access token \| OAuthException \| code 190/);
    assert.doesNotMatch(r.error!, /tok-fb/);
  });

  it("lên lịch: video_state=SCHEDULED + scheduled_publish_time; quá gần thì từ chối", async () => {
    const at = new Date(Date.now() + 3 * 3600e3).toISOString();
    const { ctx, calls } = mockCtx(FB_ENV, [
      (c) => c.body.includes('"upload_phase":"start"') ? json({ video_id: "v4" }) : undefined,
      (c) => c.url.includes("rupload") ? json({ success: true }) : undefined,
      (c) => c.method === "POST" ? json({ success: true }) : undefined,
      (c) => c.url.includes("fields=status") ? fbStatus({ processing_phase: { status: "complete" }, publishing_phase: { status: "not_started" } }) : undefined,
    ]);
    const r = await facebook.publish(job({ scheduleAt: at }), ctx);
    assert.equal(r.ok, true, r.error);
    const fin = new URLSearchParams(calls.find((c) => c.body.includes("upload_phase=finish"))!.body);
    assert.equal(fin.get("video_state"), "SCHEDULED");
    assert.equal(fin.get("scheduled_publish_time"), String(Math.floor(Date.parse(at) / 1000)));
    assert.throws(() => scheduleUnix(new Date(Date.now() + 60e3).toISOString()), /10 phút/);
  });

  it("aiGenerated=false -> không gửi is_ai_generated", async () => {
    const { ctx, calls } = mockCtx(FB_ENV, [
      (c) => c.body.includes('"upload_phase":"start"') ? json({ video_id: "v5" }) : undefined,
      (c) => c.url.includes("rupload") ? json({ success: true }) : undefined,
      (c) => c.method === "POST" ? json({ success: true }) : undefined,
      (c) => c.url.includes("fields=status") ? fbStatus(DONE) : undefined,
    ]);
    await facebook.publish(job({ aiGenerated: false }), ctx);
    assert.equal(new URLSearchParams(calls[2].body).get("is_ai_generated"), null);
  });
});

const IG_ENV = { IG_USER_ID: "1784", IG_ACCESS_TOKEN: "tok-ig" };
describe("Instagram Reels (resumable)", () => {
  it("container -> rupload -> poll status_code -> media_publish -> permalink", async () => {
    let polls = 0;
    const { ctx, calls } = mockCtx(IG_ENV, [
      (c) => c.method === "POST" && c.url === "https://graph.facebook.com/v26.0/1784/media" ? json({ id: "c1", uri: "https://rupload.facebook.com/ig-api-upload/v26.0/c1" }) : undefined,
      (c) => c.url === "https://rupload.facebook.com/ig-api-upload/v26.0/c1" ? json({ success: true, message: "Upload successful." }) : undefined,
      (c) => c.url.includes("c1?fields=status_code") ? json({ status_code: ++polls < 3 ? "IN_PROGRESS" : "FINISHED" }) : undefined,
      (c) => c.url.endsWith("/1784/media_publish") ? json({ id: "m1" }) : undefined,
      (c) => c.url.includes("m1?fields=permalink") ? json({ permalink: "https://www.instagram.com/reel/abc/" }) : undefined,
    ]);
    const r = await instagram.publish(job({ platform: "instagram" }), ctx);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.id, "m1");
    assert.equal(r.url, "https://www.instagram.com/reel/abc/");
    const body = JSON.parse(calls[0].body);
    assert.equal(body.media_type, "REELS");
    assert.equal(body.upload_type, "resumable");
    assert.equal(body.is_ai_generated, true);
    assert.equal(body.video_url, undefined);
    assert.equal(calls[0].headers.authorization, "Bearer tok-ig");
    assert.equal(calls[1].headers.authorization, "OAuth tok-ig");
    assert.equal(calls[1].headers.file_size, String(SIZE));
    assert.equal(calls[1].bytes, SIZE);
    assert.equal(calls[1].headers["x-entity-length"], String(SIZE));
    assert.equal(polls, 3);
    assert.deepEqual(JSON.parse(calls.find((c) => c.url.endsWith("media_publish"))!.body), { creation_id: "c1" });
  });

  it("status_code=ERROR -> ok:false", async () => {
    const { ctx } = mockCtx(IG_ENV, [
      (c) => c.url.endsWith("/1784/media") ? json({ id: "c2" }) : undefined,
      (c) => c.url.includes("ig-api-upload/v26.0/c2") ? json({ success: true }) : undefined,
      (c) => c.url.includes("fields=status_code") ? json({ status_code: "ERROR", status: "Error: 2207026" }) : undefined,
    ]);
    const r = await instagram.publish(job({ platform: "instagram" }), ctx);
    assert.equal(r.ok, false);
    assert.match(r.error!, /ERROR: Error: 2207026/);
  });

  it("aiGenerated=false -> không có is_ai_generated", async () => {
    const { ctx, calls } = mockCtx(IG_ENV, [() => json({ error: { message: "stop" } }, 400)]);
    await instagram.publish(job({ platform: "instagram", aiGenerated: false }), ctx);
    assert.equal(JSON.parse(calls[0].body).is_ai_generated, undefined);
  });
});

describe("YouTube / TikTok / Zernio cờ AI", () => {
  it("YouTube status.containsSyntheticMedia=true, upload stream", async () => {
    const { ctx, calls } = mockCtx({ YT_CLIENT_ID: "a", YT_CLIENT_SECRET: "b", YT_REFRESH_TOKEN: "c" }, [
      (c) => c.url.startsWith("https://oauth2") ? json({ access_token: "at" }) : undefined,
      (c) => c.method === "POST" ? json({}, 200, { location: "https://www.googleapis.com/upload/x?upload_id=1" }) : undefined,
      (c) => c.method === "PUT" ? json({ id: "yt1" }) : undefined,
    ]);
    const r = await youtube.publish(job({ platform: "youtube" }), ctx);
    assert.equal(r.ok, true, r.error);
    const meta = JSON.parse(calls[1].body);
    assert.equal(meta.status.containsSyntheticMedia, true);
    assert.equal(meta.snippet.categoryId, "27");
    assert.equal(calls[2].bytes, SIZE);
  });

  it("publishTo uses fresh scoped token/client, never the legacy owner's token", async () => {
    const save = { ...process.env };
    const envFile = path.join(dir, "scoped.env");
    const key = ytCredentialKey("second", "YT_REFRESH_TOKEN");
    const kind = ytCredentialKey("second", "YT_TOKEN_CLIENT");
    fs.writeFileSync(envFile, `YT_PROFILE=first\nYT_REFRESH_TOKEN=legacy-secret\n${key}=fresh-second-secret\n${kind}=desktop\n`);
    Object.assign(process.env, {
      ENV_FILE: envFile, YT_PROFILE: "first", YT_REFRESH_TOKEN: "legacy-secret",
      [key]: "stale-second-secret", [kind]: "web",
      YT_CLIENT_ID: "web", YT_CLIENT_SECRET: "web-secret",
      YT_DESKTOP_CLIENT_ID: "desktop", YT_DESKTOP_CLIENT_SECRET: "desktop-secret",
      PUBLISH_DRY_RUN: "0",
    });
    const calls: URLSearchParams[] = [];
    globalThis.fetch = (async (_u: any, init: any) => {
      calls.push(new URLSearchParams(init.body));
      return json({ error: "stop" }, 400);
    }) as typeof fetch;
    try {
      const channel = { platform: "youtube" as const, name: "Second", handle: "@second", connected: true, via: "direct" as const };
      const absent = await publishTo(job({ platform: "youtube" }), channel, { slug: "unknown" }, { live: true });
      assert.equal(absent.ok, false);
      assert.equal(calls.length, 0);
      const selected = await publishTo(job({ platform: "youtube" }), channel, { slug: "second" }, { live: true });
      assert.equal(selected.ok, false); // mocked token exchange stops before upload
      assert.equal(calls.length, 1);
      assert.equal(calls[0].get("refresh_token"), "fresh-second-secret");
      assert.equal(calls[0].get("client_id"), "desktop");
    } finally {
      globalThis.fetch = (async () => { throw new Error("NETWORK BLOCKED IN TESTS"); }) as typeof fetch;
      for (const k of Object.keys(process.env)) if (!(k in save)) delete process.env[k];
      Object.assign(process.env, save);
    }
  });
  it("dry-run logs never reveal scoped or global token and use chosen profile client", async () => {
    const save = { ...process.env }, log = console.log;
    const lines: string[] = [];
    try {
      Object.assign(process.env, {
        YT_PROFILE: "first", YT_REFRESH_TOKEN: "legacy-secret", YT_CLIENT_ID: "web", YT_CLIENT_SECRET: "web-secret",
        YT_DESKTOP_CLIENT_ID: "desktop", YT_DESKTOP_CLIENT_SECRET: "desktop-secret",
        [ytCredentialKey("second", "YT_REFRESH_TOKEN")]: "scoped-secret",
        [ytCredentialKey("second", "YT_TOKEN_CLIENT")]: "desktop", PUBLISH_DRY_RUN: "1",
      });
      const envFile = path.join(dir, "dry-scoped.env");
      fs.writeFileSync(envFile, `YT_PROFILE=first\nYT_REFRESH_TOKEN=legacy-file-secret\n${ytCredentialKey("second", "YT_REFRESH_TOKEN")}=fresh-scoped-secret\n${ytCredentialKey("second", "YT_TOKEN_CLIENT")}=desktop\n`);
      process.env.ENV_FILE = envFile;
      console.log = (...args) => { lines.push(args.join(" ")); };
      const result = await publishTo(job({ platform: "youtube" }),
        { platform: "youtube", name: "Second", handle: "@second", connected: true, via: "direct" },
        { slug: "second" });
      assert.equal(result.ok, true, result.error);
      const output = lines.join("\\n");
      assert.doesNotMatch(output, /legacy-secret|scoped-secret|web-secret|desktop-secret|legacy-file-secret|fresh-scoped-secret/);
      assert.match(output, /client_id=desktop/);
    } finally {
      console.log = log;
      for (const k of Object.keys(process.env)) if (!(k in save)) delete process.env[k];
      Object.assign(process.env, save);
    }
  });
  it("TikTok is_aigc theo job.aiGenerated", async () => {
    const { ctx, calls } = mockCtx({ TIKTOK_ACCESS_TOKEN: "t" }, [
      (c) => c.url.includes("/init/") ? json({ data: { publish_id: "p", upload_url: "https://open-upload.tiktokapis.com/u" }, error: { code: "ok" } }) : undefined,
      (c) => c.method === "PUT" ? new Response(null, { status: 201 }) : undefined,
    ]);
    const r = await tiktok.publish(job({ platform: "tiktok" }), ctx);
    assert.equal(r.ok, true, r.error);
    assert.equal(JSON.parse(calls[0].body).post_info.is_aigc, true);
    assert.equal(calls[1].bytes, SIZE);
  });

  it("Zernio platformSpecificData mang cờ AI", async () => {
    assert.deepEqual(zernioPlatformData(job({ platform: "youtube" })), { title: "Tiền giấy đầu tiên", containsSyntheticMedia: true });
    assert.deepEqual(zernioPlatformData(job({ platform: "instagram" })), { isAiGenerated: true });
    assert.deepEqual(zernioPlatformData(job({ platform: "tiktok" })), {});
    assert.deepEqual(zernioPlatformData(job({ platform: "facebook" })), { contentType: "reel" });
    const { ctx, calls } = mockCtx({ ZERNIO_API_KEY: "z" }, [
      (c) => c.url.endsWith("/media/presign") ? json({ uploadUrl: "https://up.example/x", publicUrl: "https://cdn.example/x.mp4" }) : undefined,
      (c) => c.url === "https://up.example/x" ? new Response(null, { status: 200 }) : undefined,
      (c) => c.url.endsWith("/posts") ? json({ post: { _id: "z1", platforms: [{ status: "published" }] } }) : undefined,
    ]);
    const r = await zernio.publish(job({ platform: "instagram", accountId: "acc" }), ctx);
    assert.equal(r.ok, true);
    const post = JSON.parse(calls[2].body);
    assert.equal(post.platforms[0].platformSpecificData.isAiGenerated, true);
    assert.equal(calls[1].headers.authorization, undefined);
  });
});

describe("MP4 trên CDN (job.videoUrl)", () => {
  const CDN = "https://cdn.example.com/f/kenh/out/v-abc123.mp4";
  it("Facebook: rupload nhận file_url, không gửi byte", async () => {
    const { ctx, calls } = mockCtx(FB_ENV, [
      (c) => c.body.includes('"upload_phase":"start"') ? json({ video_id: "v9", upload_url: "https://rupload.facebook.com/video-upload/v26.0/v9" }) : undefined,
      (c) => c.url.includes("rupload") ? json({ success: true }) : undefined,
      (c) => c.method === "POST" ? json({ success: true }) : undefined,
      (c) => c.url.includes("fields=status") ? fbStatus(DONE) : undefined,
    ]);
    const r = await facebook.publish(job({ videoUrl: CDN }), ctx);
    assert.equal(r.ok, true, r.error);
    const up = calls.find((c) => c.url.includes("rupload"))!;
    assert.equal(up.headers.file_url, CDN);
    assert.equal(up.headers.authorization, "OAuth tok-fb");
    assert.equal(up.bytes, 0);
  });

  it("Instagram: rupload nhận file_url, không gửi byte", async () => {
    const { ctx, calls } = mockCtx(IG_ENV, [
      (c) => c.url.endsWith("/1784/media") ? json({ id: "c9" }) : undefined,
      (c) => c.url.includes("ig-api-upload/v26.0/c9") ? json({ success: true }) : undefined,
      (c) => c.url.includes("fields=status_code") ? json({ status_code: "FINISHED" }) : undefined,
      (c) => c.url.endsWith("/media_publish") ? json({ id: "m9" }) : undefined,
      (c) => c.url.includes("fields=permalink") ? json({ permalink: "https://www.instagram.com/reel/x/" }) : undefined,
    ]);
    const r = await instagram.publish(job({ platform: "instagram", videoUrl: CDN }), ctx);
    assert.equal(r.ok, true, r.error);
    assert.equal(calls[1].headers.file_url, CDN);
    assert.equal(calls[1].bytes, 0);
  });

  it("Zernio: mediaItems trỏ thẳng CDN, không presign/PUT", async () => {
    const { ctx, calls } = mockCtx({ ZERNIO_API_KEY: "z" }, [
      (c) => c.url.endsWith("/posts") ? json({ post: { _id: "z9", platforms: [{ status: "published" }] } }) : undefined,
    ]);
    const r = await zernio.publish(job({ platform: "instagram", accountId: "acc", videoUrl: CDN }), ctx);
    assert.equal(r.ok, true, r.error);
    assert.ok(!calls.some((c) => c.url.endsWith("/media/presign")));
    assert.deepEqual(JSON.parse(calls.find((c) => c.url.endsWith("/posts"))!.body).mediaItems, [{ url: CDN, type: "video" }]);
  });
});

describe("Zernio TikTok", () => {
  const INFO = {
    creator: { nickname: "kenhlichsu", canPostMore: true },
    privacyLevels: [{ value: "PUBLIC_TO_EVERYONE" }, { value: "SELF_ONLY" }],
    postingLimits: { maxVideoDurationSec: 600, interactionSettings: { allow_comment: { enabled: true }, allow_duet: { enabled: false }, allow_stitch: { enabled: true } } },
  };
  const tt = (o: Record<string, unknown> = {}) => job({ platform: "tiktok", accountId: "tt1", tiktok: { privacyLevel: "PUBLIC_TO_EVERYONE", consentValid: true, consentAt: "2026-10-17T00:00:00Z", ...o } as PublishJob["tiktok"] });
  const flow = (post: (c: Call) => Response, extra: Handler[] = [], info: unknown = INFO) => mockCtx({ ZERNIO_API_KEY: "z", ZERNIO_POLL_INTERVAL_MS: "1" }, [
    ...extra,
    (c) => c.url.includes("/accounts/tt1/tiktok/creator-info?mediaType=video") ? json(info) : undefined,
    (c) => c.url.endsWith("/media/presign") ? json({ uploadUrl: "https://up.example/x", publicUrl: "https://cdn.example/x.mp4" }) : undefined,
    (c) => c.url === "https://up.example/x" ? new Response(null, { status: 200 }) : undefined,
    (c) => c.method === "POST" && c.url.endsWith("/posts") && JSON.parse(c.body).dryRun ? json({ dryRun: true, canPublish: true, tiktok: [{ canPublish: true }] }) : undefined,
    (c) => c.method === "POST" && c.url.endsWith("/posts") ? post(c) : undefined,
  ]);

  it("không có mặc định privacy, thiếu xác nhận thì từ chối trước mọi request", async () => {
    for (const j of [job({ platform: "tiktok", accountId: "tt1" }), tt({ privacyLevel: undefined }), tt({ consentValid: false })]) {
      const { ctx, calls } = flow(() => json({}));
      await assert.rejects(zernio.publish(j, ctx), /TikTok:/);
      assert.equal(calls.length, 0);
    }
    assert.match(validateTikTokInput({}) || "", /không có mặc định/);
    assert.match(validateTikTokInput({ privacyLevel: "SELF_ONLY", commercial: "brand_content" }) || "", /Branded content/);
    assert.match(validateTikTokInput({ privacyLevel: "X" }, ["SELF_ONLY"]) || "", /không nằm trong/);
    assert.equal(validateTikTokInput({ privacyLevel: "SELF_ONLY" }, ["SELF_ONLY"]), null);
  });

  it("tiktokSettings: toggle mặc định tắt, tôn trọng creator-info, consent + AI flag", () => {
    const s = zernioTikTokSettings(tt({ allowDuet: true, allowComment: true }), INFO);
    assert.deepEqual(s, { privacy_level: "PUBLIC_TO_EVERYONE", allow_comment: true, allow_duet: false, allow_stitch: false, content_preview_confirmed: true, express_consent_given: true, video_made_with_ai: true });
    assert.equal(zernioTikTokSettings(tt({ draft: true, commercial: "brand_organic" }), INFO).draft, true);
    assert.equal(zernioTikTokSettings(tt({ commercial: "brand_organic" }), INFO).commercialContentType, "brand_organic");
    assert.equal(zernioTikTokSettings({ ...tt(), aiGenerated: false }, INFO).video_made_with_ai, false);
    assert.throws(() => zernioTikTokSettings(tt({ privacyLevel: "FOLLOWER_OF_CREATOR" }), INFO), /không nằm trong/);
  });

  it("luồng đầy đủ: creator-info -> upload -> dryRun -> post -> poll tới published", async () => {
    let gets = 0;
    const { ctx, calls } = flow(() => json({ post: { _id: "p1", platforms: [{ platform: "tiktok", status: "processing" }] } }, 201), [
      (c) => c.method === "GET" && c.url.endsWith("/posts/p1") ? json({ post: { _id: "p1", platforms: [{ platform: "tiktok", status: ++gets < 2 ? "processing" : "published", platformPostUrl: "https://www.tiktok.com/@kenhlichsu/video/1" }] } }) : undefined,
    ]);
    const r = await zernio.publish(tt(), ctx);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.url, "https://www.tiktok.com/@kenhlichsu/video/1");
    assert.deepEqual(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), [
      "GET /api/v1/accounts/tt1/tiktok/creator-info", "POST /api/v1/media/presign", "PUT /x", "POST /api/v1/posts", "POST /api/v1/posts", "GET /api/v1/posts/p1", "GET /api/v1/posts/p1"]);
    const dry = JSON.parse(calls[3].body), post = JSON.parse(calls[4].body);
    assert.equal(dry.dryRun, true);
    assert.equal(post.dryRun, undefined);
    assert.ok(calls[4].headers["idempotency-key"]);
    const ts = post.platforms[0].platformSpecificData.tiktokSettings;
    assert.equal(ts.privacy_level, "PUBLIC_TO_EVERYONE");
    assert.equal(ts.video_made_with_ai, true);
    assert.equal(ts.express_consent_given, true);
    assert.equal(ts.allow_comment, false);
  });

  it("published nhưng chưa có link: chờ thêm tới khi có platformPostUrl", async () => {
    let gets = 0;
    const { ctx } = flow(() => json({ post: { _id: "p9", platforms: [{ platform: "tiktok", status: "published" }] } }, 201), [
      (c) => c.method === "GET" && c.url.endsWith("/posts/p9") ? json({ post: { _id: "p9", platforms: [{ platform: "tiktok", status: "published", ...(++gets >= 2 ? { platformPostUrl: "https://www.tiktok.com/@kenhlichsu/video/9" } : {}) }] } }) : undefined,
    ]);
    const r = await zernio.publish(tt(), ctx);
    assert.equal(r.url, "https://www.tiktok.com/@kenhlichsu/video/9");
    assert.equal(gets, 2);
  });

  it("dryRun canPublish=false thì không tạo post", async () => {
    const { ctx, calls } = flow(() => json({}), [
      (c) => c.method === "POST" && c.url.endsWith("/posts") && JSON.parse(c.body).dryRun ? json({ dryRun: true, canPublish: false, tiktok: [{ canPublish: false, reason: "TikTok direct posting is at capacity" }] }) : undefined,
    ]);
    const r = await zernio.publish(tt(), ctx);
    assert.equal(r.ok, false);
    assert.match(r.error!, /at capacity/);
    assert.equal(calls.filter((c) => c.url.endsWith("/posts")).length, 1);
  });

  it("canPostMore=false hoặc video quá dài thì dừng trước khi upload", async () => {
    const { ctx, calls } = flow(() => json({}), [], { ...INFO, creator: { nickname: "x", canPostMore: false } });
    assert.equal((await zernio.publish(tt(), ctx)).ok, false);
    assert.equal(calls.length, 1);
    const b = flow(() => json({}));
    const r = await zernio.publish({ ...tt(), durationSec: 900 }, b.ctx);
    assert.match(r.error!, /giới hạn 600s/);
    assert.equal(b.calls.length, 1);
  });

  it("207 thất bại, bản nháp và hết giờ chờ", async () => {
    const f = flow(() => json({ post: { _id: "p2", status: "failed", platforms: [{ platform: "tiktok", status: "failed", error: "privacy_level not allowed" }] }, platformResults: [{ platform: "tiktok", status: "failed", error: "privacy_level not allowed" }] }, 207));
    const r1 = await zernio.publish(tt(), f.ctx);
    assert.equal(r1.ok, false);
    assert.match(r1.error!, /privacy_level/);

    const d = flow(() => json({ post: { _id: "p3", platforms: [{ platform: "tiktok", status: "published", platformSpecificData: { isDraft: true } }] } }, 201));
    const r2 = await zernio.publish(tt({ draft: true }), d.ctx);
    assert.equal(r2.ok, true);
    assert.match(r2.note!, /bản nháp/);
    assert.equal(JSON.parse(d.calls[4].body).platforms[0].platformSpecificData.tiktokSettings.draft, true);

    const t = mockCtx({ ZERNIO_API_KEY: "z", ZERNIO_POLL_INTERVAL_MS: "10", ZERNIO_POLL_TIMEOUT_MS: "5", ZERNIO_TIKTOK_DRYRUN: "0" }, [
      (c) => c.url.includes("/creator-info") ? json(INFO) : undefined,
      (c) => c.url.endsWith("/media/presign") ? json({ uploadUrl: "https://up.example/x", publicUrl: "u" }) : undefined,
      (c) => c.url === "https://up.example/x" ? new Response(null, { status: 200 }) : undefined,
      (c) => c.url.endsWith("/posts") ? json({ post: { _id: "p4", platforms: [{ platform: "tiktok", status: "pending" }] } }, 201) : undefined,
    ]);
    const r3 = await zernio.publish(tt(), t.ctx);
    assert.equal(r3.ok, false);
    assert.match(r3.error!, /hết .* chờ/);
    assert.equal(t.calls.filter((c) => c.url.endsWith("/posts")).length, 1, "ZERNIO_TIKTOK_DRYRUN=0 bỏ bước dryRun");
  });

  it("xác nhận chỉ hợp lệ cho đúng bản render", () => {
    const render = { state: "done" as const, finishedAt: "A" };
    assert.equal(tiktokConsentValid({ render, tiktok: { privacyLevel: "SELF_ONLY", consentAt: "t", consentRender: "A" } }), true);
    assert.equal(tiktokConsentValid({ render: { ...render, finishedAt: "B" }, tiktok: { privacyLevel: "SELF_ONLY", consentAt: "t", consentRender: "A" } }), false);
    assert.equal(tiktokConsentValid({ render, tiktok: { privacyLevel: "SELF_ONLY", consentRender: "A" } }), false);
    assert.equal(tiktokConsentValid({ render }), false);
  });
});

describe("PUBLISH_DRY_RUN=1", () => {
  const SECRET = "SUPER-SECRET-VALUE-123";
  it("mô phỏng đúng adapter, in request, không gọi mạng, không lộ token", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { PUBLISH_DRY_RUN: "1", FB_PAGE_ID: "999", FB_PAGE_TOKEN: SECRET, IG_ACCESS_TOKEN: SECRET, ZERNIO_API_KEY: "" });
    const out: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { out.push(a.join(" ")); };
    try {
      for (const p of ["facebook", "instagram", "youtube", "tiktok"] as const) {
        const pub = pickPublisher(p, undefined, process.env);
        assert.ok(pub?.name.startsWith("dry-run:"), `${p}: ${pub?.name}`);
        const r = await pub!.publish(job({ platform: p }));
        assert.equal(r.ok, true, `${p}: ${r.error}`);
      }
      const z = pickPublisher("instagram", { platform: "instagram", handle: "", name: "", connected: false, via: "zernio" }, process.env);
      assert.equal(z?.name, "dry-run:zernio");
      assert.equal((await z!.publish(job({ platform: "instagram", accountId: "acc" }))).ok, true);
      const zt = pickPublisher("tiktok", { platform: "tiktok", handle: "", name: "", connected: false, via: "zernio" }, process.env);
      const rt = await zt!.publish(job({ platform: "tiktok", tiktok: { privacyLevel: "SELF_ONLY", consentValid: true } }));
      assert.equal(rt.ok, true, rt.error);
    } finally {
      console.log = orig;
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
    const log = out.join("\n");
    assert.doesNotMatch(log, new RegExp(SECRET));
    assert.match(log, /POST https:\/\/graph\.facebook\.com\/v26\.0\/999\/video_reels/);
    assert.match(log, /POST https:\/\/rupload\.facebook\.com\/video-upload\/v26\.0\/dry-fb-video/);
    assert.match(log, /is_ai_generated=true/);
    assert.match(log, /POST https:\/\/graph\.facebook\.com\/v26\.0\/<IG_USER_ID>\/media/);
    assert.match(log, /"is_ai_generated":true/);
    assert.match(log, /media_publish/);
    assert.match(log, /"containsSyntheticMedia":true/);
    assert.match(log, /"is_aigc":true/);
    assert.match(log, /"isAiGenerated":true/);
    assert.match(log, /<file .* bytes 0-5999 \(6000 B\)>/);
    assert.match(log, /GET https:\/\/zernio\.com\/api\/v1\/accounts\/%3CZERNIO_ACCOUNT_ID%3E\/tiktok\/creator-info/);
    assert.match(log, /"dryRun":true/);
    assert.match(log, /"privacy_level":"SELF_ONLY"/);
    assert.match(log, /"video_made_with_ai":true/);
  });

  it("pickReal không chọn adapter chưa cấu hình", () => {
    assert.equal(pickReal("instagram", undefined, {}), null);
    assert.equal(pickReal("instagram", undefined, IG_ENV)?.name, "instagram-reels");
    assert.equal(pickReal("facebook", undefined, FB_ENV)?.name, "facebook-reels");
  });
});
