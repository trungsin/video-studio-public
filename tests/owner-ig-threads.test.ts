/**
 * Chống kết nối/đăng nhầm profile (mẫu, chủ kết nối), Instagram trực tiếp qua Page token, Threads qua Zernio. Không gọi mạng thật.
 */
import "./channel-env";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { mergeZernioAccounts } from "../lib/channels";
import { checkInstagram } from "../lib/meta-check";
import { ytConnected, ytCredentialKey, ytEnvForProfile } from "../lib/youtube-credentials";
import { connectGuard, directOwner, guardPublish } from "../lib/owner";
import { instagram } from "../lib/publishers/instagram";
import { pickReal, publishTo } from "../lib/publishers/index";
import type { PublishCtx } from "../lib/publishers/types";
import { fitThreads, threadsTopicTag, zernio, zernioCtxForProfile, zernioPlatformData } from "../lib/publishers/zernio";
import { zernioEnvForProfile } from "../lib/zernio-connect";
import type { Channel } from "../lib/types";
import { YT_RECONNECT_MSG, YT_RECONNECT_MSG_PROD, ytReconnectMsg, ytTokenInfo } from "../lib/youtube-oauth";

const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
const realFetch = globalThis.fetch;
const saveEnv = { ...process.env };
let tmp = "", data = "", envFile = "", video = "";
const TOKEN = "EAAG-PAGE-TOKEN-SECRET";

