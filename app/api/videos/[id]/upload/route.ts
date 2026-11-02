import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getVideo, MEDIA_DIR, saveVideo } from "@/lib/data";
import { invalidateRender } from "@/lib/workflow";

const OK = new Set([".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm"]);

/** Upload ảnh/clip cho một cảnh: multipart field "file", query ?scene=<index> */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = getVideo((await params).id);
  if (!v) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  const k = Number(new URL(req.url).searchParams.get("scene"));
  if (!Number.isInteger(k) || !v.scenes[k]) return NextResponse.json({ error: "Cảnh không hợp lệ" }, { status: 400 });
  if (v.render.state === "queued" || v.render.state === "running") return NextResponse.json({ error: "Đang render, đợi xong rồi đổi ảnh/clip" }, { status: 409 });
  const form = await req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) return NextResponse.json({ error: "Thiếu file" }, { status: 400 });
  const ext = path.extname(f.name).toLowerCase();
  if (!OK.has(ext)) return NextResponse.json({ error: "Chỉ nhận ảnh jpg/png/webp hoặc clip mp4/mov/webm" }, { status: 400 });
  if (f.size > 200 * 1024 * 1024) return NextResponse.json({ error: "File quá lớn (>200MB)" }, { status: 400 });
  const rel = path.join("uploads", v.id, `scene-${k}-${Date.now().toString(36)}${ext}`);
  fs.mkdirSync(path.join(MEDIA_DIR, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, rel), Buffer.from(await f.arrayBuffer()));
  if (/\.(mp4|mov|webm)$/i.test(rel)) v.scenes[k].clip = rel; // cảnh type "clip"
  else { v.scenes[k].image = rel; v.scenes[k].clip = undefined; }
  invalidateRender(v); // ảnh/clip cảnh đổi: MP4 cũ không còn khớp
  saveVideo(v);
  return NextResponse.json(v);
}
