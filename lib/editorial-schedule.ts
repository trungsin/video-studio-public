import fs from "node:fs";
import path from "node:path";
import { addDays, DATA_DIR, getIdea, getProfile, getSchedule, listVideos, localDate, MEDIA_DIR, saveSchedule, slotInstant, withScheduleLock, writeJson } from "./data";
import { editorialValid } from "./editorial-production";
import { editorialProfile } from "./channel-config";
import { guardPublish } from "./owner";
import { directEnvForProfile } from "./profile-env";
import { pickReal, DIRECT } from "./publishers";
import { tiktokConsentValid } from "./tiktok";
import type { Platform, Profile, ScheduleEntry, Video } from "./types";

export interface EditorialScheduleConfig { enabled: boolean; publishEnabled: boolean; paused: boolean; suppressedDates: string[] }
export const EDITORIAL_TIME = "07:00";
export const EDITORIAL_LUNCH_TIME = "11:30";
const EDITORIAL_SLOTS = [{ slot: "sang", time: EDITORIAL_TIME }, { slot: "trua", time: EDITORIAL_LUNCH_TIME }] as const;
const HORIZON = 7;
const configFile = () => path.join(DATA_DIR, "editorial-schedule.json");
const initial: EditorialScheduleConfig = { enabled: false, publishEnabled: false, paused: false, suppressedDates: [] };

export function readEditorialScheduleConfig(): EditorialScheduleConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    return { enabled: raw.enabled === true, publishEnabled: raw.publishEnabled === true, paused: raw.paused === true,
      suppressedDates: Array.isArray(raw.suppressedDates) ? raw.suppressedDates.filter((d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [] };
  } catch { return { ...initial, suppressedDates: [] }; }
}

/** Call only inside withScheduleLock; removal and suppression must be one transaction. */
export function saveEditorialScheduleConfig(cfg: EditorialScheduleConfig): void {
  writeJson(configFile(), cfg);
}

export function editorialRevision(video: Video): ScheduleEntry["editorial"] | null {
  const idea = getIdea(video.ideaId);
  if (!idea || !editorialValid(idea, video) || !video.editorial?.renderId || !video.render.finishedAt
    || video.editorial.renderId !== video.render.finishedAt) return null;
  return { evidenceDigest: video.editorial.evidenceDigest, scriptDigest: video.editorial.scriptDigest, renderId: video.editorial.renderId };
}

export function allowedEditorialPlatforms(profile: Profile, video: Video): { platforms: Platform[]; blocked: string[] } {
  const platforms: Platform[] = [], blocked: string[] = [];
  if (profile.sample) return { platforms, blocked: ["Profile mẫu không được đăng thật"] };
  for (const ch of profile.channels) {
    if (!ch.connected) { blocked.push(`${ch.platform}: chưa kết nối`); continue; }
    const adapter = pickReal(ch.platform, ch, process.env, profile.slug);
    if (!adapter || (ch.via === "zernio" && (!ch.accountId || adapter.name !== "zernio"))) {
      blocked.push(`${ch.platform}: chưa cấu hình kết nối xuất bản`); continue;
    }
    const ownerError = guardPublish(ch.platform, profile, DIRECT.includes(adapter), directEnvForProfile(ch.platform, profile.slug, { ...process.env, PUBLISH_DRY_RUN: "0" }));
    if (ownerError) { blocked.push(`${ch.platform}: ${ownerError}`); continue; }
    if (ch.platform === "tiktok" && !tiktokConsentValid(video)) { blocked.push("tiktok: cần xác nhận riêng cho bản render này"); continue; }
    if (!platforms.includes(ch.platform)) platforms.push(ch.platform);
  }
  return { platforms, blocked };
}

export interface EditorialProposal { date: string; slot: "sang" | "trua"; time: string; videoId: string; title: string; pillar: string; platforms: Platform[]; blocked: string[]; editorial: NonNullable<ScheduleEntry["editorial"]> }
export interface EditorialPreview { proposals: EditorialProposal[]; blockers: string[]; config: EditorialScheduleConfig }

