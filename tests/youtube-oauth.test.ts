/**
 * Test luồng "Kết nối YouTube" (OAuth) và các helper liên quan — không gọi mạng thật.  Chạy: npm test
 */
import "./channel-env";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { safeNext } from "../lib/auth";
import { mergeZernioAccounts } from "../lib/channels";
import { upsertEnv } from "../lib/envfile";
import { ytCredentialKey } from "../lib/youtube-credentials";
import type { Channel } from "../lib/types";
import {
  buildAuthUrl, exchangeCode, fetchMyChannel, newState, packState, redirectUriFor, requestOrigin, sameHost,
  unpackState, validRedirectUri, YT_CALLBACK_PATH, YT_STATE_COOKIE,
} from "../lib/youtube-oauth";

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const HTTPS = "https://video-studio-box.tail6db48b.ts.net";
const realFetch = globalThis.fetch;
const saveEnv = { ...process.env };
let tmp = "";

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-yt-"));
  globalThis.fetch = (async () => { throw new Error("NETWORK BLOCKED IN TESTS"); }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!(k in saveEnv)) delete process.env[k];
  Object.assign(process.env, saveEnv);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("redirect URI", () => {
  it("chỉ nhận https (không phải IP) hoặc http://localhost", () => {
    assert.equal(validRedirectUri(`${HTTPS}${YT_CALLBACK_PATH}`), true);
    assert.equal(validRedirectUri("http://localhost:3100/cb"), true);
    assert.equal(validRedirectUri("http://127.0.0.1:3100/cb"), true);
    assert.equal(validRedirectUri("http://video-studio-box:3100/cb"), false);
    assert.equal(validRedirectUri("https://100.112.159.74/cb"), false);
    assert.equal(validRedirectUri("https://x.ts.net/cb#frag"), false);
    assert.equal(validRedirectUri("javascript:alert(1)"), false);
  });
  it("YT_REDIRECT_URI ưu tiên hơn origin; origin http tailnet bị từ chối", () => {
    assert.equal(redirectUriFor("http://video-studio-box:3100", {}), null);
    assert.equal(redirectUriFor(HTTPS, {}), `${HTTPS}${YT_CALLBACK_PATH}`);
    assert.equal(redirectUriFor("http://video-studio-box:3100", { YT_REDIRECT_URI: `${HTTPS}${YT_CALLBACK_PATH}` }), `${HTTPS}${YT_CALLBACK_PATH}`);
    assert.equal(redirectUriFor(HTTPS, { YT_REDIRECT_URI: "http://evil:80/x" }), null);
  });
  it("requestOrigin đọc X-Forwarded-*; sameHost so host:port", () => {
    assert.equal(requestOrigin(new Headers({ host: "video-studio-box:3100" })), "http://video-studio-box:3100");
    assert.equal(requestOrigin(new Headers({ host: "127.0.0.1:3100", "x-forwarded-host": "video-studio-box.tail6db48b.ts.net", "x-forwarded-proto": "https" })), HTTPS);
    assert.equal(requestOrigin(new Headers({ host: "video-studio-box.tail6db48b.ts.net" })), HTTPS); // tailscale serve https không gửi proto
    assert.equal(requestOrigin(new Headers({ host: "localhost:3100" })), "http://localhost:3100");
    assert.equal(sameHost("http://video-studio-box.tail6db48b.ts.net", `${HTTPS}/cb`), true); // proxy không gửi proto vẫn coi là cùng máy
    assert.equal(sameHost("http://video-studio-box:3100", `${HTTPS}/cb`), false);
  });
});