function profileJson(slug: string, extra: Record<string, unknown> = {}) {
  return { slug, name: slug, initials: "X", updatedAt: "", sections: { info: [], voice: [], ttsNotes: [], colors: [], hashtags: [] }, channels: [], ...extra };
}
const readProfile = (slug: string) => JSON.parse(fs.readFileSync(path.join(data, "profiles", `${slug}.json`), "utf8"));

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-own-"));
  data = path.join(tmp, "data");
  envFile = path.join(tmp, "t.env");
  video = path.join(tmp, "v.mp4");
  fs.writeFileSync(video, Buffer.alloc(3000, 1));
  globalThis.fetch = (async () => { throw new Error("NETWORK BLOCKED IN TESTS"); }) as typeof fetch;
});
beforeEach(() => {
  fs.rmSync(data, { recursive: true, force: true });
  fs.mkdirSync(path.join(data, "profiles"), { recursive: true });
  fs.writeFileSync(path.join(data, "profiles", "kenh-lich-su.json"), JSON.stringify(profileJson("kenh-lich-su", {
    channels: [{ platform: "youtube", handle: "@kenhlichsu", name: "Kênh Lịch Sử", connected: true, via: "direct" }],
  })));
  fs.writeFileSync(path.join(data, "profiles", "mau-bep-nha-may.json"), JSON.stringify(profileJson("mau-bep-nha-may", {
    sample: true, channels: [{ platform: "youtube", handle: "@bep", name: "Bếp", connected: false, via: "direct" }],
  })));
  fs.writeFileSync(path.join(data, "profiles", "kenh-hai.json"), JSON.stringify(profileJson("kenh-hai")));
  fs.writeFileSync(envFile, "ADMIN_PASSWORD=p\nPUBLISH_DRY_RUN=1\n", { mode: 0o600 });
  for (const k of Object.keys(process.env)) if (/^(YT_|IG_|FB_|ZERNIO_|DIRECT_|TIKTOK_)/.test(k)) delete process.env[k];
  Object.assign(process.env, { DATA_DIR: data, ENV_FILE: envFile, PUBLISH_DRY_RUN: "1", ZERNIO_DEDICATED_PROFILES: "kenh-zernio-rieng" });
});
after(() => {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!(k in saveEnv)) delete process.env[k];
  Object.assign(process.env, saveEnv);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("owner guard", () => {
  const real = { slug: "kenh-lich-su" }, sample = { slug: "mau-bep-nha-may", sample: true }, other = { slug: "kenh-hai" };
  it("directOwner: biến riêng > DIRECT_PROFILE", () => {
    assert.equal(directOwner("youtube", { YT_PROFILE: "a", DIRECT_PROFILE: "b" }), "a");
    assert.equal(directOwner("facebook", { DIRECT_PROFILE: "b" }), "b");
    assert.equal(directOwner("threads", {}), undefined);
  });
  it("guardPublish: mẫu không đăng thật; mẫu không dùng kết nối trực tiếp kể cả dry-run; chỉ chủ mới đăng", () => {
    assert.match(guardPublish("facebook", sample, false, {})!, /mẫu/);
    assert.match(guardPublish("facebook", sample, true, { PUBLISH_DRY_RUN: "1" })!, /mẫu/);
    assert.equal(guardPublish("tiktok", sample, false, { PUBLISH_DRY_RUN: "1" }), null);
    assert.match(guardPublish("youtube", other, true, { YT_PROFILE: "kenh-lich-su" })!, /thuộc profile "kenh-lich-su"/);
    assert.equal(guardPublish("youtube", real, true, { YT_PROFILE: "kenh-lich-su", YT_REFRESH_TOKEN: "legacy" }), null);
    assert.equal(guardPublish("youtube", other, true, {
      YT_PROFILE: "kenh-lich-su", [ytCredentialKey(other.slug, "YT_REFRESH_TOKEN")]: "own",
    }), null);
    assert.equal(guardPublish("youtube", other, false, { YT_PROFILE: "kenh-lich-su" }), null); // qua Zernio: accountId riêng của profile
    assert.match(guardPublish("youtube", other, true, {}), /chưa kết nối/);
    assert.equal(guardPublish("facebook", other, true, {}), null); // chưa gán chủ
  });
  it("connectGuard: sample blocked, YouTube never requires moving another profile", () => {
    assert.deepEqual(connectGuard("youtube", sample, { hasToken: false }, {}), { ok: false, code: "sample" });
    assert.deepEqual(connectGuard("youtube", null, { hasToken: false }, {}), { ok: false, code: "no_profile" });
    assert.deepEqual(connectGuard("youtube", other, { hasToken: true }, { YT_PROFILE: "kenh-lich-su" }), { ok: true });
    assert.deepEqual(connectGuard("youtube", other, { hasToken: true, move: true }, { YT_PROFILE: "kenh-lich-su" }), { ok: true });
    assert.deepEqual(connectGuard("youtube", real, { hasToken: true }, { YT_PROFILE: "kenh-lich-su" }), { ok: true });
  });
  it("publishTo: profile mẫu bị chặn trước khi gọi adapter Facebook thật (dry-run)", async () => {
    Object.assign(process.env, { FB_PAGE_ID: "1366662163200803", FB_PAGE_TOKEN: TOKEN, DIRECT_PROFILE: "kenh-lich-su" });
    const { publishTo } = await import("../lib/publishers/index");
    const job = { videoPath: video, title: "t", caption: "c", platform: "facebook" as const, aiGenerated: true };
    const ch: Channel = { platform: "facebook", handle: "@x", name: "x", connected: true, via: "zernio" };
    const bad = await publishTo(job, ch, { slug: "mau-bep-nha-may", sample: true });
    assert.equal(bad.ok, false);
    assert.match(bad.error!, /mẫu/);
    const bad2 = await publishTo(job, { ...ch, via: "direct" }, { slug: "kenh-hai" });
    assert.match(bad2.error!, /thuộc profile "kenh-lich-su"/);
    const ok = await publishTo(job, { ...ch, via: "direct" }, { slug: "kenh-lich-su" });
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.via, "dry-run:facebook-reels");
  });
  it("publishTo live: profile có Page/IG riêng (__SLUG) đăng bằng Page, token, IG riêng dù kết nối chung thuộc profile khác", async () => {
    Object.assign(process.env, {
      FB_PAGE_ID: "GLOBAL-PAGE", FB_PAGE_TOKEN: "GLOBAL-TOKEN", IG_USER_ID: "GLOBAL-IG", FB_PROFILE: "kenh-lich-su", IG_PROFILE: "kenh-lich-su",
      FB_PAGE_ID__KENH_HAI: "OWN-PAGE", FB_PAGE_TOKEN__KENH_HAI: "OWN-TOKEN", IG_USER_ID__KENH_HAI: "OWN-IG",
    });
    const calls: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${String(u)} ${typeof init?.body === "string" ? init.body : ""} ${JSON.stringify(init?.headers ?? {})}`);
      return json({ error: { message: "stop" } }, 400);
    }) as typeof fetch;
    try {
      for (const platform of ["facebook", "instagram"] as const) {
        calls.length = 0;
        const r = await publishTo({ videoPath: video, title: "t", caption: "c", platform, aiGenerated: true },
          { platform, handle: "", name: "", connected: true, via: "direct" }, { slug: "kenh-hai" }, { live: true });
        assert.equal(r.ok, false);
        assert.doesNotMatch(r.error!, /thuộc profile/, platform);
        assert.ok(calls.length > 0, platform);
        assert.match(calls[0], platform === "facebook" ? /\/OWN-PAGE\// : /\/OWN-IG\//);
        assert.match(calls[0], /OWN-TOKEN/);
        assert.doesNotMatch(calls.join("\n"), /GLOBAL-(PAGE|TOKEN|IG)/);
      }
      // profile không có cấu hình riêng vẫn bị chặn khỏi Page chung của profile khác, không gọi mạng
      calls.length = 0;
      const blocked = await publishTo({ videoPath: video, title: "t", caption: "c", platform: "facebook", aiGenerated: true },
        { platform: "facebook", handle: "", name: "", connected: true, via: "direct" }, { slug: "mau-khac" }, { live: true });
      assert.match(blocked.error!, /thuộc profile "kenh-lich-su"/);
      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = (async () => { throw new Error("NETWORK BLOCKED IN TESTS"); }) as typeof fetch;
    }
  });
  it("Zernio: ZERNIO_API_KEY__<SLUG> chọn workspace riêng, không dùng ZERNIO_PROFILE_ID chung; profile khác giữ khoá chung", () => {
    const env = { ZERNIO_API_KEY: "global", ZERNIO_PROFILE_ID: "global-profile", ZERNIO_API_KEY__KENH_HAI: "own", ZERNIO_PROFILE_ID__KENH_HAI: "own-profile" };
    const own = zernioEnvForProfile("kenh-hai", env);
    assert.equal(own.ZERNIO_API_KEY, "own");
    assert.equal(own.ZERNIO_PROFILE_ID, "own-profile");
    assert.equal(zernioEnvForProfile("kenh-hai", { ...env, ZERNIO_PROFILE_ID__KENH_HAI: undefined }).ZERNIO_PROFILE_ID, undefined);
    assert.equal(zernioEnvForProfile("kenh-lich-su", env), env);
    assert.equal(zernioEnvForProfile("kenh-zernio-rieng", env).ZERNIO_API_KEY, undefined);
  });
});

describe("Zernio sync giữ kênh trực tiếp", () => {
  it("facebook do Meta trực tiếp không bị chuyển sang zernio", () => {
    const chans: Channel[] = [{ platform: "facebook", handle: "@s", name: "S", connected: false }];
    const n = mergeZernioAccounts(chans, [{ _id: "z1", platform: "facebook", username: "s" }, { _id: "z2", platform: "threads", username: "kenhlichsu" }], ["facebook"]);
    assert.equal(n, 1);
    assert.equal(chans[0].via, undefined);
    assert.equal(chans[0].accountId, undefined);
    assert.deepEqual(chans[1], { platform: "threads", handle: "@kenhlichsu", name: "", connected: true, via: "zernio", accountId: "z2" });
  });
});

describe("YouTube Production + chủ kết nối", () => {
  it("YT_OAUTH_TESTING=0: không có hạn 7 ngày, thông báo kết nối lại không nhắc Testing", () => {
    const i = ytTokenInfo({ YT_TOKEN_ISSUED_AT: "2026-10-01T00:00:00Z", YT_OAUTH_TESTING: "0" }, Date.parse("2026-12-01T00:00:00Z"));
    assert.equal(i.testing, false); assert.equal(i.expiresAt, undefined); assert.equal(i.expired, false);
    assert.equal(ytReconnectMsg({ YT_OAUTH_TESTING: "0" }), YT_RECONNECT_MSG_PROD);
    assert.equal(ytReconnectMsg({}), YT_RECONNECT_MSG);
    assert.doesNotMatch(YT_RECONNECT_MSG_PROD, /7 ngày/);
  });
  it("ytEnvForProfile: isolated slug encoding, exact legacy owner, fresh whitelisted ENV_FILE reads", () => {
    const a = "a-b", b = "a_b";
    assert.notEqual(ytCredentialKey(a, "YT_REFRESH_TOKEN"), ytCredentialKey(b, "YT_REFRESH_TOKEN"));
    assert.match(ytCredentialKey("nói-có-số", "YT_CHANNEL_ID"), /^YT_CHANNEL_ID_PROFILE_[0-9A-F]+$/);
    const env = {
      YT_PROFILE: "kenh-bien-tap", YT_REFRESH_TOKEN: "legacy", YT_TOKEN_CLIENT: "web",
      [ytCredentialKey(b, "YT_REFRESH_TOKEN")]: "second", [ytCredentialKey(b, "YT_TOKEN_CLIENT")]: "desktop",
    };
    assert.equal(ytEnvForProfile("kenh-bien-tap", env).YT_REFRESH_TOKEN, "legacy");
    assert.equal(ytEnvForProfile(a, env).YT_REFRESH_TOKEN, undefined);
    assert.equal(ytEnvForProfile(b, env).YT_REFRESH_TOKEN, "second");
    assert.equal(ytEnvForProfile(b, env).YT_TOKEN_CLIENT, "desktop");
    assert.equal(ytConnected(a, env), false);
    assert.equal(ytEnvForProfile(a, env)[ytCredentialKey(b, "YT_REFRESH_TOKEN")], undefined);
    fs.writeFileSync(envFile, `YT_PROFILE=kenh-bien-tap\nYT_REFRESH_TOKEN=legacy-file\n${ytCredentialKey(b, "YT_REFRESH_TOKEN")}=new-file\nUNRELATED=secret\n`);
    assert.equal(ytEnvForProfile(b, { ...env, ENV_FILE: envFile }).YT_REFRESH_TOKEN, "new-file");
    assert.equal(ytEnvForProfile("kenh-bien-tap", { ...env, ENV_FILE: envFile }).YT_REFRESH_TOKEN, "legacy-file");
    assert.equal(ytEnvForProfile(a, { ...env, ENV_FILE: envFile }).YT_REFRESH_TOKEN, undefined);
    assert.equal(ytEnvForProfile(b, { ...env, ENV_FILE: envFile }).UNRELATED, undefined);
    assert.equal(ytConnected("kenh-bien-tap", { ...env, ENV_FILE: `${envFile}.missing` }), false);
  });
  it("saveYtConnection: preserve legacy owner, reject channel reuse, never disconnect another profile", async () => {
    const { saveYtConnection } = await import("../lib/youtube-connect");
    fs.writeFileSync(envFile, "YT_PROFILE=kenh-lich-su\nYT_REFRESH_TOKEN=legacy-secret\nYT_CHANNEL_ID=UC1\nPUBLISH_DRY_RUN=1\n");
    Object.assign(process.env, { YT_PROFILE: "kenh-lich-su", YT_REFRESH_TOKEN: "legacy-secret", YT_CHANNEL_ID: "UC1" });
    assert.throws(() => saveYtConnection("mau-bep-nha-may", "desktop", "fake", { id: "UC2" }), /mẫu/);
    assert.throws(() => saveYtConnection("kenh-hai", "desktop", "fake", null), /chưa có kênh/);
    assert.throws(() => saveYtConnection("kenh-hai", "desktop", "fake", { id: "UC1" }), /kenh-lich-su/);
    assert.equal(fs.readFileSync(envFile, "utf8").includes("fake"), false);
    saveYtConnection("kenh-hai", "desktop", "second-secret", { id: "UC2", title: "Kênh Hai" });
    const stored = fs.readFileSync(envFile, "utf8");
    assert.match(stored, /^YT_PROFILE=kenh-lich-su$/m);
    assert.match(stored, /^YT_REFRESH_TOKEN=legacy-secret$/m);
    assert.match(stored, new RegExp(`^${ytCredentialKey("kenh-hai", "YT_REFRESH_TOKEN")}=second-secret$`, "m"));
    assert.match(stored, new RegExp(`^${ytCredentialKey("kenh-hai", "YT_CHANNEL_ID")}=UC2$`, "m"));
    assert.equal(process.env.YT_REFRESH_TOKEN, "legacy-secret");
    assert.equal(readProfile("kenh-hai").channels[0].connected, true);
    assert.equal(readProfile("kenh-lich-su").channels[0].connected, true);
    assert.throws(() => saveYtConnection("kenh-lich-su", "desktop", "third", { id: "UC2" }), /kenh-hai/);
    assert.equal(fs.readFileSync(envFile, "utf8"), stored);
    saveYtConnection("kenh-lich-su", "web", "renewed", { id: "UC1" });
    const renewed = fs.readFileSync(envFile, "utf8");
    assert.match(renewed, /^YT_REFRESH_TOKEN=legacy-secret$/m);
    assert.match(renewed, new RegExp(`^${ytCredentialKey("kenh-lich-su", "YT_REFRESH_TOKEN")}=renewed$`, "m"));
    assert.equal(ytEnvForProfile("kenh-lich-su").YT_REFRESH_TOKEN, "renewed");
  });
  it("desktop start: different profile may connect without moving legacy", async () => {
    Object.assign(process.env, { YT_DESKTOP_CLIENT_ID: "did", YT_DESKTOP_CLIENT_SECRET: "dsec", YT_REFRESH_TOKEN: "x", YT_PROFILE: "kenh-lich-su" });
    const { GET } = await import("../app/api/youtube/oauth/desktop/start/route");
    const req = (q: string) => new Request(`http://video-studio-box:3100/api/youtube/oauth/desktop/start?${q}`, { headers: { host: "video-studio-box:3100" } });
    assert.match((await GET(req("profile=mau-bep-nha-may"))).headers.get("location")!, /yt=sample/);
    assert.match((await GET(req(""))).headers.get("location")!, /yt=no_profile/);
    assert.equal(new URL((await GET(req("profile=kenh-hai"))).headers.get("location")!).hostname, "accounts.google.com");
    assert.equal(new URL((await GET(req("profile=kenh-lich-su"))).headers.get("location")!).hostname, "accounts.google.com");
  });
});

