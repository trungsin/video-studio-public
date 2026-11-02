import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./data";
import { isVideoRef, mediaUrl, thumbUrl } from "./media-url";
import type { CastRef, Idea, Profile, Scene, Video } from "./types";

/** Ảnh tư liệu của một cảnh, đã tra index data/archive (tác giả, giấy phép, nhãn). */
export interface ArchiveView {
  id: string; ref: string; url: string; thumb: string; label: string; credit: string;
  title: string; author: string; license: string; page: string; attributionRequired: boolean; missing?: boolean;
}

/** Hình đại diện: ảnh/clip/ảnh tư liệu/MP4 đã render/nhân vật. thumb luôn là ảnh tĩnh (poster cho clip). */
export interface Visual { kind: "image" | "clip" | "archive" | "render" | "cast" | "none"; ref?: string; url?: string; thumb?: string; label?: string; credit?: string; count?: number }

type ArchiveItem = { id: string; file: string; title?: string; author?: string; license?: string; page?: string; date?: string; attributionRequired?: boolean };
const idxCache = new Map<string, { mtime: number; items: Map<string, ArchiveItem> }>();

function archiveIndex(topic: string): Map<string, ArchiveItem> {
  if (!/^[\w-]+$/.test(topic)) return new Map();
  const f = path.join(DATA_DIR, "archive", topic, "index.json");
  let mtime = 0;
  try { mtime = fs.statSync(f).mtimeMs; } catch { return new Map(); }
  const hit = idxCache.get(topic);
  if (hit && hit.mtime === mtime) return hit.items;
  let items = new Map<string, ArchiveItem>();
  try { items = new Map((JSON.parse(fs.readFileSync(f, "utf8")).items || []).map((x: ArchiveItem) => [x.id, x])); } catch { /* index hỏng: coi như trống */ }
  idxCache.set(topic, { mtime, items });
  return items;
}

/** Dòng ghi công giống worker/archive.py credit_line. */
export function creditLine(it: ArchiveItem): string {
  let a = (it.author || "").replace(/\s+/g, " ").trim();
  if (/^(unknown author|unknown|không rõ tác giả)$/i.test(a) || !a) a = "tác giả không rõ";
  if (!it.attributionRequired) return `${a}${it.date ? `, ${it.date}` : ""} (phạm vi công cộng), Wikimedia Commons`;
  return `${a} / Wikimedia Commons, ${it.license || ""}`;
}

export function archiveItems(sc: Pick<Scene, "archive">): ArchiveView[] {
  return (sc.archive?.items || []).filter((x) => x?.id).map((x) => {
    const topic = x.id.split("/")[0];
    const it = archiveIndex(topic).get(x.id);
    const ref = it ? `archive/${it.file}` : "";
    return {
      id: x.id, ref, url: ref ? mediaUrl(ref) : "", thumb: ref ? thumbUrl(ref, 360) : "", label: x.label || it?.title || x.id,
      credit: x.credit || (it ? creditLine(it) : ""), title: it?.title || "", author: it?.author || "", license: it?.license || "",
      page: it?.page || "", attributionRequired: !!it?.attributionRequired, ...(it ? {} : { missing: true }),
    };
  });
}

/** Hình của một cảnh: ảnh tĩnh > ảnh tư liệu > clip (poster) */
export function sceneVisual(sc: Scene): Visual {
  const media = sc.clip || sc.image;
  if (sc.image && !isVideoRef(sc.image) && !sc.clip) return { kind: "image", ref: sc.image, url: mediaUrl(sc.image), thumb: thumbUrl(sc.image) };
  const arch = archiveItems(sc).filter((x) => !x.missing);
  if (arch.length && !sc.clip) return { kind: "archive", ref: arch[0].ref, url: arch[0].url, thumb: arch[0].thumb, label: arch[0].label, credit: arch[0].credit, count: arch.length };
  if (media) return isVideoRef(media) ? { kind: "clip", ref: media, url: mediaUrl(media), thumb: thumbUrl(media) } : { kind: "image", ref: media, url: mediaUrl(media), thumb: thumbUrl(media) };
  return { kind: "none" };
}

/** Ảnh đại diện video: cảnh có ảnh tĩnh/ảnh tư liệu đầu tiên > poster clip > poster MP4 đã render. */
export function videoThumb(v: Video): Visual {
  const vis = v.scenes.map(sceneVisual);
  const best = vis.find((x) => x.kind === "image" || x.kind === "archive") || vis.find((x) => x.kind === "clip");
  if (best) return best;
  if (v.render?.state === "done" && v.render.output) return { kind: "render", ref: v.render.output, url: mediaUrl(v.render.output), thumb: thumbUrl(v.render.output) };
  return { kind: "none" };
}

/** Ý tưởng: dùng video nếu có; chưa có video -> ảnh nhân vật dẫn chuyện của profile (mờ, chỉ để nhận diện kênh). */
export function ideaThumb(i: Idea, videos: Map<string, Video>, p?: Profile | null): Visual {
  const v = i.videoId ? videos.get(i.videoId) : undefined;
  if (v) { const t = videoThumb(v); if (t.kind !== "none") return t; }
  const chars: CastRef[] = p?.cast?.characters || [];
  const c = chars.find((x) => x.id === i.characterId) || chars[0];
  const r = c?.refs?.[0];
  return r ? { kind: "cast", ref: r, url: mediaUrl(r), thumb: thumbUrl(r, 120), label: c!.name } : { kind: "none" };
}

/** Bản đồ id ảnh tư liệu -> thông tin, cho VideoEditor (client). */
export function archiveMap(v: Video): Record<string, ArchiveView> {
  const out: Record<string, ArchiveView> = {};
  for (const sc of v.scenes) for (const a of archiveItems(sc)) out[a.id] = a;
  return out;
}
