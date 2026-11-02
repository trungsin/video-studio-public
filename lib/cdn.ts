import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, MEDIA_DIR, getProfile, getVideo, listProfiles, listVideos, writeJson } from "./data";
import { profileEnvKey } from "./profile-env";
import { IMAGE_TYPES, resolveRef, VIDEO_TYPES } from "./serve-file";
import { archiveItems } from "./thumbs";
import type { Video } from "./types";

/**
 * myCDN (`MYCDN_URL`): ảnh/video của profile có `MYCDN_API_KEY__<SLUG>` được đẩy lên CDN, web chỉ trả 302. Thiếu MYCDN_URL = tắt CDN.
 * - Đường dẫn trên CDN gắn hash nội dung (`<slug>/<thư mục ref>/<tên>-<sha12><ext>`): CDN từ chối ghi đè (409) và
 *   Cloudflare cache 4 giờ, nên bản render lại luôn có URL mới; bản cũ bị xoá sau khi manifest trỏ sang bản mới.
 * - Manifest MEDIA_DIR/.cdn/manifest.json: ref -> bản trên CDN + size/mtime của file local lúc đẩy. File local đổi
 *   (render lại, upload đè) thì web phục vụ local cho tới khi bản mới được đẩy.
 * - Render xong: worker cdn-sync thấy data/videos/<id>.json đổi sang `done` và đẩy ngay (syncVideo). Đăng bài lấy
 *   URL CDN của MP4 (pushRef, đẩy luôn nếu chưa có) cho nền tảng nhận URL.
 * - File local vẫn giữ: renderer đọc ảnh cảnh, YouTube/TikTok trực tiếp cần gửi byte.
 */
export interface CdnEntry {
  profile: string; path: string; url: string; thumb: string | null;
  size: number; mtimeMs: number; sha256: string; at: string;
}
type Manifest = { files: Record<string, CdnEntry> };
type Env = Record<string, string | undefined>;

export const cdnBase = (env: Env = process.env) => (env.MYCDN_URL?.trim() || "").replace(/\/+$/, "");
/** Khoá CDN của profile; chưa đặt MYCDN_URL thì coi như không có (phục vụ/đăng từ file local). */
export const cdnKey = (slug: string, env: Env = process.env) => cdnBase(env) ? env[`MYCDN_API_KEY__${profileEnvKey(slug)}`]?.trim() || undefined : undefined;
const manifestFile = () => path.join(MEDIA_DIR, ".cdn", "manifest.json");
const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const SERVABLE = { ...IMAGE_TYPES, ...VIDEO_TYPES };
/** File sửa trong khoảng này coi như đang ghi dở (render/tạo ảnh), để lượt sau. */
const SETTLE_MS = 30_000;

let cache: { mtimeMs: number; m: Manifest } | null = null;
export function readManifest(): Manifest {
  let mtimeMs: number;
  try { mtimeMs = fs.statSync(manifestFile()).mtimeMs; } catch { return { files: {} }; }
  if (cache?.mtimeMs === mtimeMs) return cache.m;
  let m: Manifest = { files: {} };
  try { m = JSON.parse(fs.readFileSync(manifestFile(), "utf8")); } catch { /* hỏng: coi như chưa đẩy gì */ }
  cache = { mtimeMs, m };
  return m;
}

/** Bản CDN còn khớp file local của ref (hoặc local đã bị dọn); null = phục vụ local. */
export function cdnFor(ref: string): CdnEntry | null {
  const e = readManifest().files[ref];
  if (!e) return null;
  const file = resolveRef(ref);
  if (!file) return e;
  const st = fs.statSync(file);
  return st.size === e.size && st.mtimeMs === e.mtimeMs ? e : null;
}

export const redirectTo = (url: string) => new Response(null, { status: 302, headers: { location: url, "cache-control": "no-cache" } });

/** MP4 (nếu render xong, đứng đầu để sẵn sàng cho đăng bài sớm nhất), ảnh/clip cảnh và ảnh tư liệu của một video. */
function videoRefs(v: Video): string[] {
  const refs: string[] = v.render?.state === "done" && v.render.output ? [v.render.output] : [];
  for (const sc of v.scenes) {
    if (sc.image) refs.push(sc.image);
    if (sc.clip) refs.push(sc.clip);
    for (const a of archiveItems(sc)) if (a.ref) refs.push(a.ref);
  }
  return [...new Set(refs)].filter((r) => SERVABLE[path.extname(r).toLowerCase()]);
}