describe("Instagram trực tiếp", () => {
  const graph = (opts: { ig?: boolean; scopes?: string[] }) => (async (u: any, init: any) => {
    const url = String(u);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${TOKEN}`);
    if (url.includes("/debug_token")) return json({ data: { app_id: "2502541636901300", application: "Video Studio SKBT", type: "PAGE", is_valid: true, scopes: opts.scopes || [] } });
    if (url.includes("/1366662163200803?")) return json({ id: "1366662163200803", name: "Kênh Lịch Sử", ...(opts.ig ? { instagram_business_account: { id: "17841400000000001", username: "kenhlichsu", name: "Kênh Lịch Sử" } } : {}) });
    throw new Error(`unexpected ${url}`);
  }) as any;
  const ENV = { FB_PAGE_ID: "1366662163200803", FB_PAGE_TOKEN: TOKEN };
  it("checkInstagram: chưa liên kết + thiếu quyền (như hiện tại)", async () => {
    const c = await checkInstagram(graph({ scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"] }), ENV);
    assert.equal(c.ok, false);
    assert.equal(c.ig, undefined);
    assert.deepEqual(c.missing, ["instagram_basic", "instagram_content_publish"]);
    assert.doesNotMatch(JSON.stringify(c), /SECRET/);
  });
  it("checkInstagram: đã liên kết + đủ quyền", async () => {
    const c = await checkInstagram(graph({ ig: true, scopes: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"] }), ENV);
    assert.equal(c.ok, true);
    assert.equal(c.ig!.id, "17841400000000001");
  });
  it("publisher dùng FB_PAGE_TOKEN khi không có IG_ACCESS_TOKEN; chưa có IG_USER_ID thì chưa configured", async () => {
    assert.equal(instagram.configured({ FB_PAGE_TOKEN: TOKEN }), false);
    assert.equal(instagram.configured({ FB_PAGE_TOKEN: TOKEN, IG_USER_ID: "1784" }), true);
    let auth = "";
    const ctx: PublishCtx = { env: { FB_PAGE_TOKEN: TOKEN, IG_USER_ID: "1784" }, fetch: (async (_u: any, init: any) => { auth = new Headers(init.headers).get("authorization") || ""; return json({ error: { message: "stop" } }, 400); }) as any, sleep: async () => {}, log: () => {}, dryRun: false };
    const r = await instagram.publish({ videoPath: video, title: "t", caption: "c", platform: "instagram", aiGenerated: true }, ctx);
    assert.equal(r.ok, false);
    assert.equal(auth, `Bearer ${TOKEN}`);
    assert.doesNotMatch(r.error!, /SECRET/);
  });
  it("route /api/instagram/connect: ghi IG_USER_ID + IG_PROFILE (không ghi token), kênh instagram via=direct; mẫu bị chặn", async () => {
    Object.assign(process.env, ENV);
    globalThis.fetch = graph({ ig: true, scopes: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"] });
    const { POST } = await import("../app/api/instagram/connect/route");
    const req = (profile: string) => new Request("http://video-studio-box:3100/api/instagram/connect", { method: "POST", body: new URLSearchParams({ profile }), headers: { host: "video-studio-box:3100", origin: "http://video-studio-box:3100", "content-type": "application/x-www-form-urlencoded" } });
    assert.match((await POST(req("mau-bep-nha-may"))).headers.get("location")!, /ig=sample/);
    const r = await POST(req("kenh-lich-su"));
    assert.match(r.headers.get("location")!, /ig=ok/);
    const env = fs.readFileSync(envFile, "utf8");
    assert.match(env, /^IG_USER_ID=17841400000000001$/m);
    assert.match(env, /^IG_PROFILE=kenh-lich-su$/m);
    assert.doesNotMatch(env, /SECRET/);
    const ig = readProfile("kenh-lich-su").channels.find((c: Channel) => c.platform === "instagram");
    assert.deepEqual(ig, { platform: "instagram", handle: "@kenhlichsu", name: "Kênh Lịch Sử", connected: true, via: "direct" });
    globalThis.fetch = (async () => { throw new Error("NETWORK BLOCKED IN TESTS"); }) as typeof fetch;
  });
});

describe("Threads qua Zernio", () => {
  it("fitThreads: ≤500 ký tự, bỏ hashtag trước, giữ dòng AI", () => {
    const ai = "Nội dung minh họa có sử dụng AI.";
    const short = `Ngắn\n\n${ai}\n\n#SuKy #LichSu`;
    assert.equal(fitThreads(short), short);
    const mid = `${"a ".repeat(230)}\n\n${ai}\n\n${"#tag ".repeat(20)}`;
    const m = fitThreads(mid);
    assert.ok([...m].length <= 500);
    assert.ok(m.endsWith(ai));
    assert.doesNotMatch(m, /#tag/);
    const long = `${"chữ ".repeat(300)}\n\n${ai}\n\n#SuKy`;
    const l = fitThreads(long);
    assert.ok([...l].length <= 500, String([...l].length));
    assert.ok(l.endsWith(ai));
    assert.match(l, /…\n\n/);
  });
  it("topic_tag từ hashtag đầu, bỏ . và &", () => {
    assert.equal(threadsTopicTag("abc #Sử.Ký&Bỏ #x"), "SửKýBỏ");
    assert.equal(threadsTopicTag("không tag"), undefined);
    assert.deepEqual(zernioPlatformData({ platform: "threads", caption: "x #LichSu", title: "t", videoPath: "", aiGenerated: true }), { topic_tag: "LichSu" });
  });
  it("zernio.publish threads: content đã cắt ≤500 + topic_tag + accountId", async () => {
    const posts: any[] = [];
    const f = (async (u: any, init: any) => {
      const url = String(u);
      if (url.endsWith("/media/presign")) return json({ uploadUrl: "https://up.example/put", publicUrl: "https://cdn.example/v.mp4" });
      if (url === "https://up.example/put") return new Response(null, { status: 200 });
      if (url.endsWith("/posts")) { posts.push(JSON.parse(init.body)); return json({ post: { _id: "p1", platforms: [{ platform: "threads", status: "published", platformPostUrl: "https://www.threads.net/@kenhlichsu/post/1" }] } }); }
      throw new Error(`unexpected ${url}`);
    }) as any;
    const ctx: PublishCtx = { env: { ZERNIO_API_KEY: "zk" }, fetch: f, sleep: async () => {}, log: () => {}, dryRun: false };
    const r = await zernio.publish({ videoPath: video, title: "t", caption: `${"chữ ".repeat(300)}\n\n#SuKyBoTui`, platform: "threads", accountId: "th1", aiGenerated: true }, ctx);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.url, "https://www.threads.net/@kenhlichsu/post/1");
    assert.ok([...posts[0].content].length <= 500);
    assert.deepEqual(posts[0].platforms[0], { platform: "threads", accountId: "th1", platformSpecificData: { topic_tag: "SuKyBoTui" } });
  });
  it("route connect: mẫu bị chặn; profile thật -> authUrl Zernio + cookie nonce; callback kiểm nonce + accountId", async () => {
    process.env.ZERNIO_API_KEY = "zk";
    let redirectUrl = "";
    globalThis.fetch = (async (u: any) => {
      const url = new URL(String(u));
      if (url.pathname.endsWith("/profiles")) return json({ profiles: [{ _id: "zp1", isDefault: true }] });
      if (url.pathname.endsWith("/connect/threads")) { redirectUrl = url.searchParams.get("redirect_url")!; assert.equal(url.searchParams.get("profileId"), "zp1"); return json({ authUrl: "https://threads.net/oauth/authorize?x=1", state: "s" }); }
      if (url.pathname.endsWith("/accounts")) return json({ accounts: [{ _id: "th1", platform: "threads", username: "kenhlichsu", displayName: "Kênh Lịch Sử", isActive: true }] });
      throw new Error(`unexpected ${url}`);
    }) as any;
    const start = (await import("../app/api/zernio/connect/route")).GET;
    const cb = (await import("../app/api/zernio/connect/callback/route")).GET;
    const H = { host: "video-studio-box:3100" };
    assert.match((await start(new Request("http://video-studio-box:3100/api/zernio/connect?platform=threads&profile=mau-bep-nha-may", { headers: H }))).headers.get("location")!, /zc=error/);
    assert.match((await start(new Request("http://video-studio-box:3100/api/zernio/connect?platform=facebook&profile=kenh-lich-su", { headers: H }))).headers.get("location")!, /zc=error/);
    const r = await start(new Request("http://video-studio-box:3100/api/zernio/connect?platform=threads&profile=kenh-lich-su", { headers: H }));
    assert.equal(r.headers.get("location"), "https://threads.net/oauth/authorize?x=1");
    assert.match(redirectUrl, /^http:\/\/video-studio-box:3100\/api\/zernio\/connect\/callback\?profile=kenh-lich-su&platform=threads&n=[a-f0-9]{48}$/);
    const cookie = decodeURIComponent(r.headers.get("set-cookie")!.match(/vs_zc=([^;]+)/)![1]);
    const back = (q: string, ck?: string) => cb(new Request(`${redirectUrl}&${q}`, { headers: { ...H, ...(ck ? { cookie: `vs_zc=${ck}` } : {}) } }));
    assert.match((await back("connected=threads&accountId=th1")).headers.get("location")!, /zc=error/); // thiếu cookie
    assert.match((await back("connected=threads&accountId=khac", cookie)).headers.get("location")!, /zc=error/);
    const ok = await back("connected=threads&accountId=th1&username=kenhlichsu", cookie);
    assert.match(ok.headers.get("location")!, /zc=ok&platform=threads/);
    const th = readProfile("kenh-lich-su").channels.find((c: Channel) => c.platform === "threads");
    assert.deepEqual(th, { platform: "threads", handle: "@kenhlichsu", name: "Kênh Lịch Sử", connected: true, via: "zernio", accountId: "th1" });
    globalThis.fetch = (async () => { throw new Error("NETWORK BLOCKED IN TESTS"); }) as typeof fetch;
  });
});

