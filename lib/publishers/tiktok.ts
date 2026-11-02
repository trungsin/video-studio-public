import fs from "node:fs";
import { readJson, realCtx, STREAM_INIT, fileStream } from "./http";
import type { Publisher } from "./types";

/**
 * TikTok Content Posting API — Direct Post, FILE_UPLOAD:
 *   1) POST https://open.tiktokapis.com/v2/post/publish/video/init/  -> {publish_id, upload_url}
 *   2) PUT file lên upload_url với Content-Range (1 chunk nếu ≤ 64MB)
 *   3) (tuỳ chọn) POST /v2/post/publish/status/fetch/ để theo dõi
 * App chưa qua audit của TikTok chỉ đăng được privacy SELF_ONLY (TIKTOK_PRIVACY).
 * Access token là user token scope video.publish (TODO: luồng OAuth + refresh token). Chưa chạy thử với token thật.
 */
export const tiktok: Publisher = {
  name: "tiktok-content-posting",
  supports: (p) => p === "tiktok",
  configured: (env = process.env) => Boolean(env.TIKTOK_ACCESS_TOKEN),
  async publish(job, ctx = realCtx()) {
    const env = ctx.env;
    const size = fs.statSync(job.videoPath).size;
    if (size > 64 * 1024 * 1024) return { platform: job.platform, ok: false, error: "TODO: upload nhiều chunk cho file > 64MB" };
    const init = await ctx.fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: { authorization: `Bearer ${env.TIKTOK_ACCESS_TOKEN}`, "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: { title: job.caption.slice(0, 2200), privacy_level: env.TIKTOK_PRIVACY || "SELF_ONLY", disable_comment: false, disable_duet: false, disable_stitch: false, is_aigc: job.aiGenerated !== false },
        source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
      }),
    });
    const j = await readJson(init);
    if (!init.ok || j.error?.code !== "ok") return { platform: job.platform, ok: false, error: j.error?.message || `init ${init.status}` };
    const up = await ctx.fetch(j.data.upload_url, { ...STREAM_INIT, method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(size), "content-range": `bytes 0-${size - 1}/${size}` }, body: fileStream(job.videoPath) });
    if (!up.ok) return { platform: job.platform, ok: false, error: `upload ${up.status}` };
    return { platform: job.platform, ok: true, id: j.data.publish_id };
  },
};
