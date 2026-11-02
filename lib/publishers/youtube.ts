import fs from "node:fs";
import { fileStream, readJson, realCtx, redact, STREAM_INIT } from "./http";
import type { PublishCtx, Publisher } from "./types";
import { ytCreds, ytReconnectMsg } from "../youtube-oauth";

/**
 * YouTube Data API v3 — resumable upload:
 *   1) Đổi refresh token lấy access token (oauth2.googleapis.com/token)
 *   2) POST .../upload/youtube/v3/videos?uploadType=resumable&part=snippet,status  -> header Location
 *   3) PUT bytes (stream) lên Location
 * Video dọc/vuông ≤ 3 phút được YouTube xếp vào Shorts. Mặc định privacy=private (đổi YT_PRIVACY).
 * status.containsSyntheticMedia = khai báo nội dung AI trông như thật (bật theo job.aiGenerated).
 * Lưu ý: project chưa audit có thể bị khoá private (tài liệu 2026 đang mâu thuẫn). Chưa chạy thử với token thật.
 */
/** Mô tả YouTube: tối đa 5000 ký tự, không có < >, thêm #Shorts cho video ngắn (≤ 3 phút). */
export function ytDescription(caption: string, durationSec?: number): string {
  let d = caption.replace(/[<>]/g, "");
  if ((durationSec ?? 0) <= 180 && !/#shorts\b/i.test(d)) d = `${d.trimEnd()}\n\n#Shorts`;
  return d.slice(0, 5000);
}

async function accessToken(ctx: PublishCtx) {
  const { env } = ctx;
  // Refresh token phải đổi bằng đúng client đã cấp nó (YT_TOKEN_CLIENT=desktop|web)
  const c = ytCreds(env);
  if (!c || !env.YT_REFRESH_TOKEN) throw new Error("YouTube chưa kết nối (thiếu client id/secret hoặc refresh token). Vào Profile → Kết nối YouTube");
  const r = await ctx.fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: env.YT_REFRESH_TOKEN, grant_type: "refresh_token" }).toString(),
  });
  const j = await readJson(r);
  if (j.error === "invalid_grant") throw new Error(ytReconnectMsg(env));
  if (!r.ok || !j.access_token) throw new Error(`YouTube OAuth: ${j.error_description || j.error || r.status}`);
  return j.access_token as string;
}

export const youtube: Publisher = {
  name: "youtube-data-api",
  supports: (p) => p === "youtube",
  configured: (env = process.env) => Boolean(ytCreds(env) && env.YT_REFRESH_TOKEN),
  async publish(job, ctx = realCtx()) {
    const { env } = ctx;
    let token: string;
    try { token = await accessToken(ctx); }
    catch (e) { return { platform: job.platform, ok: false, error: redact((e as Error).message) }; }
    const size = fs.statSync(job.videoPath).size;
    const init = await ctx.fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(size) },
      body: JSON.stringify({
        snippet: { title: job.title.replace(/[<>]/g, "").slice(0, 100), description: ytDescription(job.caption, job.durationSec), categoryId: env.YT_CATEGORY_ID || "27", defaultLanguage: env.YT_LANGUAGE || "vi", defaultAudioLanguage: env.YT_LANGUAGE || "vi" },
        status: { privacyStatus: job.youtubePrivacy || env.YT_PRIVACY || "private", selfDeclaredMadeForKids: false, containsSyntheticMedia: job.aiGenerated !== false },
      }),
    });
    const loc = init.headers.get("location");
    if (!init.ok || !loc) return { platform: job.platform, ok: false, error: redact(`YouTube init ${init.status}: ${(await init.text()).slice(0, 200)}`) };
    const up = await ctx.fetch(loc, { ...STREAM_INIT, method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(size) }, body: fileStream(job.videoPath) });
    const j = await readJson(up);
    if (!up.ok) return { platform: job.platform, ok: false, error: redact(j.error?.message || `YouTube upload ${up.status}`) };
    return { platform: job.platform, ok: true, id: j.id, url: `https://youtube.com/shorts/${j.id}` };
  },
};
