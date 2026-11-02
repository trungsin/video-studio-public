/** URL hiển thị cho tham chiếu media trong dữ liệu (dùng được ở client lẫn server, không đụng fs).
 * - "assets/..."  -> DATA_DIR/assets (ảnh/clip được commit)
 * - "archive/..." -> DATA_DIR/archive (ảnh tư liệu Wikimedia Commons)
 * - còn lại       -> MEDIA_DIR (upload, ảnh AI, MP4 đã render)
 */
export const isVideoRef = (p: string) => /\.(mp4|mov|webm)(\?|$)/i.test(p);

export function mediaUrl(p: string): string {
  const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
  if (p.startsWith("assets/")) return `/api/assets/${enc(p.slice(7))}`;
  if (p.startsWith("archive/")) return `/api/assets/archive/${enc(p.slice(8))}`;
  return `/api/media/${enc(p)}`;
}

/** Ảnh thu nhỏ JPEG (ảnh: thu nhỏ; clip/MP4: khung poster) qua /api/thumb, có cache. */
export const thumbUrl = (p: string, w = 270) => `/api/thumb?src=${encodeURIComponent(p)}&w=${w}`;
