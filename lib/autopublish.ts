import { isEditorial } from "./channel-config";
import fs from "node:fs";
import path from "node:path";
import { addDays, DATA_DIR, getProfile, getSchedule, getVideo, listVideos, localDate, MEDIA_DIR, saveSchedule, slotInstant, withScheduleLock } from "./data";
import { publishVideo, realSuccess } from "./publish";
import type { Platform, PublishResult, ScheduleEntry, SlotKey, TikTokPostSettings, Video, VideoStatus } from "./types";

/**
 * Đăng tự động theo khung giờ cố định (VD 07:30 và 11:30 mỗi ngày):
 *  - mỗi khung lấy video kế tiếp trong hàng đợi (thứ tự đăng trong kế hoạch nội dung, rồi createdAt),
 *    chỉ video status review/done, đã render, chưa đăng thật, không nằm trong `exclude`;
 *  - đăng lên mọi nền tảng của cấu hình, lưu kết quả từng nền tảng vào data/schedule.json (khung auto-…);
 *  - nền tảng lỗi (chưa tạo bài: không có id) được thử lại đúng 1 lần sau retryDelayMin phút;
 *  - hết hàng đợi: ghi log, không làm gì.
 * Đăng THẬT chỉ khi config.live=true VÀ slug nằm trong AUTOPUBLISH_LIVE_PROFILES (env) VÀ profile không phải mẫu;
 * ngược lại đi theo PUBLISH_DRY_RUN như mọi lệnh đăng khác.
 * Cấu hình: data/autopublish.json  {"profiles":[AutoConfig,...]}. Chạy bởi worker/autopublish.ts (watchdog giữ sống).
 */
export interface AutoConfig {
  profile: string;
  enabled: boolean;
  /** HH:mm giờ địa phương (TZ_OFFSET, mặc định +07:00) */
  times: string[];
  platforms: Platform[];
  live: boolean;
  statuses?: VideoStatus[];
  exclude?: string[];
  youtubePrivacy?: "public" | "unlisted" | "private";
  /** Cài đặt TikTok cho video chưa xác nhận riêng (người dùng đã duyệt đăng tự động) */
  tiktok?: TikTokPostSettings;
  /** Trễ tối đa sau giờ khung vẫn đăng (phút), VD máy khởi động lại muộn */
  graceMin?: number;
  retryDelayMin?: number;
  /** File kế hoạch có "(vid-… · …, đăng #N)" để lấy thứ tự */
  planFile?: string;
  approvedAt?: string;
  approval?: string;
  /** Chỉ chọn video tạo trong ngày đăng, không lấy video cũ khi hết bản tin mới. */
  freshOnly?: boolean;
  /** Ưu tiên bản tin mới nhất hoặc thứ tự mặc định. */
  pick?: "oldest" | "newest";
  /** 0=Chủ nhật, 1=Thứ hai…6=Thứ bảy; không đặt nghĩa là mỗi ngày. */
  weekdays?: number[];
}

export const videoLocalDate = (v: Video) => { const t = Date.parse(v.createdAt || v.render?.finishedAt || ""); return Number.isFinite(t) ? localDate(new Date(t)) : ""; };
export const dayAllowed = (cfg: AutoConfig, date: string) => !cfg.weekdays?.length || cfg.weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());

const cfgFile = () => path.join(DATA_DIR, "autopublish.json");
const stateFile = () => path.join(DATA_DIR, "autopublish-state.json");
export const DEFAULT_STATUSES: VideoStatus[] = ["review", "done"];

export function loadAutoConfig(): AutoConfig[] {
  try { return (JSON.parse(fs.readFileSync(cfgFile(), "utf8")).profiles || []) as AutoConfig[]; } catch { return []; }
}

export function isLive(cfg: AutoConfig, env: Record<string, string | undefined> = process.env): boolean {
  const allow = (env.AUTOPUBLISH_LIVE_PROFILES || "").split(",").map((s) => s.trim()).filter(Boolean);
  const p = getProfile(cfg.profile);
  return Boolean(cfg.live && allow.includes(cfg.profile) && p && !p.sample);
}

/** A pre-booked slot may use channel-wide TikTok consent only within the owner's approved automatic schedule. */
export function scheduledAutoSettings(e: ScheduleEntry, v: Video, configs: AutoConfig[] = loadAutoConfig()) {
  if (e.editorial || !e.platforms.includes("tiktok")) return null;
  const cfg = configs.find((c) => c.profile === e.profile && c.enabled && c.live
    && c.approvedAt && c.approval && c.tiktok?.privacyLevel
    && c.times.includes(e.time) && c.platforms.includes("tiktok")
    && e.platforms.every((platform) => c.platforms.includes(platform))
    && (c.statuses || DEFAULT_STATUSES).includes(v.status)
    && !c.exclude?.includes(v.id));
  if (!cfg || v.profile !== e.profile || getProfile(e.profile)?.sample !== false) return null;
  return {
    youtubePrivacy: cfg.youtubePrivacy,
    tiktokAuto: { ...cfg.tiktok!, consentAt: cfg.approvedAt, consentText: cfg.approval },
  };
}

