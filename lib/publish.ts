import { isEditorial } from "./channel-config";
import path from "node:path";
import fs from "node:fs";
import { getIdea, getProfile, getSchedule, getVideo, MEDIA_DIR, saveIdea, saveSchedule, saveVideo, setIdeaStatus, slotInstant, withScheduleLock } from "./data";
import { cdnFor, pushRef } from "./cdn";
import { publishTo } from "./publishers";
import { aiDisclosureOn, aiDisclosureText, withAiLine } from "./publishers/ai";
import { tiktokConsentValid } from "./tiktok";
import { allowedEditorialPlatforms, editorialRevision, readEditorialScheduleConfig } from "./editorial-schedule";
import type { Platform, Profile, PublishResult, ScheduleEntry, TikTokPostSettings, Video } from "./types";

/** Caption cuối cùng: caption + dòng khai báo AI (trước hashtag để không bị cắt) + hashtag. */
export function buildCaption(v: Video, p?: Profile | null): { caption: string; ai: boolean } {
  const ai = aiDisclosureOn(v, p);
  const credits = v.credits && !(v.caption || "").includes(v.credits) ? v.credits : "";
  const caption = [withAiLine(v.caption || "", ai, (v.aiDisclosureText || "").trim() || aiDisclosureText(p)), credits, (v.hashtags || []).join(" ")].filter(Boolean).join("\n\n");
  return { caption, ai };
}

export interface PublishOpts {
  /** Đăng thật cho lần này dù PUBLISH_DRY_RUN=1 (lệnh đăng thử đã duyệt / scheduler tự động) */
  live?: boolean;
  youtubePrivacy?: "public" | "unlisted" | "private";
  /** Cài đặt TikTok áp cho video chưa có xác nhận riêng (scheduler: người dùng đã duyệt đăng tự động công khai) */
  tiktokAuto?: TikTokPostSettings;
  /** Gọi sau mỗi nền tảng (scheduler lưu tiến độ để chống đăng trùng khi bị ngắt) */
  onResult?: (r: PublishResult) => void;
  onStart?: (p: Platform) => void;
}

/** Kết quả đăng thật (không phải dry-run) thành công. */
export const realSuccess = (r: PublishResult) => r.ok && !String(r.via || "").startsWith("dry-run");

/** Đăng một video lên danh sách nền tảng; cập nhật video/idea. Chỉ kết quả đăng THẬT mới chuyển trạng thái sang published. */
export async function publishVideo(videoId: string, platforms: Platform[], opts: PublishOpts = {}): Promise<PublishResult[]> {
  const v = getVideo(videoId);
  if (!v) throw new Error("Không tìm thấy video");
  if (v.render.state !== "done" || !v.render.output) throw new Error("Video chưa render xong");
  const file = path.join(MEDIA_DIR, v.render.output);
  if (!fs.existsSync(file)) throw new Error(`Thiếu file ${v.render.output}`);
  const p = getProfile(v.profile);
  const videoUrl = await cdnVideoUrl(v, !opts.live && process.env.PUBLISH_DRY_RUN === "1");
  const { caption, ai } = buildCaption(v, p);
  const results: PublishResult[] = [];
  for (const plat of platforms) {
    const ch = p?.channels.find((c) => c.platform === plat);
    let tiktok = plat === "tiktok" && v.tiktok ? { ...v.tiktok, consentValid: tiktokConsentValid(v) } : undefined;
    if (plat === "tiktok" && !tiktok?.consentValid && opts.tiktokAuto) tiktok = { ...opts.tiktokAuto, consentValid: true };
    opts.onStart?.(plat);
    const r = await publishTo({ videoPath: file, videoUrl, title: v.title, caption, platform: plat, ...fbExtrasOf(v), aiGenerated: ai, tiktok, durationSec: v.render.duration, youtubePrivacy: opts.youtubePrivacy }, ch, p, { live: opts.live });
    results.push(r);
    opts.onResult?.(r);
    // lưu ngay từng nền tảng để không mất kết quả nếu tiến trình bị ngắt giữa chừng
    const cur = getVideo(videoId) || v;
    cur.publish = [...(cur.publish || []), r];
    saveVideo(cur);
    v.publish = cur.publish;
  }
  if (results.some(realSuccess)) {
    v.status = "published";
    const i = getIdea(v.ideaId);
    if (i && i.status !== "published") { setIdeaStatus(i, "published", results.filter(realSuccess).map((r) => r.platform).join(", ")); saveIdea(i); }
  }
  const latest = getVideo(videoId) || v;
  if (results.some(realSuccess)) latest.status = "published";
  saveVideo(latest);
  return results;
}

