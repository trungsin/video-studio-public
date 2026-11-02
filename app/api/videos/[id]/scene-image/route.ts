import { NextResponse } from "next/server";
import path from "node:path";
import { DATA_DIR, getProfile, getVideo, MEDIA_DIR, saveVideo } from "@/lib/data";
import { pickCast, scenePrompt } from "@/lib/cast";
import { runMediaGen } from "@/lib/gen";
import { providerArgs } from "@/lib/image-provider";
import { invalidateRender } from "@/lib/workflow";

export const maxDuration = 400;

/** Sinh ảnh AI cho một cảnh (?scene=k), gửi kèm ảnh ref nhân vật + bối cảnh đã chọn. Body {video?: true} -> image-to-video. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = getVideo((await params).id);
  if (!v) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  const k = Number(new URL(req.url).searchParams.get("scene"));
  const sc = v.scenes[k];
  if (!sc) return NextResponse.json({ error: "Cảnh không hợp lệ" }, { status: 400 });
  if (v.render.state === "queued" || v.render.state === "running") return NextResponse.json({ error: "Đang render, đợi xong rồi tạo ảnh" }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  const prof = getProfile(v.profile);
  const { character, setting } = pickCast(prof, v.characterId, v.settingId);
  const base = sc.visual || sc.title;
  const prompt = character && base.includes(character.description) ? base : scenePrompt(base, character, setting);
  const dir = path.join("uploads", v.id);
  try {
    if (body.video) {
      if (!sc.image || /\.(mp4|mov|webm)$/i.test(sc.image)) return NextResponse.json({ error: "Cần ảnh tĩnh của cảnh trước" }, { status: 400 });
      const rel = path.join(dir, `scene-${k}-motion-${Date.now().toString(36)}.mp4`);
      await runMediaGen(["video", "--image", path.join(MEDIA_DIR, sc.image), "--prompt", `${base}. Subtle natural motion, handheld feel.`, "--out", path.join(MEDIA_DIR, rel)], 12 * 60_000);
      sc.clip = rel; sc.motion = "video"; // giữ ảnh gốc, clip ưu tiên khi render
    } else {
      const rel = path.join(dir, `scene-${k}-ai-${Date.now().toString(36)}.png`);
      const refs = [...(character?.refs || []), ...(setting?.refs || [])].map((r) => path.join(DATA_DIR, r));
      await runMediaGen(["image", "--prompt", prompt, "--out", path.join(MEDIA_DIR, rel), ...refs.flatMap((r) => ["--ref", r]), ...providerArgs(prof)]);
      sc.image = rel;
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  invalidateRender(v); // ảnh/clip cảnh đổi: MP4 cũ không còn khớp
  saveVideo(v);
  return NextResponse.json(v);
}
