import fs from "node:fs";
import { DEFAULT_GRAPH_VERSION, fileStream, graphError, num, readJson, realCtx, STREAM_INIT } from "./http";
import type { PublishCtx, Publisher, PublishJob } from "./types";
import type { PublishResult } from "../types";

/**
 * Facebook Page Reels Publishing API (developers.facebook.com/docs/video-api/guides/reels-publishing, v26.0):
 *   1) POST graph.facebook.com/{ver}/{page-id}/video_reels  upload_phase=start          -> {video_id, upload_url}
 *   2) POST rupload.facebook.com/video-upload/{ver}/{video-id}  (Authorization: OAuth, offset, file_size, stream)
 *      lỗi giữa chừng -> GET /{video-id}?fields=status lấy bytes_transfered rồi gửi tiếp từ offset đó
 *   3) POST /{page-id}/video_reels  upload_phase=finish, video_state=PUBLISHED|SCHEDULED, description, title,
 *      is_ai_generated, scheduled_publish_time
 *   4) GET /{video-id}?fields=status cho tới khi xử lý/đăng xong (hoặc lỗi)
 * Quyền: pages_show_list, pages_read_engagement, pages_manage_posts (Page token của người có task CREATE_CONTENT).
 * Giới hạn: 30 Reels/Page/24h. Thông số: 9:16, ≥540x960 (khuyên 1080x1920), 24-60fps, 3-90s.
 */
const graph = (env: PublishCtx["env"]) => `https://graph.facebook.com/${env.FB_GRAPH_VERSION || DEFAULT_GRAPH_VERSION}`;
const rupload = (env: PublishCtx["env"]) => `https://rupload.facebook.com/video-upload/${env.FB_GRAPH_VERSION || DEFAULT_GRAPH_VERSION}`;

type Status = {
  video_status?: string;
  uploading_phase?: { status?: string; bytes_transfered?: number; bytes_transferred?: number; error?: { message?: string } };
  processing_phase?: { status?: string; error?: { message?: string } };
  publishing_phase?: { status?: string; publish_status?: string; publish_time?: number; error?: { message?: string } };
};

async function getStatus(ctx: PublishCtx, videoId: string, token: string): Promise<Status> {
  const r = await ctx.fetch(`${graph(ctx.env)}/${videoId}?fields=status`, { headers: { authorization: `OAuth ${token}` } });
  const j = await readJson(r);
  if (!r.ok || j.error) throw new Error(graphError("Facebook status", r.status, j));
  return j.status || {};
}

function phaseError(s: Status): string | null {
  for (const [k, ph] of [["upload", s.uploading_phase], ["processing", s.processing_phase], ["publishing", s.publishing_phase]] as const) {
    if (ph?.status === "error" || ph?.error?.message) return `${k}: ${ph?.error?.message || "error"}`;
  }
  if (s.video_status === "error") return "video_status=error";
  return null;
}

/** Thời điểm lên lịch: phải trong tương lai (Facebook yêu cầu ≥ ~10 phút). */
export function scheduleUnix(iso: string | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw new Error(`scheduleAt không hợp lệ: ${iso}`);
  if (t - now < 10 * 60e3) throw new Error("scheduleAt phải sau thời điểm hiện tại ít nhất 10 phút");
  if (t - now > 75 * 24 * 3600e3) throw new Error("scheduleAt quá xa (Facebook giới hạn khoảng 75 ngày)");
  return Math.floor(t / 1000);
}

