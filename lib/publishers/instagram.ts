import fs from "node:fs";
import { DEFAULT_GRAPH_VERSION, fileStream, graphError, num, readJson, realCtx, STREAM_INIT } from "./http";
import type { PublishCtx, Publisher } from "./types";

/**
 * Instagram Reels qua Instagram Platform Content Publishing, upload resumable (không cần URL công khai):
 *   1) POST graph.facebook.com/{ver}/{IG_USER_ID}/media  {media_type:REELS, upload_type:resumable, caption, share_to_feed, is_ai_generated}
 *      -> {id (container), uri}
 *   2) POST rupload.facebook.com/ig-api-upload/{ver}/{container}  (Authorization: OAuth, offset: 0, file_size, stream)
 *   3) GET /{container}?fields=status_code,status  tới khi FINISHED (ERROR/EXPIRED = lỗi)
 *   4) POST /{IG_USER_ID}/media_publish {creation_id}  -> {id}; GET /{id}?fields=permalink
 * upload_type=resumable chỉ dùng được với "Facebook Login for Business" (token có instagram_basic,
 * instagram_content_publish, pages_read_engagement), nên host mặc định là graph.facebook.com.
 * Token: IG_ACCESS_TOKEN, nếu trống thì dùng FB_PAGE_TOKEN (Page token cấp qua Facebook Login có thêm quyền IG).
 * IG_USER_ID = instagram_business_account của Page (nút "Kiểm tra Instagram" ở /profile tự tìm và lưu).
 * Giới hạn: 100 bài API/24h mỗi tài khoản (GET /{IG_ID}/content_publishing_limit). Container hết hạn sau 24h.
 */
const ver = (env: PublishCtx["env"]) => env.IG_GRAPH_VERSION || env.FB_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
const graph = (env: PublishCtx["env"]) => `https://${env.IG_GRAPH_HOST || "graph.facebook.com"}/${ver(env)}`;

export const igToken = (env: PublishCtx["env"]) => env.IG_ACCESS_TOKEN || env.FB_PAGE_TOKEN;

export const instagram: Publisher = {
  name: "instagram-reels",
  supports: (p) => p === "instagram",
  configured: (env = process.env) => Boolean(env.IG_USER_ID && igToken(env)),
  async publish(job, ctx = realCtx()) {
    const { env } = ctx;
    const ig = env.IG_USER_ID!, token = igToken(env)!;
    const auth = { authorization: `Bearer ${token}` };
    const fail = (error: string, id?: string) => ({ platform: job.platform, ok: false, id, error });
    let size = 0;
    try { size = fs.statSync(job.videoPath).size; } catch { return fail("Không thấy file video"); }

    // 1) container
    const body: Record<string, unknown> = {
      media_type: "REELS", upload_type: "resumable", caption: job.caption.slice(0, 2200),
      share_to_feed: (env.IG_SHARE_TO_FEED ?? "1") !== "0",
    };
    if (job.aiGenerated !== false) body.is_ai_generated = true;
    const r1 = await ctx.fetch(`${graph(env)}/${ig}/media`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) });
    const j1 = await readJson(r1);
    if (!r1.ok || j1.error || !j1.id) return fail(graphError("Instagram tạo container", r1.status, j1));
    const container = String(j1.id);
    const uploadUrl = String(j1.uri || `https://rupload.facebook.com/ig-api-upload/${ver(env)}/${container}`);

    // 2) upload: MP4 trên CDN -> header file_url (Meta tự tải); không thì stream (thử lại từ đầu nếu lỗi tạm thời)
    const retries = num(env, "IG_UPLOAD_RETRIES", 2);
    let lastErr = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const r2 = await ctx.fetch(uploadUrl, job.videoUrl
          ? { method: "POST", headers: { authorization: `OAuth ${token}`, file_url: job.videoUrl } }
          : {
            ...STREAM_INIT, method: "POST",
            headers: { authorization: `OAuth ${token}`, offset: "0", file_size: String(size), "content-type": "application/octet-stream", "content-length": String(size), "x-entity-length": String(size) },
            body: fileStream(job.videoPath),
          });
        const j2 = await readJson(r2);
        if (r2.ok && j2.success !== false && !j2.debug_info) { lastErr = ""; break; }
        lastErr = graphError("Instagram upload", r2.status, j2);
        if (j2.debug_info?.retriable === false) break;
      } catch (e) { lastErr = `Instagram upload: ${(e as Error).message}`; }
      if (attempt < retries) { ctx.log(`[instagram] ${lastErr}; thử lại`); await ctx.sleep(3000 * (attempt + 1)); }
    }
    if (lastErr) return fail(`${lastErr} (container ${container})`, container);

    // 3) poll status_code
    const interval = num(env, "IG_POLL_INTERVAL_MS", 30000), timeout = num(env, "IG_POLL_TIMEOUT_MS", 10 * 60e3);
    const t0 = Date.now();
    let code = "", detail = "";
    for (;;) {
      const r3 = await ctx.fetch(`${graph(env)}/${container}?fields=status_code,status`, { headers: auth });
      const j3 = await readJson(r3);
      if (!r3.ok || j3.error) return fail(graphError("Instagram status", r3.status, j3), container);
      code = String(j3.status_code || ""); detail = String(j3.status || "");
      if (code === "FINISHED" || code === "PUBLISHED") break;
      if (code === "ERROR" || code === "EXPIRED") return fail(`Instagram xử lý video ${code}${detail ? `: ${detail}` : ""} (container ${container})`, container);
      if (Date.now() - t0 + interval > timeout) return fail(`Instagram: hết ${Math.round(timeout / 1000)}s chờ xử lý (status_code=${code || "?"}). Container ${container} còn hạn 24h.`, container);
      await ctx.sleep(interval);
    }

    // 4) publish
    const r4 = await ctx.fetch(`${graph(env)}/${ig}/media_publish`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ creation_id: container }) });
    const j4 = await readJson(r4);
    if (!r4.ok || j4.error || !j4.id) return fail(graphError("Instagram media_publish", r4.status, j4), container);
    const mediaId = String(j4.id);
    let url: string | undefined;
    try {
      const r5 = await ctx.fetch(`${graph(env)}/${mediaId}?fields=permalink`, { headers: auth });
      const j5 = await readJson(r5);
      if (r5.ok && j5.permalink) url = String(j5.permalink);
    } catch { /* permalink không bắt buộc */ }
    return { platform: job.platform, ok: true, id: mediaId, url };
  },
};