/** Pure calendar decision from a snapshot; no writes or implicit enablement. */
export function planEditorial(now: Date, entries: ScheduleEntry[], cfg: EditorialScheduleConfig, videos: Video[], profile: Profile | null): EditorialPreview {
  const proposals: EditorialProposal[] = [], blockers: string[] = [];
  if (!profile || profile.slug !== editorialProfile()) return { proposals, blockers: [editorialProfile() ? `Không tìm thấy profile ${editorialProfile()}` : "Chưa đặt EDITORIAL_PROFILE"], config: cfg };
  const slug = profile.slug;
  const used = new Set(entries.filter((e) => e.profile === slug && e.videoId).map((e) => e.videoId));
  const pool = videos.filter((v) => v.profile === slug && v.status === "done" && v.render.state === "done"
    && v.render.output && fs.existsSync(path.join(MEDIA_DIR, v.render.output))
    && !((v.publish || []).some((r) => r.ok && !r.via.startsWith("dry-run"))) && !used.has(v.id)
    && editorialRevision(v))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  if (!pool.length) blockers.push("Chưa có video hoàn tất, nguồn/kịch bản được duyệt và bản render còn hiệu lực");
  const today = localDate(now);
  const previous = entries.filter((e) => e.profile === slug && e.videoId && e.status !== "failed")
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).at(-1);
  let lastPillar = previous?.ideaId ? getIdea(previous.ideaId)?.pillar : undefined;
  for (let d = 0; d < HORIZON && pool.length; d++) {
    const date = addDays(today, d);
    if (cfg.suppressedDates.includes(date)) continue;
    const dayEntries = entries.filter((e) => e.profile === slug && e.date === date);
    let added = 0;
    for (const { slot, time } of EDITORIAL_SLOTS) {
      if (!pool.length || slotInstant(date, time) <= now) continue;
      if (dayEntries.length + added >= EDITORIAL_SLOTS.length
        || dayEntries.some((e) => e.slot === slot || e.time === time)) continue;
      const selected = pool.find((v) => getIdea(v.ideaId)?.pillar !== lastPillar) || pool[0];
      const { platforms, blocked } = allowedEditorialPlatforms(profile, selected);
      blockers.push(...blocked.map((reason) => `${selected.title}: ${reason}`));
      if (!platforms.length) { blockers.push(`${selected.title}: không có nền tảng xuất bản hợp lệ`); return { proposals, blockers, config: cfg }; }
      const revision = editorialRevision(selected)!;
      const pillar = getIdea(selected.ideaId)?.pillar || "";
      proposals.push({ date, slot, time, videoId: selected.id, title: selected.title, pillar, platforms, blocked, editorial: revision });
      pool.splice(pool.indexOf(selected), 1);
      lastPillar = pillar;
      added++;
    }
  }
  return { proposals, blockers, config: cfg };
}

export function editorialPreview(now = new Date()): EditorialPreview {
  return planEditorial(now, getSchedule(), readEditorialScheduleConfig(), (editorialProfile() ? listVideos(editorialProfile()) : []), (editorialProfile() ? getProfile(editorialProfile()) : null));
}

/** Tick remains a no-op until the owner explicitly enables it. Recompute under the shared lock. */
export function editorialScheduleTick(now = new Date()): EditorialPreview {
  return withScheduleLock(() => {
    const cfg = readEditorialScheduleConfig();
    const entries = getSchedule();
    const slug = editorialProfile();
    if (!slug) return planEditorial(now, entries, cfg, [], null);   // không có profile biên tập: không rút/đặt lịch nào
    const profile = getProfile(slug);
    const videos = listVideos(slug);
    // Future reservations with stale revisions are withdrawn; active/published posts are immutable.
    const retained = entries.filter((e) => {
      if (e.profile !== slug || !e.editorial || e.status !== "planned" || slotInstant(e.date, e.time) <= now) return true;
      const video = e.videoId && videos.find((v) => v.id === e.videoId);
      const rev = video && editorialRevision(video);
      return Boolean(rev && video!.status === "done" && video!.render.state === "done" && video!.render.output
        && fs.existsSync(path.join(MEDIA_DIR, video!.render.output))
        && !((video!.publish || []).some((r) => r.ok && !r.via.startsWith("dry-run")))
        && rev.evidenceDigest === e.editorial!.evidenceDigest && rev.scriptDigest === e.editorial!.scriptDigest && rev.renderId === e.editorial!.renderId);
    });
    // Withdrawal is safe even when new scheduling is paused.
    if (retained.length !== entries.length) saveSchedule(retained);
    const preview = planEditorial(now, retained, cfg, videos, profile);
    if (!cfg.enabled || cfg.paused || !preview.proposals.length) return preview;
    for (const p of preview.proposals) retained.push({ id: `editorial-${slug}-${p.date}-${p.time.replace(":", "")}-${p.videoId}-${p.editorial.renderId.replace(/[^a-z0-9]/gi, "").slice(0, 32)}`,
      profile: slug, date: p.date, time: p.time, slot: p.slot, ideaId: videos.find((v) => v.id === p.videoId)!.ideaId,
      videoId: p.videoId, platforms: p.platforms, status: "planned", auto: true, editorial: p.editorial,
      note: p.blocked.length ? `Tự động · chỉ ${p.platforms.join(", ")} · chưa thể đăng: ${p.blocked.join("; ")}` : `Tự động · ${p.platforms.join(", ")}` });
    saveSchedule(retained);
    return preview;
  });
}
