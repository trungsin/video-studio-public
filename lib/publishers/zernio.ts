import fs from "node:fs";
import path from "node:path";
import { validateTikTokInput } from "../tiktok";
import { zernioEnvForProfile } from "../zernio-connect";
import { fileStream, num, realCtx, redact, STREAM_INIT } from "./http";
import type { PublishCtx, PublishJob, Publisher } from "./types";

/**
 * Zernio (https://docs.zernio.com) — aggregator đăng lên nhiều nền tảng bằng một API key.
 *   1) POST /v1/media/presign {filename, contentType} -> {uploadUrl, publicUrl}
 *   2) PUT file lên uploadUrl (KHÔNG gửi Authorization, cùng Content-Type)
 *   3) POST /v1/posts {content, mediaItems:[{url,type:"video"}], platforms:[{platform, accountId, platformSpecificData}], publishNow:true}
 *      (207 = đã tạo nhưng đăng chưa trọn vẹn; đọc post.status / platformResults)
 *   4) Nếu nền tảng còn pending/processing/uploading: GET /v1/posts/{id} tới khi published/failed
 * TikTok (docs.zernio.com/platforms/tiktok):
 *   - GET /v1/accounts/{id}/tiktok/creator-info: privacyLevels, interactionSettings, canPostMore, maxVideoDurationSec
 *   - tiktokSettings bắt buộc: privacy_level (người dùng tự chọn), allow_comment/allow_duet/allow_stitch,
 *     content_preview_confirmed, express_consent_given (chỉ true khi người dùng đã xác nhận trong app),
 *     video_made_with_ai, draft (Creator Inbox), commercialContentType
 *   - Kiểm tra trước bằng POST /v1/posts {dryRun:true} -> {canPublish, tiktok:[verdict]}
 * Khai báo AI: youtube containsSyntheticMedia, instagram isAiGenerated, tiktok video_made_with_ai;
 *   facebook: Zernio chưa có cờ AI -> dòng khai báo trong caption, contentType "reel".
 * Chưa chạy thử với key thật.
 */
const base = (env: PublishCtx["env"]) => (env.ZERNIO_BASE_URL || "https://zernio.com/api/v1").replace(/\/$/, "");

/** Bind all Zernio operations (accounts, OAuth, creator info and publishing) to the same profile key. */
export function zernioCtxForProfile(slug?: string, ctx: PublishCtx = realCtx()): PublishCtx {
  const env = zernioEnvForProfile(slug, ctx.env);
  return env === ctx.env ? ctx : { ...ctx, env };
}