describe("Kênh Zernio Riêng Zernio key isolation", () => {
  const globalKey = "fake-global-key", dedicatedKey = "fake-tree-key";
  const channel: Channel = { platform: "threads", handle: "@cay", name: "Cây", connected: true, via: "zernio", accountId: "tree-1" };

  it("routes only Kênh Zernio Riêng to its dedicated key; missing key never uses global, including dry-run", async () => {
    const env = { ZERNIO_API_KEY: globalKey, ZERNIO_API_KEY_KENH_ZERNIO_RIENG: dedicatedKey };
    assert.equal(zernioEnvForProfile("kenh-zernio-rieng", env).ZERNIO_API_KEY, dedicatedKey);
    assert.equal(zernioEnvForProfile("kenh-hai", env).ZERNIO_API_KEY, globalKey);
    assert.equal(zernioCtxForProfile("kenh-zernio-rieng", { env, fetch: globalThis.fetch, sleep: async () => {}, log: () => {}, dryRun: false }).env.ZERNIO_API_KEY, dedicatedKey);
    assert.equal(pickReal("threads", channel, env, "kenh-zernio-rieng")?.name, "zernio");
    assert.equal(pickReal("threads", channel, { ZERNIO_API_KEY: globalKey }, "kenh-zernio-rieng"), null);
    assert.equal(pickReal("threads", channel, { ZERNIO_API_KEY: globalKey }, "kenh-hai")?.name, "zernio");
    process.env.ZERNIO_API_KEY = globalKey;
    delete process.env.ZERNIO_API_KEY_KENH_ZERNIO_RIENG;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; throw new Error("network must not be called"); }) as typeof fetch;
    const job = { videoPath: video, title: "t", caption: "c", platform: "threads" as const };
    const dry = await publishTo(job, channel, { slug: "kenh-zernio-rieng" });
    const live = await publishTo(job, channel, { slug: "kenh-zernio-rieng" }, { live: true });
    assert.equal(dry.ok, false);
    assert.equal(live.ok, false);
    assert.match(dry.error!, /ZERNIO_API_KEY_KENH_ZERNIO_RIENG/);
    assert.match(live.error!, /ZERNIO_API_KEY_KENH_ZERNIO_RIENG/);
    assert.equal(calls, 0);
  });

  it("publishes with the dedicated key; another profile retains the global key", async () => {
    Object.assign(process.env, { ZERNIO_API_KEY: globalKey, ZERNIO_API_KEY_KENH_ZERNIO_RIENG: dedicatedKey });
    const headers: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u);
      if (url === "https://up.example/tree.mp4") return new Response(null, { status: 200 });
      headers.push(new Headers(init?.headers).get("authorization") || "");
      if (url.endsWith("/media/presign")) return json({ uploadUrl: "https://up.example/tree.mp4", publicUrl: "https://cdn.example/tree.mp4" });
      if (url.endsWith("/posts")) return json({ post: { _id: "post-1", platforms: [{ status: "published", platformPostUrl: "https://threads.net/post/1" }] } });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const job = { videoPath: video, title: "t", caption: "c", platform: "threads" as const };
    assert.equal((await publishTo(job, channel, { slug: "kenh-zernio-rieng" }, { live: true })).ok, true);
    assert.deepEqual(headers.splice(0), [`Bearer ${dedicatedKey}`, `Bearer ${dedicatedKey}`]);
    assert.equal((await publishTo(job, channel, { slug: "kenh-hai" }, { live: true })).ok, true);
    assert.deepEqual(headers, [`Bearer ${globalKey}`, `Bearer ${globalKey}`]);
  });

  it("uses the dedicated key for TikTok creator info, presign, dryRun and publish", async () => {
    Object.assign(process.env, { ZERNIO_API_KEY: globalKey, ZERNIO_API_KEY_KENH_ZERNIO_RIENG: dedicatedKey });
    const requests: { auth: string; path: string; body: string }[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u);
      if (url === "https://up.example/tree.mp4") return new Response(null, { status: 200 });
      requests.push({ auth: new Headers(init?.headers).get("authorization") || "", path: new URL(url).pathname, body: String(init?.body || "") });
      if (url.includes("/creator-info")) return json({ creator: { nickname: "cay", canPostMore: true }, privacyLevels: [{ value: "PUBLIC_TO_EVERYONE" }] });
      if (url.endsWith("/media/presign")) return json({ uploadUrl: "https://up.example/tree.mp4", publicUrl: "https://cdn.example/tree.mp4" });
      if (url.endsWith("/posts") && String(init?.body).includes('"dryRun":true')) return json({ dryRun: true, canPublish: true });
      if (url.endsWith("/posts")) return json({ post: { _id: "tree-post", platforms: [{ status: "published", platformPostUrl: "https://tiktok.example/tree" }] } });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const tt: Channel = { ...channel, platform: "tiktok", accountId: "tree-tt" };
    const result = await publishTo({ videoPath: video, title: "t", caption: "c", platform: "tiktok", tiktok: {
      privacyLevel: "PUBLIC_TO_EVERYONE", consentValid: true, consentAt: "2026-10-24T00:00:00Z",
    } }, tt, { slug: "kenh-zernio-rieng" }, { live: true });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(requests.map((r) => r.path), [
      "/api/v1/accounts/tree-tt/tiktok/creator-info", "/api/v1/media/presign", "/api/v1/posts", "/api/v1/posts",
    ]);
    assert.ok(requests[2].body.includes('"dryRun":true'));
    assert.ok(requests.every((r) => r.auth === `Bearer ${dedicatedKey}`));
  });

  it("sync, connect/callback and TikTok creator info never query the global workspace", async () => {
    Object.assign(process.env, { ZERNIO_API_KEY: globalKey, ZERNIO_API_KEY_KENH_ZERNIO_RIENG: dedicatedKey });
    fs.writeFileSync(path.join(data, "profiles", "kenh-zernio-rieng.json"), JSON.stringify(profileJson("kenh-zernio-rieng", {
      channels: [{ platform: "tiktok", handle: "", name: "", connected: false }],
    })));
    const calls: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(u));
      calls.push(new Headers(init?.headers).get("authorization") || "");
      if (url.pathname.endsWith("/accounts")) return json({ accounts: [{ _id: "tree-tt", platform: "tiktok", username: "cay", isActive: true }] });
      if (url.pathname.endsWith("/profiles")) return json({ profiles: [{ _id: "tree-profile", isDefault: true }] });
      if (url.pathname.endsWith("/connect/tiktok")) return json({ authUrl: "https://tiktok.example/oauth" });
      if (url.pathname.includes("/creator-info")) return json({ creator: { nickname: "cay" } });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    // Routes are loaded after beforeEach sets DATA_DIR; lib/data captures it at module initialization.
    const sync = (await import("../app/api/profiles/[slug]/sync-channels/route")).POST;
    const start = (await import("../app/api/zernio/connect/route")).GET;
    const callback = (await import("../app/api/zernio/connect/callback/route")).GET;
    const creator = (await import("../app/api/videos/[id]/tiktok/route")).GET;
    const p = { params: Promise.resolve({ slug: "kenh-zernio-rieng" }) };
    assert.equal((await sync(new Request("http://localhost/sync"), p)).status, 200);
    assert.equal(readProfile("kenh-zernio-rieng").channels[0].accountId, "tree-tt");
    const connected = await start(new Request("http://localhost/api/zernio/connect?platform=tiktok&profile=kenh-zernio-rieng"));
    assert.equal(connected.headers.get("location"), "https://tiktok.example/oauth");
    const cookie = decodeURIComponent(connected.headers.get("set-cookie")!.match(/vs_zc=([^;]+)/)![1]);
    const nonce = cookie.split(".")[0];
    const cb = await callback(new Request(`http://localhost/api/zernio/connect/callback?profile=kenh-zernio-rieng&platform=tiktok&n=${nonce}&accountId=tree-tt`, { headers: { cookie: `vs_zc=${cookie}` } }));
    assert.match(cb.headers.get("location")!, /zc=ok/);
    fs.mkdirSync(path.join(data, "videos"), { recursive: true });
    fs.writeFileSync(path.join(data, "videos", "tree-video.json"), JSON.stringify({ id: "tree-video", profile: "kenh-zernio-rieng", render: { state: "done" } }));
    const info = await creator(new Request("http://localhost/api/videos/tree-video/tiktok"), { params: Promise.resolve({ id: "tree-video" }) });
    assert.equal((await info.json()).info.creator.nickname, "cay");
    assert.deepEqual(calls, Array(calls.length).fill(`Bearer ${dedicatedKey}`));
    assert.ok(calls.length >= 5);
    delete process.env.ZERNIO_API_KEY_KENH_ZERNIO_RIENG;
    calls.length = 0;
    assert.equal((await sync(new Request("http://localhost/sync"), p)).status, 400);
    assert.match((await start(new Request("http://localhost/api/zernio/connect?platform=tiktok&profile=kenh-zernio-rieng"))).headers.get("location")!, /zc=error/);
    assert.equal((await creator(new Request("http://localhost/api/videos/tree-video/tiktok"), { params: Promise.resolve({ id: "tree-video" }) })).status, 400);
    assert.equal(calls.length, 0);
  });
});
