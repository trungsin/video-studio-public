import crypto from "node:crypto";
import { publicOrigin } from "./auth";

/**
 * Kết nối YouTube, hai cách:
 * A) Desktop app client + loopback (KHÔNG cần HTTPS, khuyên dùng):
 *   /api/youtube/oauth/desktop/start   -> cookie (state + PKCE verifier), chuyển tới Google với redirect http://127.0.0.1:8765/
 *   Sau khi đồng ý, trình duyệt mở http://127.0.0.1:8765/?state=..&code=.. (trang lỗi "không kết nối được" là bình thường);
 *   người dùng copy cả URL dán vào ô ở /profile -> POST /api/youtube/oauth/desktop/finish đổi code (kèm code_verifier).
 *   Env: YT_DESKTOP_CLIENT_ID, YT_DESKTOP_CLIENT_SECRET (tuỳ chọn YT_LOOPBACK_REDIRECT).
 * B) Web application client (cần HTTPS):
 *   /api/youtube/oauth/start    -> đặt cookie state (CSRF) rồi chuyển tới accounts.google.com
 *   /api/youtube/oauth/callback -> kiểm state, đổi code lấy refresh token và lưu theo profile vào env ngoài repo
 * Google chỉ chấp nhận redirect https (hoặc http://localhost) nên app phải được mở qua HTTPS
 * (tailscale serve --https=443 -> https://<máy>.<tailnet>.ts.net). Đặt YT_REDIRECT_URI cho cố định.
 */
export const YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
export const YT_CALLBACK_PATH = "/api/youtube/oauth/callback";
export const YT_STATE_COOKIE = "vs_yt_oauth";
type Env = Record<string, string | undefined>;

export const ytClientConfigured = (env: Env = process.env) => Boolean(env.YT_CLIENT_ID && env.YT_CLIENT_SECRET);
export const ytDesktopConfigured = (env: Env = process.env) => Boolean(env.YT_DESKTOP_CLIENT_ID && env.YT_DESKTOP_CLIENT_SECRET);
export const YT_DESKTOP_COOKIE = "vs_yt_desktop";
export const YT_DESKTOP_PATH = "/api/youtube/oauth/desktop";
export const YT_LOOPBACK_DEFAULT = "http://127.0.0.1:8765/";

/** Redirect loopback cho Desktop client: chỉ http://127.0.0.1|localhost[:port]/..., mặc định http://127.0.0.1:8765/. */
export function loopbackRedirect(env: Env = process.env): string {
  const u = env.YT_LOOPBACK_REDIRECT?.trim();
  if (u) {
    try {
      const x = new URL(u);
      if (x.protocol === "http:" && (x.hostname === "127.0.0.1" || x.hostname === "localhost") && !x.search && !x.hash && !x.username) return x.toString();
    } catch { /* bỏ qua, dùng mặc định */ }
  }
  return YT_LOOPBACK_DEFAULT;
}

export type YtClientKind = "web" | "desktop";
/** Client đã cấp refresh token hiện tại (YT_TOKEN_CLIENT), để đổi token bằng đúng cặp id/secret. */
export function ytCreds(env: Env = process.env): { kind: YtClientKind; id: string; secret: string } | null {
  const web = ytClientConfigured(env) ? { kind: "web" as const, id: env.YT_CLIENT_ID!, secret: env.YT_CLIENT_SECRET! } : null;
  const desk = ytDesktopConfigured(env) ? { kind: "desktop" as const, id: env.YT_DESKTOP_CLIENT_ID!, secret: env.YT_DESKTOP_CLIENT_SECRET! } : null;
  if (env.YT_TOKEN_CLIENT === "desktop") return desk;
  if (env.YT_TOKEN_CLIENT === "web") return web;
  return web || desk;
}

/** Ngày cấp token + hạn ước tính khi app OAuth ở chế độ Testing (Google thu hồi refresh token sau 7 ngày). */
export function ytTokenInfo(env: Env = process.env, now = Date.now()): { issuedAt?: Date; expiresAt?: Date; expired: boolean; testing: boolean } {
  const testing = env.YT_OAUTH_TESTING !== "0";
  const t = env.YT_TOKEN_ISSUED_AT ? new Date(env.YT_TOKEN_ISSUED_AT) : undefined;
  const issuedAt = t && !isNaN(t.getTime()) ? t : undefined;
  const expiresAt = issuedAt && testing ? new Date(issuedAt.getTime() + 7 * 86400e3) : undefined;
  return { issuedAt, expiresAt, expired: Boolean(expiresAt && expiresAt.getTime() <= now), testing };
}

/** Thông báo khi Google trả invalid_grant cho refresh token. */
export const YT_RECONNECT_MSG = "YouTube cần kết nối lại: refresh token đã hết hạn hoặc bị thu hồi (app OAuth ở chế độ Testing chỉ giữ token 7 ngày). Vào Profile → Kết nối YouTube để cấp lại.";
export const YT_RECONNECT_MSG_PROD = "YouTube cần kết nối lại: refresh token đã bị thu hồi (đổi mật khẩu Google, gỡ quyền app, hoặc token cấp khi app còn ở Testing). Vào Profile → Kết nối YouTube để cấp lại.";
export const ytReconnectMsg = (env: Env = process.env) => (env.YT_OAUTH_TESTING === "0" ? YT_RECONNECT_MSG_PROD : YT_RECONNECT_MSG);

/** PKCE (RFC 7636): verifier base64url 43 ký tự, challenge S256. */
export const newVerifier = () => crypto.randomBytes(32).toString("base64url");
export const challengeS256 = (verifier: string) => crypto.createHash("sha256").update(verifier).digest("base64url");