/** Mọi ảnh/video profile phục vụ: ảnh/clip cảnh, ảnh tư liệu, MP4 đã render xong, ảnh nhân vật/bối cảnh, data/assets/<slug>. */
export function profileRefs(slug: string): string[] {
  const refs = new Set<string>();
  for (const v of listVideos(slug)) for (const r of videoRefs(v)) refs.add(r);
  const p = getProfile(slug);
  for (const c of [...(p?.cast?.characters || []), ...(p?.cast?.settings || [])]) for (const r of c.refs || []) refs.add(r);
  const walk = (dir: string, rel: string) => {
    let names: fs.Dirent[] = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      if (d.isDirectory()) walk(path.join(dir, d.name), `${rel}/${d.name}`);
      else if (d.isFile()) refs.add(`${rel}/${d.name}`);
    }
  };
  walk(path.join(DATA_DIR, "assets", slug), `assets/${slug}`);
  return [...refs].filter((r) => SERVABLE[path.extname(r).toLowerCase()]).sort();
}

async function sha256(file: string): Promise<string> {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}

export function cdnPathFor(slug: string, ref: string, sha: string): string {
  const ext = path.extname(ref), dir = path.posix.dirname(ref), stem = path.basename(ref, ext);
  return `${slug}/${dir === "." ? "" : `${dir}/`}${stem}-${sha.slice(0, 12)}${ext.toLowerCase()}`;
}

type CdnItem = { url: string; thumbnailUrl: string | null };