export const facebook: Publisher = {
  name: "facebook-reels",
  supports: (p) => p === "facebook",
  configured: (env = process.env) => Boolean(env.FB_PAGE_ID && env.FB_PAGE_TOKEN),
  async publish(job, ctx = realCtx()) {
    const { env } = ctx;
    const page = env.FB_PAGE_ID!, token = env.FB_PAGE_TOKEN!;
    const fail = (error: string, id?: string) => ({ platform: job.platform, ok: false, id, error });
    const size = ctx.dryRun ? safeSize(job.videoPath) : fs.statSync(job.videoPath).size;
    let sched: number | null;
    try { sched = scheduleUnix(job.scheduleAt); } catch (e) { return fail((e as Error).message); }

    // 1) start
    const r1 = await ctx.fetch(`${graph(env)}/${page}/video_reels`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ upload_phase: "start", access_token: token }),
    });
    const j1 = await readJson(r1);
    if (!r1.ok || j1.error || !j1.video_id) return fail(graphError("Facebook start", r1.status, j1));
    const videoId = String(j1.video_id);
    const uploadUrl = String(j1.upload_url || `${rupload(env)}/${videoId}`);

    // 2) upload: MP4 trên CDN -> header file_url (Facebook tự tải); không thì stream, resume theo bytes_transfered
    const retries = num(env, "FB_UPLOAD_RETRIES", 3);
    let offset = 0, lastErr = "", tries = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      tries = attempt + 1;
      try {
        const r2 = await ctx.fetch(uploadUrl, job.videoUrl
          ? { method: "POST", headers: { authorization: `OAuth ${token}`, file_url: job.videoUrl } }
          : {
            ...STREAM_INIT, method: "POST",
            // rupload từ chối body chunked kèm header khác: cần cả Content-Length và X-Entity-Length
            headers: { authorization: `OAuth ${token}`, offset: String(offset), file_size: String(size), "content-type": "application/octet-stream", "content-length": String(size - offset), "x-entity-length": String(size) },
            body: size > offset ? fileStream(job.videoPath, offset) : undefined,
          });
        const j2 = await readJson(r2);
        if (r2.ok && j2.success !== false && !j2.debug_info) { lastErr = ""; break; }
        lastErr = graphError("Facebook upload", r2.status, j2);
        if (j2.debug_info?.retriable === false) break;
      } catch (e) {
        lastErr = `Facebook upload: ${(e as Error).message}`;
      }
      if (attempt === retries) break;
      await ctx.sleep(2000 * (attempt + 1));
      try {
        const st = await getStatus(ctx, videoId, token);
        const done = st.uploading_phase?.bytes_transfered ?? st.uploading_phase?.bytes_transferred;
        if (st.uploading_phase?.status === "complete") { lastErr = ""; break; }
        if (typeof done === "number" && done >= 0 && done <= size) offset = done;
        ctx.log(`[facebook] upload lỗi (${lastErr}); gửi tiếp từ byte ${offset}`);
      } catch { /* giữ offset cũ */ }
    }
    if (lastErr) return fail(`${lastErr} (video_id ${videoId}, đã thử ${tries} lần)`, videoId);

    // 3) finish
    const fin: Record<string, string> = {
      access_token: token, video_id: videoId, upload_phase: "finish",
      video_state: sched ? "SCHEDULED" : (env.FB_REELS_STATE || "PUBLISHED"),
      description: job.caption,
    };
    if (job.title) fin.title = job.title.slice(0, 255);
    if (sched) fin.scheduled_publish_time = String(sched);
    if (job.aiGenerated !== false) fin.is_ai_generated = "true";
    const r3 = await ctx.fetch(`${graph(env)}/${page}/video_reels`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fin).toString(),
    });
    const j3 = await readJson(r3);
    if (!r3.ok || j3.error || j3.success === false) return fail(graphError("Facebook finish", r3.status, j3), videoId);
    const url = `https://www.facebook.com/reel/${videoId}`;

    // 4) poll
    const interval = num(env, "FB_POLL_INTERVAL_MS", 5000), timeout = num(env, "FB_POLL_TIMEOUT_MS", 10 * 60e3);
    const t0 = Date.now();
    let last: Status = {};
    let transient = 0;
    for (let i = 0; ; i++) {
      try { last = await getStatus(ctx, videoId, token); } catch (e) {
        // Ngay sau finish, Graph có thể trả code 100 / subcode 33 ("object does not exist") vài giây: thử lại
        const msg = (e as Error).message;
        if (/code 100 \| sub 33\b/.test(msg) && ++transient <= num(env, "FB_STATUS_TRANSIENT_RETRIES", 12)) { await ctx.sleep(Math.max(interval, 1000)); continue; }
        return fail(`${msg} (video_id ${videoId} đã finish, kiểm tra Page trước khi đăng lại)`, videoId);
      }
      const err = phaseError(last);
      if (err) return fail(`Facebook xử lý lỗi - ${err} (video_id ${videoId})`, videoId);
      const pub = last.publishing_phase?.status;
      if (pub === "complete" || last.video_status === "published") return postFbExtras(job, ctx, page, token, videoId, {  platform: job.platform, ok: true, id: videoId, url });
      if ((sched || fin.video_state !== "PUBLISHED") && last.processing_phase?.status === "complete") return postFbExtras(job, ctx, page, token, videoId, { platform: job.platform, ok: true, id: videoId, url });
      if (ctx.dryRun || Date.now() - t0 + interval > timeout) break;
      await ctx.sleep(interval);
    }
    if (ctx.dryRun) return postFbExtras(job, ctx, page, token, videoId, { platform: job.platform, ok: true, id: videoId, url });
    return fail(`Facebook: hết ${Math.round(timeout / 1000)}s chờ xử lý (video_status=${last.video_status}, processing=${last.processing_phase?.status}, publishing=${last.publishing_phase?.status}). video_id ${videoId} có thể vẫn lên sau, kiểm tra Page trước khi đăng lại.`, videoId);
  },
};