/** An interrupted attempt might have succeeded remotely. Reconciliation is manual, never automatic replay. */
export function recoverDuePublishing(now = new Date(), log = console.log): number {
  return withScheduleLock(() => {
    const entries = getSchedule();
    let recovered = 0;
    for (const e of entries) {
      if ((e.auto && !e.editorial) || e.status !== "publishing" || (e.startedAt && now.getTime() - new Date(e.startedAt).getTime() < 2 * 3600e3)) continue;
      const completed = new Set((e.results || []).map((r) => r.platform));
      const at = now.toISOString();
      if (e.inflight && !completed.has(e.inflight)) {
        e.results = [...(e.results || []), { platform: e.inflight, ok: false, via: "reconciliation", at,
          error: "Đăng dở khi worker ngắt: có thể đã đăng. Kiểm tra thủ công trên nền tảng, không tự đăng lại." }];
        completed.add(e.inflight);
      }
      for (const platform of e.platforms) if (!completed.has(platform)) e.results = [...(e.results || []),
        { platform, ok: false, via: "reconciliation", at, error: "Chưa có xác nhận đăng; cần kiểm tra thủ công." }];
      e.status = (e.results || []).some(realSuccess) ? "published" : "failed";
      e.note = "Cần đối soát thủ công sau gián đoạn; không tự đăng lại";
      e.finishedAt = at;
      delete e.inflight;
      recovered++;
      log(`[reconcile] ${e.id}: ${e.note}`);
    }
    if (recovered) saveSchedule(entries);
    return recovered;
  });
}

