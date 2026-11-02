import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cdnFor, redirectTo } from "@/lib/cdn";
import { MEDIA_DIR } from "@/lib/data";
import { IMAGE_TYPES, resolveRef, VIDEO_TYPES } from "@/lib/serve-file";

/** Ảnh thu nhỏ JPEG cho tham chiếu media ("assets/…", "archive/…", hoặc đường dẫn trong MEDIA_DIR).
 *  Ảnh: thu nhỏ; clip/MP4: lấy khung poster. Cache ở MEDIA_DIR/.thumbs. Đã qua middleware đăng nhập.
 *  Ref đã lên CDN: thumbnail CDN (~225 px ngang; ảnh xin rộng hơn thì trả ảnh gốc), video CDN chưa có thumbnail thì tạo local. */
const pending = new Map<string, Promise<boolean>>();

function ffmpeg(args: string[]): Promise<boolean> {
  return new Promise((ok) => execFile("ffmpeg", args, { timeout: 30_000 }, (err) => ok(!err)));
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const ref = u.searchParams.get("src") || "";
  const w = Math.min(Math.max(Math.round(Number(u.searchParams.get("w")) || 270), 48), 720);
  const ext = path.extname(ref).toLowerCase();
  const isVid = !!VIDEO_TYPES[ext];
  if (!IMAGE_TYPES[ext] && !isVid) return new Response("Not found", { status: 404 });
  const cdn = cdnFor(ref);
  if (cdn?.thumb && (isVid || w <= 270)) return redirectTo(cdn.thumb);
  if (cdn && !isVid) return redirectTo(cdn.url);
  const file = resolveRef(ref);
  if (!file) return new Response("Not found", { status: 404 });
  const st = fs.statSync(file);
  const key = crypto.createHash("sha1").update(`${file}|${st.mtimeMs}|${st.size}|${w}`).digest("hex");
  const dir = path.join(MEDIA_DIR, ".thumbs");
  const out = path.join(dir, `${key}.jpg`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(dir, { recursive: true });
    let job = pending.get(key);
    if (!job) {
      const tmp = `${out}.${process.pid}.tmp.jpg`;
      const vf = ["-vf", `scale=${w}:-2`, "-frames:v", "1", "-q:v", "4", "-y", tmp];
      job = (async () => {
        let ok = isVid ? await ffmpeg(["-v", "error", "-ss", "1", "-i", file, ...vf]) && fs.existsSync(tmp) : false;
        if (!ok) ok = await ffmpeg(["-v", "error", "-i", file, ...vf]) && fs.existsSync(tmp);
        if (ok) fs.renameSync(tmp, out); else fs.rmSync(tmp, { force: true });
        return ok;
      })().finally(() => pending.delete(key));
      pending.set(key, job);
    }
    if (!(await job)) return new Response("Không tạo được ảnh thu nhỏ", { status: 500 });
  }
  return new Response(fs.readFileSync(out), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
}