function safeSize(f: string) { try { return fs.statSync(f).size; } catch { return 0; } }

/** Sau khi Reel đăng thành công (best-effort, không bao giờ làm hỏng kết quả Reel):
 *  a) POST /{page}/feed  message = job.article  (bài viết đầy đủ lên Page)
 *  b) POST /{videoId}/comments  message = "Nguồn tham khảo:\n- url..." (job.sourceLinks)
 *  Chỉ chạy khi job có article / sourceLinks (chỉ kênh bản tin đặt field này). Tắt bằng FB_PAGE_EXTRAS=0. */
export async function postFbExtras(job: Pick<PublishJob, "article" | "sourceLinks" | "platform">, ctx: PublishCtx, page: string, token: string, videoId: string, res: Omit<PublishResult, "at" | "via"> & { extra?: unknown }) {
  const links0 = (job.sourceLinks || []).filter((u) => /^https?:\/\//.test(u));
  const article = fbArticleWithSources(job.article || "", links0, ctx.env.FB_SOURCES_COMMENT === "1");
  const links = (job.sourceLinks || []).filter((u) => /^https?:\/\//.test(u));
  if ((!article && !links.length) || ctx.env.FB_PAGE_EXTRAS === "0") return res;
  const extra: Record<string, unknown> = {};
  if (ctx.dryRun) { ctx.log(`[facebook] dry-run: sẽ đăng bài Page (${article.length} ký tự) + comment ${links.length} link`); return { ...res, extra: { dryRun: true } }; }
  const post = async (path: string, message: string) => {
    try {
      const r = await ctx.fetch(`${graph(ctx.env)}/${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ access_token: token, message }).toString() });
      const j = await readJson(r);
      if (!r.ok || j.error) return { ok: false, error: graphError(`Facebook ${path.split("/")[1]}`, r.status, j) };
      return { ok: true, id: String(j.id) };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  };
  if (article) {
    const r = await post(`${page}/feed`, article);
    extra.pagePost = r.ok ? { ...r, url: `https://www.facebook.com/${r.id}` } : r;
  }
  if (links.length && ctx.env.FB_SOURCES_COMMENT === "1") extra.sourcesComment = await post(`${videoId}/comments`, "Nguồn tham khảo:\n" + links.map((u) => `- ${u}`).join("\n"));
  ctx.log(`[facebook] extras ${videoId}: ${JSON.stringify(extra)}`);
  return { ...res, extra };
}

/** Bài Page = article + "Nguồn tham khảo:" ở cuối (≤ 4990 ký tự; cắt bớt article nếu cần). */
export function fbArticleWithSources(article: string, links: string[], asComment = false): string {
  let a = article.trim().replace(/\n*\(Link nguồn tham khảo ở bình luận\.\)\n*/g, "\n\n").trim();
  if (!a || asComment || !links.length || a.includes("Nguồn tham khảo:")) return a.slice(0, 4990);
  const block = "\n\nNguồn tham khảo:\n" + links.map((u) => `- ${u}`).join("\n");
  const room = 4990 - block.length;
  if (a.length > room) a = a.slice(0, room - 2).replace(/\s+\S*$/, "") + " …";
  return a + block;
}