/** Cookie luồng Desktop: "<state>.<slug>.<verifier>". */
export const packDesktopState = (state: string, slug: string, verifier: string) => `${state}.${slug}.${verifier}`;
export function unpackDesktopState(v: string | undefined): { state: string; slug: string; verifier: string } | null {
  const m = (v || "").match(/^([a-f0-9]{48})\.([a-z0-9][a-z0-9-_]{0,63})\.([A-Za-z0-9_-]{43,128})$/);
  return m ? { state: m[1], slug: m[2], verifier: m[3] } : null;
}

/**
 * Đọc thứ người dùng dán: cả URL loopback (http://127.0.0.1:8765/?state=..&code=..&scope=..), chuỗi query
 * ("state=..&code=.."), hoặc chỉ mã ("4/0A..."). Trả null nếu không thấy code/error.
 */
export function parsePasted(input: string): { code?: string; state?: string; error?: string } | null {
  const t = (input || "").trim().replace(/^["'<\s]+|["'>\s]+$/g, "");
  if (!t || t.length > 4096) return null;
  let q: URLSearchParams | null = null;
  if (/^https?:\/\//i.test(t)) { try { q = new URL(t).searchParams; } catch { return null; } }
  else if (/(^|[?&])(code|error)=/.test(t)) q = new URLSearchParams(t.replace(/^[^?]*\?/, ""));
  if (q) {
    const code = q.get("code") || undefined, error = q.get("error") || undefined, state = q.get("state") || undefined;
    return code || error ? { code, state, error } : null;
  }
  return /^[0-9]\/[A-Za-z0-9_\-]{10,}$/.test(t) ? { code: t } : null;
}

/** Redirect URI hợp lệ cho Google: https (không phải IP) hoặc http://localhost|127.0.0.1. */
export function validRedirectUri(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.hash || url.username || url.password) return false;
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "http:") return local;
    if (url.protocol !== "https:") return false;
    return !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname);
  } catch { return false; }
}

/** Gốc (origin) công khai của request (xem publicOrigin trong lib/auth). */
export const requestOrigin = (headers: Headers, fallback?: string) => publicOrigin(headers, fallback);

/** YT_REDIRECT_URI nếu có, ngược lại suy ra từ origin hiện tại. null nếu không hợp lệ với Google. */
export function redirectUriFor(origin: string, env: Env = process.env): string | null {
  const u = env.YT_REDIRECT_URI?.trim() || (origin ? `${origin}${YT_CALLBACK_PATH}` : "");
  return u && validRedirectUri(u) ? u : null;
}

/** Cùng máy chủ (host:port)? So host thay vì origin vì proxy có thể không gửi X-Forwarded-Proto. */
export function sameHost(origin: string, target: string): boolean {
  try { return new URL(origin).host === new URL(target).host; } catch { return false; }
}

export const newState = () => crypto.randomBytes(24).toString("hex");

/** Cookie state: "<state>.<profileSlug>" (slug đã kiểm tra). */
export function packState(state: string, slug: string) { return `${state}.${slug}`; }
export function unpackState(v: string | undefined): { state: string; slug: string } | null {
  const m = (v || "").match(/^([a-f0-9]{48})\.([a-z0-9][a-z0-9-_]{0,63})$/i);
  return m ? { state: m[1], slug: m[2] } : null;
}

export function timingSafeEq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function buildAuthUrl(clientId: string, redirectUri: string, state: string, codeChallenge?: string): string {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: YT_SCOPES.join(" "),
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  if (codeChallenge) { q.set("code_challenge", codeChallenge); q.set("code_challenge_method", "S256"); }
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

type Fetch = typeof fetch;
const readJson = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

/** Đổi authorization code lấy token. Ném lỗi (không chứa token) nếu thiếu refresh_token. */
export async function exchangeCode(f: Fetch, env: Env, code: string, redirectUri: string,
  opts: { clientId?: string; clientSecret?: string; codeVerifier?: string } = {}): Promise<{ refreshToken: string; accessToken: string; scope: string }> {
  const form = new URLSearchParams({ code, client_id: opts.clientId || env.YT_CLIENT_ID!, client_secret: opts.clientSecret || env.YT_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (opts.codeVerifier) form.set("code_verifier", opts.codeVerifier);
  const r = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const j = await readJson(r);
  if (!r.ok || !j.access_token) throw new Error(`Google từ chối đổi mã: ${String(j.error_description || j.error || r.status).slice(0, 200)}`);
  if (!j.refresh_token) throw new Error("Google không trả refresh token. Thu hồi quyền app tại myaccount.google.com/permissions rồi kết nối lại");
  const scope = String(j.scope || "");
  if (!scope.includes("youtube.upload")) throw new Error("Chưa cấp quyền tải video lên YouTube (youtube.upload). Kết nối lại và tick đủ quyền");
  return { refreshToken: String(j.refresh_token), accessToken: String(j.access_token), scope };
}

export interface YtChannel { id: string; title: string; customUrl?: string }

/** Kênh của tài khoản vừa cấp quyền (cần youtube.readonly). null nếu tài khoản chưa có kênh. */
export async function fetchMyChannel(f: Fetch, accessToken: string): Promise<YtChannel | null> {
  const r = await f("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: `Bearer ${accessToken}` } });
  const j = await readJson(r);
  if (!r.ok) throw new Error(`Đọc kênh YouTube lỗi: ${String(j.error?.message || r.status).slice(0, 200)}`);
  const it = j.items?.[0];
  if (!it || typeof it.id !== "string" || !it.id.trim()) return null;
  return { id: it.id.trim(), title: String(it.snippet?.title || ""), customUrl: it.snippet?.customUrl ? String(it.snippet.customUrl) : undefined };
}
