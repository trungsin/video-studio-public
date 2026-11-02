import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { DATA_DIR, MEDIA_DIR } from "./data";

export const IMAGE_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
export const VIDEO_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };

/** Đường dẫn tuyệt đối an toàn bên trong root (chặn ../, đường dẫn tuyệt đối, symlink trỏ ra ngoài). null nếu không hợp lệ/không tồn tại. */
export function safeResolve(root: string, rel: string): string | null {
  if (!rel || rel.includes("\0")) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, rel);
  if (!file.startsWith(base + path.sep)) return null;
  try {
    const real = fs.realpathSync(file), realBase = fs.realpathSync(base);
    if (!real.startsWith(realBase + path.sep) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}

/** Trả file có hỗ trợ Range (video tua được). */
export function sendFile(req: Request, file: string, type: string, cache = "private, max-age=300"): Response {
  const size = fs.statSync(file).size;
  const range = req.headers.get("range");
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(size - Number(m[2]), 0);
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    start = Math.max(start, 0); end = Math.max(end, start);
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers: { "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": String(end - start + 1), "cache-control": cache } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { "content-type": type, "content-length": String(size), "accept-ranges": "bytes", "cache-control": cache } });
}

export const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** Tham chiếu media trong dữ liệu -> file thật: "assets/…" (DATA_DIR/assets), "archive/…" (DATA_DIR/archive), còn lại MEDIA_DIR. */
export function resolveRef(ref: string): string | null {
  if (ref.startsWith("assets/")) return safeResolve(path.join(DATA_DIR, "assets"), ref.slice(7));
  if (ref.startsWith("archive/")) return safeResolve(path.join(DATA_DIR, "archive"), ref.slice(8));
  if (ref.startsWith(".thumbs/")) return null;
  return safeResolve(MEDIA_DIR, ref);
}
