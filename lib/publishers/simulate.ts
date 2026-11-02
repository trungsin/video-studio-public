import { redact, streamInfo } from "./http";
import type { PublishCtx } from "./types";

/** Khoá bí mật: dry-run luôn thay bằng placeholder để log không bao giờ chứa token thật. */
export const SECRET_KEYS = ["FB_PAGE_TOKEN", "IG_ACCESS_TOKEN", "YT_CLIENT_SECRET", "YT_DESKTOP_CLIENT_SECRET", "YT_REFRESH_TOKEN", "TIKTOK_ACCESS_TOKEN", "ZERNIO_API_KEY"];
const ID_KEYS = ["FB_PAGE_ID", "IG_USER_ID", "YT_CLIENT_ID", "YT_DESKTOP_CLIENT_ID"];

export function dryEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = { ...env, FB_POLL_INTERVAL_MS: "0", IG_POLL_INTERVAL_MS: "0", ZERNIO_POLL_INTERVAL_MS: "0", ZERNIO_URL_WAIT_MS: "0" };
  for (const k of SECRET_KEYS) e[k] = `<${k}>`;
  for (const k of Object.keys(env)) if (k.startsWith("ZERNIO_API_KEY_")) e[k] = `<${k}>`;   // khoá Zernio riêng từng profile
  for (const k of Object.keys(e)) if (/^YT_REFRESH_TOKEN_PROFILE_[0-9A-F]+$/.test(k)) e[k] = `<${k}>`;
  for (const k of ID_KEYS) if (!e[k]) e[k] = `<${k}>`;
  return e;
}

function headersObj(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h || {}).forEach((v, k) => { out[k] = v; });
  return out;
}

async function describeBody(body: unknown): Promise<string> {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (typeof body === "object" && streamInfo.has(body as object)) {
    const d = streamInfo.get(body as object)!;
    try { await (body as ReadableStream).cancel(); } catch { /* bỏ qua */ }
    return d;
  }
  if (body instanceof URLSearchParams) return body.toString();
  return `<${Object.prototype.toString.call(body)}>`;
}

const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });

/** creator-info mô phỏng (dry run, không gọi Zernio) để thử giao diện. */
export const DRY_TIKTOK_CREATOR_INFO = {
  dryRun: true,
  creator: { nickname: "dry-run (chưa nối Zernio)", isVerified: false, canPostMore: true },
  privacyLevels: [
    { value: "PUBLIC_TO_EVERYONE", label: "Everyone" },
    { value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends" },
    { value: "FOLLOWER_OF_CREATOR", label: "Followers" },
    { value: "SELF_ONLY", label: "Only you" },
  ],
  postingLimits: {
    maxVideoDurationSec: 600,
    interactionSettings: {
      allow_comment: { enabled: true, required: true, default: false, label: "Allow comments" },
      allow_duet: { enabled: true, required: true, default: false, label: "Allow Duet" },
      allow_stitch: { enabled: true, required: true, default: false, label: "Allow Stitch" },
    },
  },
  commercialContentTypes: [
    { value: "none", label: "None" },
    { value: "brand_organic", label: "Your brand" },
    { value: "brand_content", label: "Branded content" },
  ],
};

/** Phản hồi giả cho từng endpoint mà adapter gọi. */
function respond(method: string, url: string, body: string): Response {
  const u = new URL(url);
  const p = u.pathname;
  if (u.host === "graph.facebook.com" || u.host === "graph.instagram.com") {
    if (method === "POST" && p.endsWith("/video_reels")) {
      return body.includes('"upload_phase":"start"')
        ? json({ video_id: "dry-fb-video", upload_url: "https://rupload.facebook.com/video-upload/v26.0/dry-fb-video" })
        : json({ success: true, post_id: "dry-fb-post" });
    }
    if (method === "POST" && p.endsWith("/media_publish")) return json({ id: "dry-ig-media" });
    if (method === "POST" && p.endsWith("/media")) return json({ id: "dry-ig-container", uri: "https://rupload.facebook.com/ig-api-upload/v26.0/dry-ig-container" });
    const f = u.searchParams.get("fields") || "";
    if (f === "status") return json({ id: p.split("/").pop(), status: { video_status: "ready", uploading_phase: { status: "complete" }, processing_phase: { status: "complete" }, publishing_phase: { status: "complete" } } });
    if (f.startsWith("status_code")) return json({ id: p.split("/").pop(), status_code: "FINISHED" });
    if (f === "permalink") return json({ id: p.split("/").pop(), permalink: "https://www.instagram.com/reel/DRY-RUN/" });
  }
  if (u.host === "rupload.facebook.com") return json({ success: true, message: "Upload successful." });
  if (u.host === "oauth2.googleapis.com") return json({ access_token: "<dry-access-token>", expires_in: 3599 });
  if (u.host === "www.googleapis.com") {
    if (method === "POST") return json({}, 200, { location: "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=dry-run" });
    return json({ id: "dry-yt-video" });
  }
  if (u.host === "open.tiktokapis.com") return json({ data: { publish_id: "dry-tt-publish", upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=dry-run" }, error: { code: "ok", message: "" } });
  if (u.host === "open-upload.tiktokapis.com") return new Response(null, { status: 201 });
  if (p.endsWith("/media/presign")) return json({ uploadUrl: "https://dry-upload.zernio.invalid/put", publicUrl: "https://dry-cdn.zernio.invalid/video.mp4" });
  if (u.host === "dry-upload.zernio.invalid") return new Response(null, { status: 200 });
  if (p.endsWith("/tiktok/creator-info")) return json(DRY_TIKTOK_CREATOR_INFO);
  if (method === "POST" && p.endsWith("/posts") && body.includes('"dryRun":true')) return json({ dryRun: true, canPublish: true, tiktok: [{ canPublish: true }] });
  if (method === "GET" && p.includes("/posts/")) return json({ post: { _id: p.split("/").pop(), status: "published", platforms: [{ platform: "tiktok", status: "published" }] } });
  if (p.endsWith("/posts")) return json({ post: { _id: "dry-zernio-post", platforms: [{ status: "published" }] } });
  if (p.endsWith("/accounts")) return json({ accounts: [] });
  return json({ error: { message: `dry-run: không có phản hồi mô phỏng cho ${method} ${u.host}${p}` } }, 404);
}

/** fetch giả: ghi lại đúng request sẽ gửi (token đã che) và trả phản hồi mô phỏng, không gọi mạng. */
export function simulatedFetch(log: (l: string) => void, record?: { method: string; url: string; headers: Record<string, string>; body: string }[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || "GET").toUpperCase();
    const headers = headersObj(init?.headers);
    const body = await describeBody(init?.body);
    record?.push({ method, url, headers, body });
    log(redact(`[dry-run] ${method} ${url}\n    headers: ${JSON.stringify(headers)}${body ? `\n    body: ${body}` : ""}`));
    return respond(method, url, body);
  }) as typeof fetch;
}

export function dryCtx(log: (l: string) => void = (l) => console.log(l), env: Record<string, string | undefined> = process.env, record?: Parameters<typeof simulatedFetch>[1]): PublishCtx {
  return { fetch: simulatedFetch(log, record), env: dryEnv(env), sleep: async () => {}, log, dryRun: true };
}