describe("auth URL + state", () => {
  it("có offline, consent, 2 scope, state", () => {
    const u = new URL(buildAuthUrl("cid.apps.googleusercontent.com", `${HTTPS}${YT_CALLBACK_PATH}`, "s1"));
    assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    const q = u.searchParams;
    assert.equal(q.get("access_type"), "offline");
    assert.equal(q.get("prompt"), "consent");
    assert.equal(q.get("response_type"), "code");
    assert.equal(q.get("state"), "s1");
    assert.deepEqual(q.get("scope")!.split(" "), ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"]);
    assert.equal(q.get("redirect_uri"), `${HTTPS}${YT_CALLBACK_PATH}`);
  });
  it("pack/unpack state, chặn slug lạ", () => {
    const s = newState();
    assert.match(s, /^[a-f0-9]{48}$/);
    assert.deepEqual(unpackState(packState(s, "kenh-lich-su")), { state: s, slug: "kenh-lich-su" });
    assert.equal(unpackState(`${s}.../etc`), null);
    assert.equal(unpackState("abc.su"), null);
    assert.equal(unpackState(undefined), null);
  });
});

describe("đổi code / đọc kênh", () => {
  const env = { YT_CLIENT_ID: "cid", YT_CLIENT_SECRET: "csecret" };
  it("thành công: gửi đúng form, trả refresh token", async () => {
    let body = "";
    const f = (async (_u: any, init: any) => { body = String(init.body); return json({ access_token: "at", refresh_token: "rt", scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly" }); }) as typeof fetch;
    const r = await exchangeCode(f, env, "CODE", `${HTTPS}${YT_CALLBACK_PATH}`);
    assert.equal(r.refreshToken, "rt");
    const q = new URLSearchParams(body);
    assert.equal(q.get("grant_type"), "authorization_code");
    assert.equal(q.get("code"), "CODE");
    assert.equal(q.get("redirect_uri"), `${HTTPS}${YT_CALLBACK_PATH}`);
  });
  it("thiếu refresh token / thiếu scope upload / lỗi Google -> ném lỗi không chứa token", async () => {
    await assert.rejects(exchangeCode((async () => json({ access_token: "at", scope: "youtube.upload" })) as any, env, "c", "u"), /refresh token/);
    await assert.rejects(exchangeCode((async () => json({ access_token: "at-secret", refresh_token: "rt-secret", scope: "youtube.readonly" })) as any, env, "c", "u"), (e: Error) => /youtube\.upload/.test(e.message) && !/secret/.test(e.message));
    await assert.rejects(exchangeCode((async () => json({ error: "invalid_grant", error_description: "Bad Request" }, 400)) as any, env, "c", "u"), /Bad Request/);
  });
  it("fetchMyChannel: có kênh / chưa có kênh", async () => {
    const ch = await fetchMyChannel((async () => json({ items: [{ id: "UC1", snippet: { title: "Kênh Lịch Sử", customUrl: "@kenhlichsu" } }] })) as any, "at");
    assert.deepEqual(ch, { id: "UC1", title: "Kênh Lịch Sử", customUrl: "@kenhlichsu" });
    assert.equal(await fetchMyChannel((async () => json({ items: [] })) as any, "at"), null);
    assert.equal(await fetchMyChannel((async () => json({ items: [{ snippet: { title: "No id" } }] })) as typeof fetch, "at"), null);
  });
});

describe("upsertEnv", () => {
  it("giữ dòng khác, thay khoá cũ, bỏ trùng, thêm khoá mới, .bak + chmod 600", () => {
    const f = path.join(tmp, ".env");
    fs.writeFileSync(f, "# c\nA=1\nYT_REFRESH_TOKEN=old\nB=two words\nYT_REFRESH_TOKEN=dup\n", { mode: 0o644 });
    upsertEnv(f, { YT_REFRESH_TOKEN: "1//0abc-_X", NEW_KEY: "has space" });
    assert.equal(fs.readFileSync(f, "utf8"), '# c\nA=1\nYT_REFRESH_TOKEN=1//0abc-_X\nB=two words\nNEW_KEY="has space"\n');
    assert.equal(fs.readFileSync(`${f}.bak`, "utf8"), "# c\nA=1\nYT_REFRESH_TOKEN=old\nB=two words\nYT_REFRESH_TOKEN=dup\n");
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    assert.equal(fs.statSync(`${f}.bak`).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(tmp).filter((x) => x.endsWith(".tmp")), []);
  });
  it("chặn xuống dòng và tên biến lạ", () => {
    const f = path.join(tmp, ".env2");
    assert.throws(() => upsertEnv(f, { A: "x\nB=y" }), /xuống dòng/);
    assert.throws(() => upsertEnv(f, { "a-b": "x" }), /không hợp lệ/);
  });
});

describe("đồng bộ kênh Zernio", () => {
  it("kênh via=direct giữ nguyên, kênh khác nhận accountId Zernio", () => {
    const chs: Channel[] = [
      { platform: "youtube", handle: "@kenhlichsu", name: "Kênh Lịch Sử", connected: true, via: "direct" },
      { platform: "tiktok", handle: "", name: "", connected: false, via: "zernio" },
    ];
    const n = mergeZernioAccounts(chs, [
      { _id: "yt1", platform: "youtube", username: "other", isActive: true },
      { _id: "tt1", platform: "tiktok", username: "kenhlichsu", displayName: "kenhlichsu", isActive: true },
      { _id: "th1", platform: "threads", username: "kenhlichsu" },
    ]);
    assert.equal(n, 2);
    assert.deepEqual(chs[0], { platform: "youtube", handle: "@kenhlichsu", name: "Kênh Lịch Sử", connected: true, via: "direct" });
    assert.equal(chs[1].accountId, "tt1");
    assert.equal(chs[2].platform, "threads");
    assert.equal(chs[2].via, "zernio");
  });
});

describe("safeNext (login ?next=)", () => {
  it("chỉ cho đường dẫn nội bộ", () => {
    assert.equal(safeNext("/api/youtube/oauth/start?profile=kenh-lich-su"), "/api/youtube/oauth/start?profile=kenh-lich-su");
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "", "/login?x", "/a b"]) assert.equal(safeNext(bad), "/");
  });
});

describe("route callback (fetch giả, DATA_DIR + ENV_FILE tạm)", () => {
  async function setup() {
    const data = path.join(tmp, "data");
    fs.mkdirSync(path.join(data, "profiles"), { recursive: true });
    fs.writeFileSync(path.join(data, "profiles", "kenh-lich-su.json"), JSON.stringify({
      slug: "kenh-lich-su", name: "Kênh Lịch Sử", updatedAt: "", sections: { info: [], voice: [], ttsNotes: [], colors: [], hashtags: [] },
      channels: [{ platform: "youtube", handle: "@x", name: "x", connected: false, via: "direct" }],
    }));
    const envFile = path.join(tmp, "cb.env");
    fs.writeFileSync(envFile, "ADMIN_PASSWORD=p\nYT_PRIVACY=private\n", { mode: 0o600 });
    Object.assign(process.env, { DATA_DIR: data, ENV_FILE: envFile, YT_CLIENT_ID: "cid", YT_CLIENT_SECRET: "cs", YT_REDIRECT_URI: `${HTTPS}${YT_CALLBACK_PATH}` });
    for (const k of Object.keys(process.env)) if (/^YT_(?:REFRESH_TOKEN|TOKEN_CLIENT|TOKEN_ISSUED_AT|CHANNEL_ID)(?:_PROFILE_.*)?$|^YT_PROFILE$/.test(k)) delete process.env[k];
    const mod = await import("../app/api/youtube/oauth/callback/route");
    return { data, envFile, GET: mod.GET };
  }
  const req = (q: string, cookie?: string) => new Request(`http://127.0.0.1:3100${YT_CALLBACK_PATH}?${q}`, { headers: { host: "video-studio-box.tail6db48b.ts.net", "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}) } });
  it("start: profile mới không cần chuyển token của owner hiện tại", async () => {
    const { data, envFile } = await setup();
    fs.writeFileSync(path.join(data, "profiles", "other.json"), JSON.stringify({
      slug: "other", name: "Other", updatedAt: "", sections: { info: [], voice: [], ttsNotes: [], colors: [], hashtags: [] }, channels: [],
    }));
    fs.writeFileSync(envFile, "YT_PROFILE=kenh-lich-su\nYT_REFRESH_TOKEN=legacy\nYT_CHANNEL_ID=UC1\n");
    Object.assign(process.env, { YT_PROFILE: "kenh-lich-su", YT_REFRESH_TOKEN: "legacy" });
    const { GET: start } = await import("../app/api/youtube/oauth/start/route");
    const r = await start(new Request(`${HTTPS}/api/youtube/oauth/start?profile=other`, { headers: { host: new URL(HTTPS).host } }));
    assert.equal(new URL(r.headers.get("location")!).hostname, "accounts.google.com");
    assert.match(fs.readFileSync(envFile, "utf8"), /^YT_REFRESH_TOKEN=legacy$/m);
  });

  it("state sai -> không đổi code, không ghi .env", async () => {
    const { envFile, GET } = await setup();
    let called = false;
    globalThis.fetch = (async () => { called = true; return json({}); }) as any;
    const s = newState();
    const r = await GET(req(`code=c&state=${newState()}`, `${YT_STATE_COOKIE}=${packState(s, "kenh-lich-su")}`));
    assert.equal(r.status, 303);
    assert.match(r.headers.get("location")!, /^\/profile\?yt=error/);
    assert.equal(called, false);
    assert.doesNotMatch(fs.readFileSync(envFile, "utf8"), /YT_REFRESH_TOKEN/);
  });

  it("thành công -> ghi token riêng profile (600), cập nhật kênh direct, không lộ token trong Location", async () => {
    const { data, envFile, GET } = await setup();
    globalThis.fetch = (async (u: any) => {
      const url = String(u);
      if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "AT-SECRET", refresh_token: "1//RT-SECRET", scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly" });
      if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) return json({ items: [{ id: "UC1", snippet: { title: "Kênh Lịch Sử", customUrl: "@kenhlichsu" } }] });
      throw new Error(`unexpected ${url}`);
    }) as any;
    const s = newState();
    const r = await GET(req(`code=c&state=${s}`, `${YT_STATE_COOKIE}=${packState(s, "kenh-lich-su")}`));
    const loc = r.headers.get("location")!;
    assert.match(loc, /^\/profile\?yt=ok/);
    assert.doesNotMatch(loc, /SECRET/);
    assert.match(fs.readFileSync(envFile, "utf8"), new RegExp(`^${ytCredentialKey("kenh-lich-su", "YT_REFRESH_TOKEN")}=1//RT-SECRET$`, "m"));
    assert.match(fs.readFileSync(envFile, "utf8"), /^YT_PRIVACY=private$/m);
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
    assert.equal(process.env[ytCredentialKey("kenh-lich-su", "YT_REFRESH_TOKEN")], "1//RT-SECRET");
    const p = JSON.parse(fs.readFileSync(path.join(data, "profiles", "kenh-lich-su.json"), "utf8"));
    assert.deepEqual(p.channels[0], { platform: "youtube", handle: "@kenhlichsu", name: "Kênh Lịch Sử", connected: true, via: "direct" });
    assert.match(r.headers.get("set-cookie") || "", new RegExp(`${YT_STATE_COOKIE}=;`));
  });
  it("lookup lỗi hoặc kênh thiếu ID -> không ghi refresh token", async () => {
    const { envFile, GET } = await setup();
    for (const response of [json({ error: { message: "permission denied" } }, 403), json({ items: [{ snippet: { title: "Unknown" } }] })]) {
      globalThis.fetch = (async (u: RequestInfo | URL) => String(u).startsWith("https://oauth2")
        ? json({ access_token: "at", refresh_token: "fake", scope: "youtube.upload" })
        : response) as typeof fetch;
      const s = newState();
      const r = await GET(req(`code=c&state=${s}`, `${YT_STATE_COOKIE}=${packState(s, "kenh-lich-su")}`));
      assert.match(r.headers.get("location")!, /yt=error/);
      assert.doesNotMatch(fs.readFileSync(envFile, "utf8"), /YT_REFRESH_TOKEN/);
    }
  });
  it("callback: duplicate channel leaves first profile token unchanged", async () => {
    const { data, envFile, GET } = await setup();
    fs.writeFileSync(path.join(data, "profiles", "other.json"), JSON.stringify({
      slug: "other", name: "Other", updatedAt: "", sections: { info: [], voice: [], ttsNotes: [], colors: [], hashtags: [] }, channels: [],
    }));
    fs.writeFileSync(envFile, "YT_PROFILE=kenh-lich-su\nYT_REFRESH_TOKEN=legacy\nYT_CHANNEL_ID=UC1\n");
    Object.assign(process.env, { YT_PROFILE: "kenh-lich-su", YT_REFRESH_TOKEN: "legacy", YT_CHANNEL_ID: "UC1" });
    globalThis.fetch = (async (u: RequestInfo | URL) => String(u).startsWith("https://oauth2")
      ? json({ access_token: "at", refresh_token: "new-secret", scope: "youtube.upload" })
      : json({ items: [{ id: "UC1", snippet: { title: "Duplicate" } }] })) as typeof fetch;
    const s = newState();
    const r = await GET(req(`code=c&state=${s}`, `${YT_STATE_COOKIE}=${packState(s, "other")}`));
    assert.match(r.headers.get("location")!, /yt=error/);
    assert.match(fs.readFileSync(envFile, "utf8"), /^YT_REFRESH_TOKEN=legacy$/m);
    assert.doesNotMatch(fs.readFileSync(envFile, "utf8"), /new-secret/);
  });

  it("người dùng huỷ -> yt=denied", async () => {
    const { GET } = await setup();
    const s = newState();
    const r = await GET(req(`error=access_denied&state=${s}`, `${YT_STATE_COOKIE}=${packState(s, "kenh-lich-su")}`));
    assert.match(r.headers.get("location")!, /yt=denied/);
  });
});