async function api<T>(ctx: PublishCtx, method: string, p: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  if (!ctx.env.ZERNIO_API_KEY) throw new Error("Chưa cấu hình ZERNIO_API_KEY cho profile");
  const r = await ctx.fetch(`${base(ctx.env)}${p}`, {
    method,
    headers: { authorization: `Bearer ${ctx.env.ZERNIO_API_KEY}`, "content-type": "application/json", ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) {
    let msg = txt.slice(0, 300);
    try { const j = JSON.parse(txt); msg = [j.error, j.type, j.code, j.param].filter(Boolean).join(" | ") || msg; } catch { /* text */ }
    throw new Error(redact(`Zernio ${method} ${p} ${r.status}: ${msg}`));
  }
  return { status: r.status, data: (txt ? JSON.parse(txt) : {}) as T };
}

export async function zernioListAccounts(ctx: PublishCtx = realCtx()): Promise<{ _id: string; platform: string; username?: string; displayName?: string; isActive?: boolean }[]> {
  const { data: j } = await api<{ accounts?: any[] } | any[]>(ctx, "GET", "/accounts");
  return Array.isArray(j) ? j : j.accounts || [];
}

/** Profile Zernio để gắn tài khoản mới: ZERNIO_PROFILE_ID, nếu không có thì profile mặc định. */
export async function zernioProfileId(ctx: PublishCtx = realCtx()): Promise<string> {
  if (ctx.env.ZERNIO_PROFILE_ID) return ctx.env.ZERNIO_PROFILE_ID;
  const { data } = await api<{ profiles?: { _id: string; isDefault?: boolean }[] }>(ctx, "GET", "/profiles");
  const ps = data.profiles || [];
  const p = ps.find((x) => x.isDefault) || ps[0];
  if (!p) throw new Error("Zernio chưa có profile nào");
  return p._id;
}

/** URL OAuth để người dùng tự kết nối tài khoản (GET /v1/connect/{platform}); Zernio chuyển về redirectUrl sau khi xong. */
export async function zernioConnectUrl(platform: string, redirectUrl: string, ctx: PublishCtx = realCtx()): Promise<string> {
  const profileId = await zernioProfileId(ctx);
  const q = new URLSearchParams({ profileId, redirect_url: redirectUrl });
  const { data } = await api<{ authUrl?: string }>(ctx, "GET", `/connect/${encodeURIComponent(platform)}?${q}`);
  if (!data.authUrl) throw new Error("Zernio không trả authUrl");
  return data.authUrl;
}

export async function zernioUpload(file: string, ctx: PublishCtx = realCtx()): Promise<string> {
  const size = fs.statSync(file).size;
  const { data: pre } = await api<{ uploadUrl: string; publicUrl: string }>(ctx, "POST", "/media/presign", { filename: path.basename(file), contentType: "video/mp4", size });
  const put = await ctx.fetch(pre.uploadUrl, { ...STREAM_INIT, method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(size) }, body: fileStream(file) });
  if (!put.ok) throw new Error(`Zernio upload ${put.status}`);
  return pre.publicUrl;
}

export interface TikTokCreatorInfo {
  creator?: { nickname?: string; isVerified?: boolean; canPostMore?: boolean };
  privacyLevels?: { value: string; label?: string }[];
  postingLimits?: { maxVideoDurationSec?: number; interactionSettings?: Record<string, { enabled?: boolean; required?: boolean; default?: boolean; label?: string } | null> };
  commercialContentTypes?: { value: string; label?: string }[];
}

export async function zernioTikTokCreatorInfo(accountId: string, ctx: PublishCtx = realCtx()): Promise<TikTokCreatorInfo> {
  const { data } = await api<TikTokCreatorInfo>(ctx, "GET", `/accounts/${encodeURIComponent(accountId)}/tiktok/creator-info?mediaType=video`);
  return data;
}

/** tiktokSettings từ lựa chọn của người dùng; ném lỗi nếu thiếu lựa chọn/xác nhận. */
export function zernioTikTokSettings(job: PublishJob, info?: TikTokCreatorInfo): Record<string, unknown> {
  const t = job.tiktok;
  if (!t) throw new Error("TikTok: chưa có cài đặt đăng. Mở video, chọn quyền riêng tư và bấm xác nhận ở mục TikTok");
  const allowed = info?.privacyLevels?.map((p) => p.value);
  const err = validateTikTokInput(t, allowed);
  if (err) throw new Error(`TikTok: ${err}`);
  if (!t.consentValid) throw new Error("TikTok: chưa xác nhận (xem lại video + đồng ý Music Usage Confirmation) cho bản render hiện tại");
  const inter = info?.postingLimits?.interactionSettings || {};
  const on = (k: "allow_comment" | "allow_duet" | "allow_stitch", v?: boolean) => Boolean(v) && inter[k]?.enabled !== false;
  const s: Record<string, unknown> = {
    privacy_level: t.privacyLevel,
    allow_comment: on("allow_comment", t.allowComment),
    allow_duet: on("allow_duet", t.allowDuet),
    allow_stitch: on("allow_stitch", t.allowStitch),
    content_preview_confirmed: true,
    express_consent_given: true,
    video_made_with_ai: job.aiGenerated !== false,
  };
  if (t.draft) s.draft = true;
  if (t.commercial && t.commercial !== "none") s.commercialContentType = t.commercial;
  return s;
}

/** platformSpecificData theo nền tảng (gồm cờ AI). TikTok dùng tiktokSettings riêng. */
export function zernioPlatformData(job: PublishJob): Record<string, unknown> {
  const ai = job.aiGenerated !== false;
  switch (job.platform) {
    case "youtube": return { title: job.title.slice(0, 100), containsSyntheticMedia: ai };
    case "instagram": return { isAiGenerated: ai };
    case "facebook": return { contentType: "reel" };
    case "threads": { const t = threadsTopicTag(job.caption); return t ? { topic_tag: t } : {}; }
    default: return {};
  }
}

export const THREADS_LIMIT = 500;
const isTagPara = (p: string) => /^(#[^\s#]+\s*)+$/u.test(p.trim());

/** Topic tag Threads: hashtag đầu tiên, bỏ "#", "." và "&", tối đa 50 ký tự. */
export function threadsTopicTag(caption: string): string | undefined {
  const m = caption.match(/#([^\s#]+)/u);
  const t = m?.[1].replace(/[.&]/g, "").slice(0, 50);
  return t || undefined;
}

/**
 * Caption Threads tối đa 500 ký tự: bỏ khối hashtag trước, giữ đoạn cuối ngắn (dòng khai báo AI), rồi cắt thân bài ở ranh giới từ.
 */
export function fitThreads(caption: string, limit = THREADS_LIMIT): string {
  const c = caption.trim();
  if ([...c].length <= limit) return c;
  let paras = c.split(/\n{2,}/);
  while (paras.length > 1 && isTagPara(paras[paras.length - 1])) paras.pop();
  let s = paras.join("\n\n");
  if ([...s].length <= limit) return s;
  // ghi công ảnh (CC BY/BY-SA) phải giữ: cắt phần thân trước
  const ci = paras.findIndex((x) => x.startsWith("📷"));
  if (ci > 0) {
    const cred = paras.splice(ci, 1)[0];
    const room = limit - [...cred].length - 3;
    const body = [...paras.join("\n\n")];
    if (room > 80) {
      let cut = body.length > room ? body.slice(0, room).join("") : body.join("");
      if (body.length > room) { const sp = cut.search(/\s\S*$/u); if (sp > room * 0.6) cut = cut.slice(0, sp); cut = `${cut.trimEnd()}…`; }
      return `${cut}\n\n${cred}`;
    }
    paras.splice(ci, 0, cred);
  }
  const tail = paras.length > 1 && [...paras[paras.length - 1]].length <= 120 ? paras.pop()! : "";
  const room = limit - (tail ? [...tail].length + 2 : 0) - 1;
  const body = [...paras.join("\n\n")];
  let cut = body.slice(0, room).join("");
  const sp = cut.search(/\s\S*$/u);
  if (sp > room * 0.6) cut = cut.slice(0, sp);
  s = `${cut.trimEnd()}…${tail ? `\n\n${tail}` : ""}`;
  return s;
}

const PENDING = new Set(["pending", "processing", "uploading", "publishing", "scheduled"]);

export const zernio: Publisher = {
  name: "zernio",
  supports: () => true,
  configured: (env = process.env) => Boolean(env.ZERNIO_API_KEY),
  async publish(job, ctx = realCtx()) {
    if (!job.accountId) throw new Error(`Thiếu accountId Zernio cho ${job.platform} (bấm "Tải lại" ở Profile & kênh)`);
    const isTT = job.platform === "tiktok";
    let tiktokSettings: Record<string, unknown> | undefined;
    let nickname = "";
    if (isTT) {
      zernioTikTokSettings(job); // kiểm tra sớm, trước mọi request
      const info = await zernioTikTokCreatorInfo(job.accountId, ctx);
      nickname = info.creator?.nickname || "";
      if (info.creator?.canPostMore === false) return { platform: job.platform, ok: false, error: `TikTok @${nickname}: tài khoản hiện không thể đăng thêm, thử lại sau` };
      const max = info.postingLimits?.maxVideoDurationSec;
      if (max && job.durationSec && job.durationSec > max) return { platform: job.platform, ok: false, error: `TikTok: video ${Math.round(job.durationSec)}s dài hơn giới hạn ${max}s của tài khoản` };
      tiktokSettings = zernioTikTokSettings(job, info);
    }
    // MP4 đã trên CDN: Zernio tải thẳng từ URL công khai, bỏ presign + PUT
    const url = job.videoUrl || await zernioUpload(job.videoPath, ctx);
    const platformSpecificData = isTT ? { tiktokSettings } : zernioPlatformData(job);
    const body = {
      content: job.platform === "threads" ? fitThreads(job.caption) : job.caption,
      mediaItems: [{ url, type: "video" }],
      platforms: [{ platform: job.platform, accountId: job.accountId, ...(Object.keys(platformSpecificData).length ? { platformSpecificData } : {}) }],
      publishNow: true,
    };
    if (isTT && (ctx.env.ZERNIO_TIKTOK_DRYRUN ?? "1") !== "0") {
      const { data: v } = await api<any>(ctx, "POST", "/posts", { ...body, dryRun: true });
      if (v?.dryRun && v.canPublish === false) {
        const why = (v.tiktok || []).map((x: any) => x?.reason || x?.message).filter(Boolean).join("; ");
        return { platform: job.platform, ok: false, error: `TikTok (Zernio dryRun): chưa đăng được lúc này${why ? ` - ${why}` : ""}. Thử lại sau hoặc chọn gửi bản nháp` };
      }
    }
    const key = `${path.basename(job.videoPath)}-${job.platform}-${job.tiktok?.consentAt || ""}-${Date.now().toString(36)}`;
    const { data: res } = await api<any>(ctx, "POST", "/posts", body, { "Idempotency-Key": key });
    const postId: string | undefined = res.post?._id;
    let pf = res.post?.platforms?.[0] || {};
    const fromResults = (res.platformResults || []).find((x: any) => x.platform === job.platform);
    if (fromResults && !pf.status) pf = { ...pf, ...fromResults };

    // poll khi còn đang xử lý
    const interval = num(ctx.env, "ZERNIO_POLL_INTERVAL_MS", 10000), timeout = num(ctx.env, "ZERNIO_POLL_TIMEOUT_MS", 10 * 60e3);
    const t0 = Date.now();
    while (postId && PENDING.has(String(pf.status || ""))) {
      if (Date.now() - t0 + interval > timeout) {
        return { platform: job.platform, ok: false, id: postId, error: `Zernio: hết ${Math.round(timeout / 1000)}s chờ (status=${pf.status}). Post ${postId} vẫn có thể lên sau, kiểm tra trước khi đăng lại` };
      }
      await ctx.sleep(interval);
      let g: any;
      try { g = (await api<any>(ctx, "GET", `/posts/${encodeURIComponent(postId)}`)).data; } catch (e) {
        return { platform: job.platform, ok: false, id: postId, error: `Zernio đã tạo post ${postId} nhưng lỗi khi đọc trạng thái (${(e as Error).message}). Kiểm tra trước khi đăng lại` };
      }
      pf = (g.post?.platforms || []).find((x: any) => x.platform === job.platform) || g.post?.platforms?.[0] || pf;
    }
    // TikTok (Business) báo published trước, link bài (platformPostUrl) có sau vài chục giây
    let urlTries = Math.floor(num(ctx.env, "ZERNIO_URL_WAIT_MS", 120e3) / Math.max(interval, 1000));
    while (postId && pf.status === "published" && !pf.platformPostUrl && !pf.platformSpecificData?.isDraft && !job.tiktok?.draft && urlTries-- > 0) {
      await ctx.sleep(interval);
      try {
        const { data: g } = await api<any>(ctx, "GET", `/posts/${encodeURIComponent(postId)}`);
        pf = (g.post?.platforms || []).find((x: any) => x.platform === job.platform) || pf;
      } catch { break; } // đã published; thiếu link không phải lỗi
    }
    const failed = pf.status === "failed" || pf.status === "cancelled" || Boolean(pf.error) || (res.post?.status === "failed");
    if (failed) return { platform: job.platform, ok: false, id: postId, error: redact(String(pf.error || pf.errorMessage || res.error || "failed")) };
    const draft = isTT && (pf.platformSpecificData?.isDraft || job.tiktok?.draft);
    return {
      platform: job.platform, ok: true, id: postId, url: pf.platformPostUrl || undefined,
      ...(draft ? { note: `Đã gửi bản nháp vào hộp thư TikTok${nickname ? ` @${nickname}` : ""}: mở app TikTok để đăng (bật nhãn AI-generated)` } : {}),
    };
  },
};
