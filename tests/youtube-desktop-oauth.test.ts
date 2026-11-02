/**
 * Test luồng YouTube "Desktop app" + loopback + PKCE (dán URL vào /profile) và chọn client khi đăng. Không gọi mạng thật.
 */
import "./channel-env";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { ytCredentialKey } from "../lib/youtube-credentials";
import { youtube } from "../lib/publishers/youtube";
import {
  buildAuthUrl, challengeS256, exchangeCode, loopbackRedirect, newState, newVerifier, packDesktopState, parsePasted,
  unpackDesktopState, YT_DESKTOP_COOKIE, YT_LOOPBACK_DEFAULT, YT_RECONNECT_MSG, ytCreds, ytTokenInfo,
} from "../lib/youtube-oauth";

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const realFetch = globalThis.fetch;
const saveEnv = { ...process.env };
let tmp = "";
const SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-ytd-"));
  globalThis.fetch = (async () => { throw new Error("NETWORK BLOCKED IN TESTS"); }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!(k in saveEnv)) delete process.env[k];
  Object.assign(process.env, saveEnv);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("PKCE + loopback", () => {
  it("verifier 43 ký tự base64url, challenge S256 đúng RFC 7636", () => {
    const v = newVerifier();
    assert.match(v, /^[A-Za-z0-9_-]{43}$/);
    // Ví dụ trong RFC 7636 Appendix B
    assert.equal(challengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("auth URL có code_challenge S256, offline, consent, redirect loopback", () => {
    const q = new URL(buildAuthUrl("did", loopbackRedirect({}), "s".repeat(48), "CH")).searchParams;
    assert.equal(q.get("redirect_uri"), "http://127.0.0.1:8765/");
    assert.equal(q.get("code_challenge"), "CH");
    assert.equal(q.get("code_challenge_method"), "S256");
    assert.equal(q.get("access_type"), "offline");
    assert.equal(q.get("prompt"), "consent");
    assert.deepEqual(q.get("scope")!.split(" "), SCOPES.split(" "));
    assert.equal(new URL(buildAuthUrl("x", "https://a/cb", "s")).searchParams.get("code_challenge"), null);
  });
  it("YT_LOOPBACK_REDIRECT chỉ nhận http loopback", () => {
    assert.equal(loopbackRedirect({ YT_LOOPBACK_REDIRECT: "http://localhost:9000/cb" }), "http://localhost:9000/cb");
    assert.equal(loopbackRedirect({ YT_LOOPBACK_REDIRECT: "http://evil.com:9000/" }), YT_LOOPBACK_DEFAULT);
    assert.equal(loopbackRedirect({ YT_LOOPBACK_REDIRECT: "https://127.0.0.1/" }), YT_LOOPBACK_DEFAULT);
    assert.equal(loopbackRedirect({ YT_LOOPBACK_REDIRECT: "rác" }), YT_LOOPBACK_DEFAULT);
  });
  it("cookie state.slug.verifier", () => {
    const s = newState(), v = newVerifier();
    assert.deepEqual(unpackDesktopState(packDesktopState(s, "kenh-lich-su", v)), { state: s, slug: "kenh-lich-su", verifier: v });
    assert.equal(unpackDesktopState(packDesktopState(s, "../x", v)), null);
    assert.equal(unpackDesktopState(packDesktopState(s, "a", "ngắn")), null);
    assert.equal(unpackDesktopState(undefined), null);
  });
});

describe("parsePasted", () => {
  it("URL đầy đủ, chuỗi query, mã trần, lỗi, rác", () => {
    assert.deepEqual(parsePasted(` http://127.0.0.1:8765/?state=abc&code=4/0AbC-d_e&scope=${encodeURIComponent(SCOPES)} `), { code: "4/0AbC-d_e", state: "abc", error: undefined });
    assert.deepEqual(parsePasted("127.0.0.1:8765/?state=abc&code=4%2F0AbC"), { code: "4/0AbC", state: "abc", error: undefined });
    assert.deepEqual(parsePasted('"4/0AeanS0abcdefghijk"'), { code: "4/0AeanS0abcdefghijk" });
    assert.deepEqual(parsePasted("http://127.0.0.1:8765/?error=access_denied&state=abc"), { code: undefined, state: "abc", error: "access_denied" });
    assert.equal(parsePasted("http://127.0.0.1:8765/"), null);
    assert.equal(parsePasted("xin chào"), null);
    assert.equal(parsePasted(""), null);
  });
});

describe("exchangeCode với Desktop client", () => {
  it("gửi client desktop + code_verifier + đúng redirect loopback", async () => {
    let body = new URLSearchParams();
    const f = (async (_u: any, init: any) => { body = new URLSearchParams(init.body); return json({ access_token: "a", refresh_token: "r", scope: SCOPES }); }) as any;
    await exchangeCode(f, {}, "4/c", YT_LOOPBACK_DEFAULT, { clientId: "did", clientSecret: "dsec", codeVerifier: "VER" });
    assert.equal(body.get("client_id"), "did");
    assert.equal(body.get("client_secret"), "dsec");
    assert.equal(body.get("code_verifier"), "VER");
    assert.equal(body.get("redirect_uri"), "http://127.0.0.1:8765/");
    assert.equal(body.get("grant_type"), "authorization_code");
  });
});

describe("chọn client + hạn token", () => {
  const W = { YT_CLIENT_ID: "w", YT_CLIENT_SECRET: "ws" }, D = { YT_DESKTOP_CLIENT_ID: "d", YT_DESKTOP_CLIENT_SECRET: "ds" };
  it("theo YT_TOKEN_CLIENT, mặc định web rồi desktop", () => {
    assert.equal(ytCreds({ ...W, ...D, YT_TOKEN_CLIENT: "desktop" })!.id, "d");
    assert.equal(ytCreds({ ...W, ...D, YT_TOKEN_CLIENT: "web" })!.id, "w");
    assert.equal(ytCreds({ ...W, ...D })!.id, "w");
    assert.equal(ytCreds({ ...D })!.id, "d");
    assert.equal(ytCreds({ ...W, YT_TOKEN_CLIENT: "desktop" }), null);
    assert.equal(ytCreds({}), null);
  });
  it("Testing: hết hạn sau 7 ngày; YT_OAUTH_TESTING=0 thì không", () => {
    const t0 = Date.parse("2026-10-18T03:00:00Z");
    const i = ytTokenInfo({ YT_TOKEN_ISSUED_AT: "2026-10-18T03:00:00Z" }, t0 + 6 * 86400e3);
    assert.equal(i.expired, false);
    assert.equal(i.expiresAt!.toISOString(), "2026-10-25T03:00:00.000Z");
    assert.equal(ytTokenInfo({ YT_TOKEN_ISSUED_AT: "2026-10-18T03:00:00Z" }, t0 + 8 * 86400e3).expired, true);
    assert.equal(ytTokenInfo({ YT_TOKEN_ISSUED_AT: "2026-10-18T03:00:00Z", YT_OAUTH_TESTING: "0" }, t0 + 30 * 86400e3).expired, false);
    assert.equal(ytTokenInfo({}).issuedAt, undefined);
  });
});

describe("publisher YouTube", () => {
  const mp4 = () => { const p = path.join(tmp, "v.mp4"); fs.writeFileSync(p, Buffer.alloc(10)); return p; };
  const job = () => ({ platform: "youtube", videoPath: mp4(), title: "t", caption: "c", aiGenerated: true }) as any;
  it("token desktop -> đổi bằng client desktop", async () => {
    const calls: URLSearchParams[] = [];
    const env = { YT_CLIENT_ID: "w", YT_CLIENT_SECRET: "ws", YT_DESKTOP_CLIENT_ID: "d", YT_DESKTOP_CLIENT_SECRET: "ds", YT_REFRESH_TOKEN: "rt", YT_TOKEN_CLIENT: "desktop" };
    const f = (async (_u: any, init: any) => { calls.push(new URLSearchParams(init.body)); return json({ error: "stop" }, 400); }) as any;
    assert.equal(youtube.configured(env), true);
    const r = await youtube.publish(job(), { env, fetch: f } as any);
    assert.equal(r.ok, false);
    assert.equal(calls[0].get("client_id"), "d");
    assert.equal(calls[0].get("client_secret"), "ds");
  });
  it("invalid_grant -> thông báo kết nối lại rõ ràng, không lộ token", async () => {
    const env = { YT_DESKTOP_CLIENT_ID: "d", YT_DESKTOP_CLIENT_SECRET: "ds", YT_REFRESH_TOKEN: "1//RT-SECRET", YT_TOKEN_CLIENT: "desktop" };
    const f = (async () => json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400)) as any;
    const r = await youtube.publish(job(), { env, fetch: f } as any);
    assert.equal(r.ok, false);
    assert.equal(r.error, YT_RECONNECT_MSG);
    assert.match(r.error!, /kết nối lại/);
    assert.doesNotMatch(r.error!, /SECRET/);
  });
  it("thiếu client -> chưa configured", () => {
    assert.equal(youtube.configured({ YT_REFRESH_TOKEN: "x", YT_TOKEN_CLIENT: "desktop", YT_CLIENT_ID: "w", YT_CLIENT_SECRET: "ws" }), false);
  });
});

describe("route desktop start + finish (fetch giả, DATA_DIR + ENV_FILE tạm)", () => {
  async function setup() {
    const data = path.join(tmp, "data");
    fs.mkdirSync(path.join(data, "profiles"), { recursive: true });
    fs.writeFileSync(path.join(data, "profiles", "kenh-lich-su.json"), JSON.stringify({
      slug: "kenh-lich-su", name: "Kênh Lịch Sử", updatedAt: "", sections: { info: [], voice: [], ttsNotes: [], colors: [], hashtags: [] },
      channels: [{ platform: "youtube", handle: "@x", name: "x", connected: false, via: "direct" }],
    }));
    const envFile = path.join(tmp, "d.env");
    fs.writeFileSync(envFile, "ADMIN_PASSWORD=p\nPUBLISH_DRY_RUN=1\n", { mode: 0o600 });
    Object.assign(process.env, { DATA_DIR: data, ENV_FILE: envFile, YT_DESKTOP_CLIENT_ID: "did", YT_DESKTOP_CLIENT_SECRET: "dsec" });
    for (const k of Object.keys(process.env)) if (/^YT_(?:REFRESH_TOKEN|TOKEN_CLIENT|TOKEN_ISSUED_AT|CHANNEL_ID)(?:_PROFILE_.*)?$|^YT_PROFILE$/.test(k)) delete process.env[k];
    for (const k of ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REDIRECT_URI"]) delete process.env[k];
    const start = await import("../app/api/youtube/oauth/desktop/start/route");
    const finish = await import("../app/api/youtube/oauth/desktop/finish/route");
    return { data, envFile, start: start.GET, finish: finish.POST };
  }
  const H = { host: "video-studio-box:3100" };
  const post = (pasted: string, cookie?: string, origin = "http://video-studio-box:3100") => new Request("http://video-studio-box:3100/api/youtube/oauth/desktop/finish", {
    method: "POST", body: new URLSearchParams({ pasted }),
    headers: { ...H, origin, "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
  });

  it("start: chạy trên http (không cần HTTPS), redirect Google với PKCE, cookie httpOnly chứa verifier khớp challenge", async () => {
    const { start } = await setup();
    const r = await start(new Request("http://video-studio-box:3100/api/youtube/oauth/desktop/start?profile=kenh-lich-su", { headers: H }));
    assert.equal(r.status, 302);
    const q = new URL(r.headers.get("location")!).searchParams;
    assert.equal(q.get("client_id"), "did");
    assert.equal(q.get("redirect_uri"), "http://127.0.0.1:8765/");
    const sc = r.headers.get("set-cookie")!;
    assert.match(sc, /HttpOnly/i);
    assert.doesNotMatch(sc, /Secure/i);
    const saved = unpackDesktopState(decodeURIComponent(sc.match(new RegExp(`${YT_DESKTOP_COOKIE}=([^;]+)`))![1]));
    assert.equal(saved!.slug, "kenh-lich-su");
    assert.equal(saved!.state, q.get("state"));
    assert.equal(challengeS256(saved!.verifier), q.get("code_challenge"));
  });

  it("start: thiếu client desktop -> /profile?yt=no_desktop_client", async () => {
    const { start } = await setup();
    delete process.env.YT_DESKTOP_CLIENT_SECRET;
    const r = await start(new Request("http://video-studio-box:3100/api/youtube/oauth/desktop/start", { headers: H }));
    assert.match(r.headers.get("location")!, /yt=no_desktop_client/);
  });

  it("finish: state sai / không có cookie / origin lạ / dán rác -> không gọi Google, không ghi .env", async () => {
    const { envFile, finish } = await setup();
    let called = false;
    globalThis.fetch = (async () => { called = true; return json({}); }) as any;
    const s = newState(), v = newVerifier(), ck = `${YT_DESKTOP_COOKIE}=${packDesktopState(s, "kenh-lich-su", v)}`;
    for (const r of [
      await finish(post(`http://127.0.0.1:8765/?state=${newState()}&code=4/x`, ck)),
      await finish(post(`http://127.0.0.1:8765/?state=${s}&code=4/x`)),
      await finish(post(`http://127.0.0.1:8765/?state=${s}&code=4/x`, ck, "https://evil.example")),
      await finish(post("không phải url", ck)),
    ]) {
      assert.equal(r.status, 303);
      assert.match(r.headers.get("location")!, /^\/profile\?yt=error/);
    }
    assert.equal(called, false);
    assert.doesNotMatch(fs.readFileSync(envFile, "utf8"), /YT_REFRESH_TOKEN/);
  });

  it("finish thành công: gửi verifier, ghi token + client=desktop + ngày cấp (600), giữ PUBLISH_DRY_RUN, cập nhật kênh", async () => {
    const { data, envFile, finish } = await setup();
    let tokenBody = new URLSearchParams();
    globalThis.fetch = (async (u: any, init: any) => {
      const url = String(u);
      if (url.startsWith("https://oauth2.googleapis.com/token")) { tokenBody = new URLSearchParams(init.body); return json({ access_token: "AT-SECRET", refresh_token: "1//RT-SECRET", scope: SCOPES }); }
      if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) return json({ items: [{ id: "UC1", snippet: { title: "Kênh Lịch Sử", customUrl: "@kenhlichsu" } }] });
      throw new Error(`unexpected ${url}`);
    }) as any;
    const s = newState(), v = newVerifier();
    const r = await finish(post(`http://127.0.0.1:8765/?state=${s}&code=4%2F0Abc&scope=${encodeURIComponent(SCOPES)}`, `${YT_DESKTOP_COOKIE}=${packDesktopState(s, "kenh-lich-su", v)}`));
    const loc = r.headers.get("location")!;
    assert.match(loc, /^\/profile\?yt=ok/);
    assert.doesNotMatch(loc, /SECRET/);
    assert.equal(tokenBody.get("code"), "4/0Abc");
    assert.equal(tokenBody.get("code_verifier"), v);
    assert.equal(tokenBody.get("client_id"), "did");
    assert.equal(tokenBody.get("redirect_uri"), "http://127.0.0.1:8765/");
    const env = fs.readFileSync(envFile, "utf8");
    assert.match(env, new RegExp(`^${ytCredentialKey("kenh-lich-su", "YT_REFRESH_TOKEN")}=1//RT-SECRET$`, "m"));
    assert.match(env, new RegExp(`^${ytCredentialKey("kenh-lich-su", "YT_TOKEN_CLIENT")}=desktop$`, "m"));
    assert.match(env, new RegExp(`^${ytCredentialKey("kenh-lich-su", "YT_TOKEN_ISSUED_AT")}=[0-9]{4}-[0-9]{2}-[0-9]{2}T`, "m"));
    assert.match(env, /^PUBLISH_DRY_RUN=1$/m);
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
    assert.equal(process.env[ytCredentialKey("kenh-lich-su", "YT_TOKEN_CLIENT")], "desktop");
    const p = JSON.parse(fs.readFileSync(path.join(data, "profiles", "kenh-lich-su.json"), "utf8"));
    assert.deepEqual(p.channels[0], { platform: "youtube", handle: "@kenhlichsu", name: "Kênh Lịch Sử", connected: true, via: "direct" });
    assert.match(r.headers.get("set-cookie") || "", new RegExp(`${YT_DESKTOP_COOKIE}=;`));
  });
  it("finish: channel API error or absent ID does not persist token", async () => {
    const { envFile, finish } = await setup();
    for (const response of [json({ error: { message: "denied" } }, 403), json({ items: [{ snippet: { title: "No id" } }] })]) {
      globalThis.fetch = (async (u: RequestInfo | URL) => String(u).startsWith("https://oauth2")
        ? json({ access_token: "at", refresh_token: "fake", scope: SCOPES })
        : response) as typeof fetch;
      const s = newState(), v = newVerifier();
      const r = await finish(post(`http://127.0.0.1:8765/?state=${s}&code=4%2F0Abc`, `${YT_DESKTOP_COOKIE}=${packDesktopState(s, "kenh-lich-su", v)}`));
      assert.match(r.headers.get("location")!, /yt=error/);
      assert.doesNotMatch(fs.readFileSync(envFile, "utf8"), /YT_REFRESH_TOKEN/);
    }
  });

  it("finish: chỉ dán mã (không có state) vẫn được, verifier vẫn ràng buộc phiên", async () => {
    const { finish } = await setup();
    let ver = "";
    globalThis.fetch = (async (u: any, init: any) => {
      if (String(u).startsWith("https://oauth2")) { ver = new URLSearchParams(init.body).get("code_verifier")!; return json({ access_token: "a", refresh_token: "r", scope: SCOPES }); }
      return json({ items: [{ id: "UC1", snippet: { title: "K" } }] });
    }) as any;
    const s = newState(), v = newVerifier();
    const r = await finish(post("4/0AeanS0abcdefghijk", `${YT_DESKTOP_COOKIE}=${packDesktopState(s, "kenh-lich-su", v)}`));
    assert.match(r.headers.get("location")!, /yt=ok/);
    assert.equal(ver, v);
  });
});
