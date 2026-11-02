import path from "node:path";
import { cdnFor, redirectTo } from "@/lib/cdn";
import { DATA_DIR } from "@/lib/data";
import { IMAGE_TYPES, safeDecode, safeResolve, sendFile, VIDEO_TYPES } from "@/lib/serve-file";

/** File được commit trong DATA_DIR:
 *  - /api/assets/<...>          -> DATA_DIR/assets (ảnh tham chiếu nhân vật/bối cảnh, clip dựng sẵn; video có Range)
 *  - /api/assets/archive/<...>  -> DATA_DIR/archive (chỉ ảnh tư liệu jpg/png/webp, không lộ index.json)
 *  Đã đẩy lên CDN thì chuyển hướng. Đã qua middleware đăng nhập. */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const segs = (await params).path.map(safeDecode);
  const archive = segs[0] === "archive";
  const root = path.join(DATA_DIR, archive ? "archive" : "assets");
  const rel = (archive ? segs.slice(1) : segs).join("/");
  const ext = path.extname(rel).toLowerCase();
  const type = archive ? IMAGE_TYPES[ext] : IMAGE_TYPES[ext] || VIDEO_TYPES[ext];
  if (!type) return new Response("Not found", { status: 404 });
  const cdn = cdnFor(`${archive ? "archive" : "assets"}/${rel}`);
  if (cdn) return redirectTo(cdn.url);
  const file = safeResolve(root, rel);
  if (!file) return new Response("Not found", { status: 404 });
  return sendFile(req, file, type);
}