/** Thứ tự đăng từ kế hoạch: "(vid-su-12 · E04, Nhân vật, đăng #5)" -> vid-su-12 => 5. */
export function planOrder(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of text.matchAll(/\((vid-[\w-]+)\s*·[^)]*?đăng\s*#(\d+)\)/gu)) if (!m.has(x[1])) m.set(x[1], Number(x[2]));
  return m;
}
function readPlan(cfg: AutoConfig): Map<string, number> {
  const f = cfg.planFile || process.env.CONTENT_PLAN_FILE;
  if (!f) return new Map();
  try { return planOrder(fs.readFileSync(f, "utf8")); } catch { return new Map(); }
}

export const alreadyPublished = (v: Video) => v.status === "published" || (v.publish || []).some(realSuccess);

/** Hàng đợi video sẽ đăng (đã sắp thứ tự). */
export function autoQueue(cfg: AutoConfig, entries: ScheduleEntry[] = getSchedule(), date?: string): Video[] {
  const statuses = cfg.statuses || DEFAULT_STATUSES;
  const exclude = new Set(cfg.exclude || []);
  const taken = new Set(entries.filter((e) => e.videoId && e.status !== "planned").map((e) => e.videoId!));
  const order = readPlan(cfg);
  return listVideos(cfg.profile)
    .filter((v) => statuses.includes(v.status) && v.render?.state === "done" && v.render.output && fs.existsSync(path.join(MEDIA_DIR, v.render.output))
      && !alreadyPublished(v) && !exclude.has(v.id) && !taken.has(v.id) && (!cfg.freshOnly || (!!date && videoLocalDate(v) === date)))
    .sort((a, b) => cfg.pick === "newest"
      ? (b.createdAt || "").localeCompare(a.createdAt || "") || b.id.localeCompare(a.id)
      : (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6) || (a.createdAt || "").localeCompare(b.createdAt || "") || a.id.localeCompare(b.id));
}

export const slotKeyFor = (time: string): SlotKey => { const h = Number(time.slice(0, 2)); return h < 11 ? "sang" : h < 15 ? "trua" : h < 19 ? "chieu" : "toi"; };
export const autoEntryId = (profile: string, date: string, time: string) => `auto-${profile}-${date}-${time.replace(":", "")}`;

/** Các khung sắp tới (chưa có khung đã chạy) và video dự kiến; khung đầu tiên không còn video = ngày hết hàng. */
export function projectSlots(cfg: AutoConfig, now = new Date(), days = 14, entries: ScheduleEntry[] = getSchedule()) {
  const q = cfg.freshOnly ? [] : autoQueue(cfg, entries);
  const used = new Set<string>();
  const out: { date: string; time: string; at: Date; video?: Pick<Video, "id" | "title"> }[] = [];
  const today = localDate(now);
  const grace = (cfg.graceMin ?? 90) * 60e3;
  for (let d = 0; d < days; d++) {
    const date = addDays(today, d);
    if (!dayAllowed(cfg, date)) continue;
    for (const time of [...cfg.times].sort()) {
      const at = slotInstant(date, time);
      if (at.getTime() + grace < now.getTime()) continue;
      if (entries.some((e) => e.id === autoEntryId(cfg.profile, date, time))) continue;
      const v = (cfg.freshOnly ? autoQueue(cfg, entries, date) : q).find((x) => !used.has(x.id));
      if (v) used.add(v.id);
      out.push({ date, time, at, video: v ? { id: v.id, title: v.title } : undefined });
    }
  }
  return { slots: out, queued: out.filter((s) => s.video).length, runsOut: out.find((s) => !s.video) };
}

// ---------- trạng thái worker (heartbeat + log ngắn cho UI) ----------
export function writeState(patch: Record<string, unknown>) {
  let s: Record<string, unknown> = {};
  try { s = JSON.parse(fs.readFileSync(stateFile(), "utf8")); } catch { /* mới */ }
  const next = { ...s, ...patch };
  fs.writeFileSync(stateFile(), JSON.stringify(next, null, 2));
}
export function readState(): { heartbeat?: string; pid?: number; log?: string[] } {
  try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")); } catch { return {}; }
}

export interface TickDeps {
  publish?: typeof publishVideo;
  sleep?: (ms: number) => Promise<void>;
  log?: (s: string) => void;
}

const lastByPlatform = (results: PublishResult[]) => {
  const m = new Map<string, PublishResult>();
  for (const r of results) m.set(r.platform, r);
  return m;
};

function finalize(e: ScheduleEntry) {
  const last = lastByPlatform(e.results || []);
  const okPl = e.platforms.filter((p) => last.get(p) && realSuccess(last.get(p)!));
  const bad = e.platforms.filter((p) => !okPl.includes(p));
  e.status = okPl.length ? "published" : "failed";
  e.note = `auto · ${okPl.length}/${e.platforms.length} nền tảng${bad.length ? ` · chưa đăng: ${bad.join(", ")}` : ""}`;
  e.finishedAt = new Date().toISOString();
  delete e.inflight;
}

/** Sửa khung bị ngắt (worker chết giữa chừng): nền tảng đang đăng dở -> lỗi "kiểm tra thủ công", không đăng lại tự động. */
export function recoverInterrupted(log: (s: string) => void = console.log): number {
  return withScheduleLock(() => {
    const entries = getSchedule();
    let n = 0;
    for (const e of entries) {
      if (!e.auto || e.editorial || e.status !== "publishing"
        || (e.startedAt && Date.now() - new Date(e.startedAt).getTime() < 2 * 3600e3)) continue;
      const at = new Date().toISOString();
      if (e.inflight) {
        e.results = [...(e.results || []), { platform: e.inflight, ok: false, error: "Bị ngắt khi đang đăng (worker khởi động lại). Kiểm tra thủ công trên nền tảng trước khi đăng lại.", at, via: "autopublish" }];
      }
      const done = new Set((e.results || []).map((r) => r.platform));
      for (const p of e.platforms) if (!done.has(p)) e.results = [...(e.results || []), { platform: p, ok: false, error: "Chưa đăng (worker bị ngắt trước khi tới nền tảng này)", at, via: "autopublish" }];
      finalize(e);
      log(`[autopublish] khôi phục khung bị ngắt ${e.id}: ${e.note}`);
      n++;
    }
    if (n) saveSchedule(entries);
    return n;
  });
}

function saveEntry(e: ScheduleEntry) {
  withScheduleLock(() => {
    const all = getSchedule();
    const i = all.findIndex((x) => x.id === e.id);
    if (i >= 0) all[i] = e; else all.push(e);
    saveSchedule(all);
  });
}

const noted = new Set<string>();

/** Một nhịp: đăng các khung đến giờ (trong graceMin). Trả về các khung đã chạy. */
export async function autoTick(now = new Date(), deps: TickDeps = {}, configs: AutoConfig[] = loadAutoConfig()): Promise<ScheduleEntry[]> {
  const publish = deps.publish || publishVideo;
  // Provider errors can be ambiguous even without a returned ID; never replay them blindly.
  const log = deps.log || console.log;
  const ran: ScheduleEntry[] = [];
  for (const cfg of configs) {
    if (!cfg.enabled || isEditorial(cfg.profile)) continue;
    const date = localDate(now);
    if (!dayAllowed(cfg, date)) continue;
    for (const time of cfg.times) {
      const at = slotInstant(date, time);
      const late = now.getTime() - at.getTime();
      if (late < 0 || late > (cfg.graceMin ?? 90) * 60e3) continue;
      const id = autoEntryId(cfg.profile, date, time);
      const reserved = withScheduleLock(() => {
        const entries = getSchedule();
        if (entries.some((e) => e.id === id || (e.profile === cfg.profile && e.date === date && e.time === time))) return null;
        const v = autoQueue(cfg, entries, date)[0];
        if (!v) return null;
        const live = isLive(cfg);
        const e: ScheduleEntry = {
          id, profile: cfg.profile, date, time, slot: slotKeyFor(time), ideaId: v.ideaId, videoId: v.id, platforms: [...cfg.platforms],
          status: "publishing", results: [], auto: true, startedAt: new Date().toISOString(), note: `auto${live ? " · THẬT" : " · dry-run"}`,
        };
        entries.push(e);
        saveSchedule(entries);
        return { e, v, live };
      });
      if (!reserved) {
        if (!noted.has(id)) { log(`[autopublish] ${date} ${time} ${cfg.profile}: hết video hoặc khung đã đặt, bỏ qua`); noted.add(id); }
        continue;
      }
      const { e, v, live } = reserved;
      log(`[autopublish] ${date} ${time} ${cfg.profile}: ${v.id} "${v.title}" -> ${e.platforms.join(", ")} (${live ? "đăng thật" : "dry-run"})`);
      const tiktokAuto = cfg.tiktok ? { ...cfg.tiktok, consentAt: cfg.approvedAt || cfg.tiktok.consentAt, consentText: cfg.approval || cfg.tiktok.consentText } : undefined;
      const opts = () => ({
        live, youtubePrivacy: cfg.youtubePrivacy, tiktokAuto,
        onStart: (p: Platform) => { e.inflight = p; saveEntry(e); },
        onResult: (r: PublishResult) => {
          e.results = [...(e.results || []), r]; delete e.inflight; saveEntry(e);
          log(`   ${realSuccess(r) ? "✓" : "✗"} ${r.platform} via ${r.via}${r.url ? ` ${r.url}` : ""}${r.error ? `: ${r.error}` : ""}`);
        },
      });
      try {
        await publish(v.id, e.platforms, opts());
      } catch (err) {
        e.results = [...(e.results || []), ...e.platforms.filter((p) => !lastByPlatform(e.results || []).has(p)).map((p) => ({ platform: p, ok: false, error: (err as Error).message, at: new Date().toISOString(), via: "autopublish" }))];
      }
      finalize(e);
      saveEntry(e);
      log(`[autopublish] xong ${id}: ${e.note}`);
      ran.push(e);
    }
  }
  return ran;
}