/** Bản đã có trên CDN tại cdnPath (null = chưa có). */
async function stat(f: typeof fetch, env: Env, key: string, cdnPath: string): Promise<CdnItem | null> {
  const res = await f(`${cdnBase(env)}/api/files/${encodePath(cdnPath)}`, { method: "GET", headers: { "X-API-Key": key } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CDN stat ${cdnPath}: HTTP ${res.status}`);
  return await res.json() as CdnItem;
}

/**
 * Đường dẫn có hash nội dung nên bản đã có trên CDN chính là file này. Hỏi trước khi gửi: CDN xử lý chậm thì
 * Cloudflare trả 524 sau 100 s dù upload vẫn hoàn tất phía origin, lượt sau không phải gửi lại cả file.
 */
async function upload(f: typeof fetch, env: Env, key: string, cdnPath: string, file: string): Promise<{ url: string; thumb: string | null }> {
  const have = await stat(f, env, key, cdnPath);
  if (have) return { url: have.url, thumb: have.thumbnailUrl };
  const form = new FormData();
  form.append("prefix", path.posix.dirname(cdnPath)); // phải đứng trước phần file
  form.append("file", await fs.openAsBlob(file, { type: SERVABLE[path.extname(file).toLowerCase()] }), path.posix.basename(cdnPath));
  const res = await f(`${cdnBase(env)}/api/files`, { method: "POST", headers: { "X-API-Key": key }, body: form });
  const body = await res.json().catch(() => ({})) as { items?: CdnItem[]; errors?: { statusCode?: number; message?: string }[]; message?: string };
  const item = body.items?.[0];
  if (res.ok && item) return { url: item.url, thumb: item.thumbnailUrl };
  const err = body.errors?.[0];
  const raced = err?.statusCode === 409 ? await stat(f, env, key, cdnPath) : null;
  if (raced) return { url: raced.url, thumb: raced.thumbnailUrl };
  throw new Error(`CDN upload ${cdnPath}: ${err?.message || body.message || `HTTP ${res.status}`}`);
}

async function remove(f: typeof fetch, env: Env, key: string, cdnPath: string) {
  const res = await f(`${cdnBase(env)}/api/files/${encodePath(cdnPath)}`, { method: "DELETE", headers: { "X-API-Key": key } });
  if (!res.ok && res.status !== 404) throw new Error(`CDN delete ${cdnPath}: HTTP ${res.status}`);
}

export interface SyncResult { profile: string; uploaded: number; bytes: number; pending: number; failed: string[] }
export interface SyncOpts { env?: Env; fetch?: typeof fetch; dryRun?: boolean; now?: number; log?: (s: string) => void }

/**
 * Đưa một ref của profile lên CDN (manifest đã khớp size/mtime thì không gọi mạng). null = profile không có key
 * hoặc không thấy file. Ném lỗi khi upload hỏng; xoá bản cũ trên CDN là best-effort.
 */
export async function pushRef(slug: string, ref: string, o: SyncOpts = {}): Promise<{ entry: CdnEntry; uploaded: boolean } | null> {
  const env = o.env || process.env, f = o.fetch || fetch, now = o.now ?? Date.now(), log = o.log || (() => {});
  const key = cdnKey(slug, env), file = resolveRef(ref);
  if (!key || !file) return null;
  const st = fs.statSync(file);
  const prev = readManifest().files[ref];
  if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) return { entry: prev, uploaded: false };
  const sha = await sha256(file);
  const save = (e: Pick<CdnEntry, "profile" | "path" | "url" | "thumb">): CdnEntry => {
    const entry = { profile: e.profile, path: e.path, url: e.url, thumb: e.thumb, size: st.size, mtimeMs: st.mtimeMs, sha256: sha, at: new Date(now).toISOString() };
    writeJson(manifestFile(), { files: { ...readManifest().files, [ref]: entry } });
    cache = null;
    return entry;
  };
  // chỉ đổi mtime (touch, chép lại cùng nội dung): giữ bản đang có trên CDN
  if (prev?.sha256 === sha) return { entry: save(prev), uploaded: false };
  const cdnPath = cdnPathFor(slug, ref, sha);
  const entry = save({ profile: slug, path: cdnPath, ...await upload(f, env, key, cdnPath, file) });
  log(`↑ ${ref} -> ${cdnPath}`);
  const oldKey = prev && prev.path !== cdnPath ? cdnKey(prev.profile, env) : undefined;
  if (prev && oldKey) await remove(f, env, oldKey, prev.path).catch((e) => log(`! ${(e as Error).message}`));
  return { entry, uploaded: true };
}

async function pushAll(slug: string, refs: string[], settle: boolean, o: SyncOpts): Promise<SyncResult> {
  const now = o.now ?? Date.now(), log = o.log || (() => {});
  const out: SyncResult = { profile: slug, uploaded: 0, bytes: 0, pending: 0, failed: [] };
  if (!cdnKey(slug, o.env || process.env)) return out;
  for (const ref of refs) {
    const file = resolveRef(ref);
    if (!file) continue;
    const st = fs.statSync(file);
    if (settle && now - st.mtimeMs < SETTLE_MS) { out.pending++; continue; }
    const prev = readManifest().files[ref];
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue;
    if (o.dryRun) { out.uploaded++; out.bytes += st.size; continue; }
    try {
      if ((await pushRef(slug, ref, o))?.uploaded) { out.uploaded++; out.bytes += st.size; }
    } catch (e) {
      out.failed.push(ref);
      const cause = (e as Error).cause as { code?: string; message?: string } | undefined;
      log(`! ${ref}: ${(e as Error).message}${cause ? ` (${cause.code || cause.message})` : ""}`);
    }
  }
  return out;
}

/** Quét cả profile (tuần tự: mỗi upload chiếm RAM phía CDN và có thể chạy ffmpeg tạo thumbnail). File vừa ghi để lượt sau. */
export const syncProfile = (slug: string, o: SyncOpts = {}) => pushAll(slug, profileRefs(slug), true, o);

/** Video vừa render xong: MP4 và ảnh/clip cảnh đã cố định, đẩy ngay không chờ. Chưa render xong thì bỏ qua. */
export function syncVideo(id: string, o: SyncOpts = {}): Promise<SyncResult> {
  const v = getVideo(id);
  if (!v || v.render?.state !== "done") return pushAll(v?.profile || "", [], false, o);
  return pushAll(v.profile, videoRefs(v), false, o);
}

/** Profile có key CDN (các profile còn lại phục vụ local như cũ). */
export const cdnProfiles = (env: Env = process.env) => listProfiles().map((p) => p.slug).filter((s) => cdnKey(s, env));
