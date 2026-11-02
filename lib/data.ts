import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Idea, Profile, ScheduleEntry, Video, IdeaStatus } from "./types";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
export const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || "./media");

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Ghi nguyên tử (tmp + rename) để worker và web không đọc phải file dở dang. */
export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

function listJson<T>(dir: string): T[] {
  const d = path.join(DATA_DIR, dir);
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<T | null>(path.join(d, f), null))
    .filter(Boolean) as T[];
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
export const nowIso = () => new Date().toISOString();
export const safeSlug = (s: string) => /^[a-z0-9][a-z0-9-_]{0,63}$/i.test(s) ? s : (() => { throw new Error("id không hợp lệ"); })();

// ---------- Profiles ----------
export const listProfiles = () => listJson<Profile>("profiles").sort((a, b) => a.name.localeCompare(b.name));
export const getProfile = (slug: string) => readJson<Profile | null>(path.join(DATA_DIR, "profiles", `${safeSlug(slug)}.json`), null);
export function saveProfile(p: Profile) {
  p.updatedAt = nowIso();
  const md = renderVoiceMd(p); // tính lại ref file:line
  fs.mkdirSync(path.join(DATA_DIR, "voice"), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "voice", `${p.slug}.md`), md, "utf8");
  writeJson(path.join(DATA_DIR, "profiles", `${p.slug}.json`), p);
}

/** Sinh style guide Markdown từ profile; mỗi mục một dòng, gán ref = voice/<slug>.md:<dòng>. */
export function renderVoiceMd(p: Profile): string {
  const lines: string[] = [];
  const rel = `voice/${p.slug}.md`;
  lines.push(`# Giọng & chân dung: ${p.name}`);
  lines.push("");
  lines.push(`> File sinh tự động từ data/profiles/${p.slug}.json. AI assistant: sửa JSON (hoặc qua UI) rồi lưu, không sửa tay file này.`);
  if (p.sample) lines.push(`> ⚠️ Đây là profile MẪU (sample), không phải người thật.`);
  const block = (title: string, items: { id: string; label: string; value: string; ref?: string }[], fmt?: (i: any) => string) => {
    lines.push("", `## ${title}`, "");
    for (const it of items) {
      lines.push(fmt ? fmt(it) : `- **${it.label}**: ${it.value.replace(/\n+/g, " ")}`);
      it.ref = `${rel}:${lines.length}`;
    }
  };
  block("Thông tin chung", p.sections.info);
  block("Giọng văn", p.sections.voice);
  block("Giọng đọc TTS / ngữ điệu", p.sections.ttsNotes);
  block("Màu sắc", p.sections.colors, (c) => `- **${c.label}** \`${c.hex}\`: ${String(c.value || "").replace(/\n+/g, " ")}`);
  lines.push("", "## Hashtag", "", p.sections.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "), "");
  return lines.join("\n");
}

// ---------- Ideas ----------
export const listIdeas = (profile?: string) =>
  listJson<Idea>("ideas").filter((i) => i && (!profile || i.profile === profile)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getIdea = (id: string) => readJson<Idea | null>(path.join(DATA_DIR, "ideas", `${safeSlug(id)}.json`), null);
export function saveIdea(i: Idea) {
  i.updatedAt = nowIso();
  writeJson(path.join(DATA_DIR, "ideas", `${safeSlug(i.id)}.json`), i);
}
export function setIdeaStatus(i: Idea, to: IdeaStatus, note?: string) {
  i.history.push({ at: nowIso(), from: i.status, to, note });
  i.status = to;
}

// ---------- Videos ----------
export const listVideos = (profile?: string) =>
  listJson<Video>("videos").filter((v) => v && Array.isArray(v.scenes) && v.render?.state && (!profile || v.profile === profile)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getVideo = (id: string) => readJson<Video | null>(path.join(DATA_DIR, "videos", `${safeSlug(id)}.json`), null);
export function saveVideo(v: Video) {
  v.updatedAt = nowIso();
  writeJson(path.join(DATA_DIR, "videos", `${safeSlug(v.id)}.json`), v);
}

// ---------- Schedule ----------
const schedFile = () => path.join(DATA_DIR, "schedule.json");
export const getSchedule = (): ScheduleEntry[] => readJson<{ entries: ScheduleEntry[] }>(schedFile(), { entries: [] }).entries;
export const saveSchedule = (entries: ScheduleEntry[]) =>
  writeJson(schedFile(), { entries: entries.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)) });
/** Single-host, cross-process schedule transaction. Never hold this lock while calling a provider. */
export function withScheduleLock<T>(fn: () => T): T {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const lock = path.join(DATA_DIR, ".schedule.lock");
  const deadline = Date.now() + 10_000;
  while (true) {
    try { fs.mkdirSync(lock); break; }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() >= deadline) throw new Error(`Schedule lock unavailable: ${lock} (check/remove only after confirming no writer is running)`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return fn(); }
  finally { fs.rmdirSync(lock); }
}

// ---------- Time helpers (giờ địa phương theo TZ_OFFSET, mặc định +07:00) ----------
export const TZ_OFFSET = process.env.TZ_OFFSET || "+07:00";
const offsetMin = () => {
  const m = /^([+-])(\d\d):(\d\d)$/.exec(TZ_OFFSET);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 420;
};
export function localDate(d = new Date()): string {
  return new Date(d.getTime() + offsetMin() * 60000).toISOString().slice(0, 10);
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const slotInstant = (date: string, time: string) => new Date(`${date}T${time}:00${TZ_OFFSET}`);
export const WEEKDAY = ["CN", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
export const weekday = (date: string) => WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