/** Reserve each due slot atomically; release the lock during remote I/O. */
export async function runDuePublishing(now = new Date(), graceHours = 12, log = console.log) {
  recoverDuePublishing(now, log);
  const candidates = getSchedule().filter((e) => e.status === "planned" && slotInstant(e.date, e.time) <= now
    && now.getTime() - slotInstant(e.date, e.time).getTime() < graceHours * 3600e3);
  const done: ScheduleEntry[] = [];
  for (const candidate of candidates) {
    const reserved = withScheduleLock(() => {
      const entries = getSchedule();
      const e = entries.find((item) => item.id === candidate.id);
      if (!e || e.status !== "planned" || slotInstant(e.date, e.time) > now || now.getTime() - slotInstant(e.date, e.time).getTime() >= graceHours * 3600e3) return null;
      if (isEditorial(e.profile)) {
        if (!readEditorialScheduleConfig().publishEnabled) return null;
        if (!e.editorial) {
          e.status = "failed"; e.note = "Thiếu dấu vết phê duyệt nguồn/kịch bản/render; cần đối soát thủ công";
          e.finishedAt = now.toISOString(); saveSchedule(entries); return null;
        }
      }
      const idea = e.ideaId ? getIdea(e.ideaId) : null;
      const vid = e.videoId || idea?.videoId;
      const v = vid ? getVideo(vid) : null;
      if (!v || v.render.state !== "done" || !(v.status === "done" || v.status === "published") || !v.render.output || !fs.existsSync(path.join(MEDIA_DIR, v.render.output))) {
        log(`[skip] ${e.id}: video chưa sẵn sàng`);
        return null;
      }
      // Không tự đăng lại nền tảng mà video đã có bài đăng thật (slot trùng sau khi đã đăng ở khung khác).
      const posted = new Set((v.publish || []).filter(realSuccess).map((r) => r.platform));
      if (e.platforms.some((platform) => posted.has(platform))) {
        const rest = e.platforms.filter((platform) => !posted.has(platform));
        if (!rest.length) {
          e.status = "failed"; e.note = "Video đã đăng thật trên các nền tảng của khung này; không tự đăng lại";
          e.finishedAt = now.toISOString(); saveSchedule(entries); return null;
        }
        e.note = `Bỏ ${e.platforms.filter((platform) => posted.has(platform)).join(", ")}: video đã đăng thật ở khung khác`;
        e.platforms = rest;
      }
      if (e.editorial) {
        const rev = editorialRevision(v);
        if (!idea || !rev || v.status !== "done" || rev.evidenceDigest !== e.editorial.evidenceDigest
          || rev.scriptDigest !== e.editorial.scriptDigest || rev.renderId !== e.editorial.renderId) {
          e.status = "failed"; e.note = "Nguồn, kịch bản hoặc bản render đã thay đổi; cần đối soát thủ công";
          e.finishedAt = now.toISOString(); saveSchedule(entries); return null;
        }
        const profile = getProfile(e.profile);
        const allowed = profile ? allowedEditorialPlatforms(profile, v).platforms : [];
        if (!e.platforms.length || e.platforms.some((platform) => !allowed.includes(platform))) {
          e.status = "failed"; e.note = "Kênh đăng đã ngắt hoặc quyền TikTok hết hiệu lực; cần đối soát thủ công";
          e.finishedAt = now.toISOString(); saveSchedule(entries); return null;
        }
      }
      if (!e.platforms.length) { e.status = "failed"; e.note = "Chưa chọn nền tảng đăng; không tự chọn Facebook"; e.finishedAt = now.toISOString(); saveSchedule(entries); return null; }
      e.status = "publishing"; e.videoId = v.id; e.startedAt = now.toISOString(); e.results = [];
      saveSchedule(entries);
      return { id: e.id, videoId: v.id, platforms: e.platforms, entry: e, video: v };
    });
    if (!reserved) continue;
    log(`[publish] ${candidate.date} ${candidate.time} ${reserved.videoId} -> ${reserved.platforms.join(", ")}`);
    const update = (fn: (entry: ScheduleEntry) => void) => withScheduleLock(() => {
      const entries = getSchedule();
      const e = entries.find((item) => item.id === reserved.id);
      if (!e || e.status !== "publishing") return;
      fn(e);
      saveSchedule(entries);
    });
    try {
      // autopublish imports this module; load its approval rules only after reserving the slot.
      const approved = reserved.platforms.includes("tiktok")
        ? (await import("./autopublish")).scheduledAutoSettings(reserved.entry, reserved.video)
        : null;
      await publishVideo(reserved.videoId, reserved.platforms, {
        ...(approved || {}),
        onStart: (platform) => update((entry) => { entry.inflight = platform; }),
        onResult: (result) => update((entry) => {
          entry.results = [...(entry.results || []), result]; delete entry.inflight;
          log(`   ${realSuccess(result) ? "✓" : "✗"} ${result.platform} via ${result.via}${result.error ? `: ${result.error}` : ""}`);
        }),
      });
    } catch (err) {
      update((entry) => { entry.note = `Lỗi không xác định khi đăng: ${(err as Error).message}; kiểm tra thủ công trước khi đăng lại`; });
    }
    withScheduleLock(() => {
      const entries = getSchedule();
      const e = entries.find((item) => item.id === reserved.id);
      if (!e || e.status !== "publishing") return;
      const results = e.results || [];
      const unresolved = e.platforms.filter((platform) => !results.some((r) => r.platform === platform));
      if (e.inflight || unresolved.length) {
        for (const platform of unresolved) results.push({ platform, ok: false, at: new Date().toISOString(), via: "reconciliation",
          error: "Kết quả không rõ, cần kiểm tra thủ công trước khi đăng lại" });
      }
      e.results = results;
      e.status = results.some(realSuccess) ? "published" : "failed";
      e.finishedAt = new Date().toISOString();
      const video = getVideo(reserved.videoId);
      const revision = video && editorialRevision(video);
      if (e.editorial && (!revision || revision.evidenceDigest !== e.editorial.evidenceDigest
        || revision.scriptDigest !== e.editorial.scriptDigest || revision.renderId !== e.editorial.renderId))
        e.note = "Nội dung đổi trong lúc đăng: cần đối soát thủ công bài đã gửi";
      else if (e.inflight || unresolved.length) e.note = "Kết quả đăng không rõ; cần đối soát thủ công";
      else if (results.some((r) => r.ok && !realSuccess(r))) e.note = "Dry-run: chưa đăng thật";
      else if (results.some((r) => !realSuccess(r))) e.note = "Một số nền tảng chưa đăng; kiểm tra thủ công trước khi thử lại";
      delete e.inflight;
      saveSchedule(entries);
      done.push(e);
    });
  }
  return { checked: getSchedule().length, due: candidates.length, published: done.filter((d) => d.status === "published").length, failed: done.filter((d) => d.status === "failed").length };
}

/** Record có `article` (+ `sources`) -> FB đăng thêm bài Page kèm nguồn. */
function fbExtrasOf(v: unknown): { article?: string; sourceLinks?: string[] } {
  const r = v as { article?: unknown; sources?: unknown };
  if (typeof r.article !== "string" || !r.article.trim()) return {};
  return { article: r.article, sourceLinks: Array.isArray(r.sources) ? r.sources.filter((x): x is string => typeof x === "string") : [] };
}

/**
 * URL CDN của MP4 sẽ đăng (profile có MYCDN_API_KEY__<SLUG>). Đăng thật: chưa có trên CDN thì đẩy ngay;
 * CDN lỗi thì trả undefined để publisher gửi byte từ file local như trước, không làm hỏng lượt đăng.
 * Dry-run: chỉ tra manifest, không gọi mạng.
 */
async function cdnVideoUrl(v: Video, dry: boolean): Promise<string | undefined> {
  const ref = v.render.output!;
  if (dry) return cdnFor(ref)?.url;
  try { return (await pushRef(v.profile, ref, { log: (s) => console.log(`[cdn] ${s}`) }))?.entry.url; }
  catch (e) { console.warn(`[cdn] ${v.id}: ${(e as Error).message} -> đăng bằng file local`); return undefined; }
}
