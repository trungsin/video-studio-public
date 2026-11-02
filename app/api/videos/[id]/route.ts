import { isEditorial } from "@/lib/channel-config";
import { NextResponse } from "next/server";
import { getIdea, getVideo, saveIdea, saveVideo, setIdeaStatus } from "@/lib/data";
import { checkRenderedMedia, editorialValid, invalidateEditorial } from "@/lib/editorial-production";
import { invalidateRender, RENDERED_VIDEO_FIELDS } from "@/lib/workflow";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = getVideo((await params).id);
  return v ? NextResponse.json(v) : NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = getVideo((await params).id);
  if (!v) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  const b = await req.json();
  const i = isEditorial(v.profile) ? getIdea(v.ideaId) : null;
  if (isEditorial(v.profile) && !i) return NextResponse.json({ error: "Thiếu ý tưởng gốc" }, { status: 409 });
  if (b.action === "approve") {
    if (v.render.state !== "done") return NextResponse.json({ error: "Chưa render xong" }, { status: 400 });
    if (isEditorial(v.profile) && (!editorialValid(i!, v) || checkRenderedMedia(v))) return NextResponse.json({ error: "Bản render không khớp nguồn và kịch bản đã duyệt" }, { status: 409 });
    if (isEditorial(v.profile) && v.editorial && v.render.finishedAt) v.editorial.renderId = v.render.finishedAt;
    v.status = "done";
    if (i && i.status === "production") { setIdeaStatus(i, "ready", "Video đã kiểm tra kỹ thuật"); saveIdea(i); }
  } else if (b.action === "review") {
    // canvas: "Đánh dấu review" -> vào hàng đợi đăng tự động theo thứ tự kế hoạch (cần đã render)
    if (v.render.state !== "done" || !v.render.output) return NextResponse.json({ error: "Chưa render xong" }, { status: 400 });
    if (isEditorial(v.profile) && !editorialValid(i!, v)) return NextResponse.json({ error: "Nguồn hoặc kịch bản đã thay đổi" }, { status: 409 });
    if (v.status === "published") return NextResponse.json({ error: "Video đã đăng" }, { status: 400 });
    v.status = "review";
  } else if (b.action === "redo") {
    if (isEditorial(v.profile) && v.status === "published") return NextResponse.json({ error: "Video đã đăng, không thể sửa" }, { status: 409 });
    v.status = "doing";
    if (isEditorial(v.profile)) {
      if (v.render.state === "running" || v.render.state === "queued") return NextResponse.json({ error: "Đang render" }, { status: 409 });
      v.editorial = undefined;
      v.render.state = "idle";
      if (i) invalidateEditorial(i, "Yêu cầu dựng lại video");
    }
  } else {
    if (isEditorial(v.profile) && v.status === "published") return NextResponse.json({ error: "Video đã đăng, không thể sửa" }, { status: 409 });
    const fields = ["title", "caption", "hashtags", "scenes", "tts", "music", "characterId", "settingId"] as const;
    // Editor gửi đủ các trường mỗi lần lưu: chỉ tính trường có giá trị khác bản hiện tại.
    const differs = (key: (typeof fields)[number]) => key in b && JSON.stringify(b[key]) !== JSON.stringify(v[key]);
    const changed = fields.some(differs);
    // Profile biên tập: caption/hashtags thuộc kịch bản đã duyệt. Kênh khác: chỉ trường dựng vào MP4 mới làm render cũ hết hiệu lực.
    const rerender = v.status !== "published" && (isEditorial(v.profile) ? changed : RENDERED_VIDEO_FIELDS.some(differs));
    if (rerender && (v.render.state === "running" || v.render.state === "queued")) return NextResponse.json({ error: "Đang render, đợi xong rồi sửa" }, { status: 409 });
    if (isEditorial(v.profile) && changed) {
      if (i) {
        invalidateEditorial(i, "Video đã sửa; cần duyệt nội dung lại");
        if ("scenes" in b || "caption" in b) {
          i.script = { scenes: b.scenes || v.scenes, caption: b.caption || v.caption, hashtags: b.hashtags || v.hashtags };
          saveIdea(i);
        }
      }
      v.editorial = undefined;
    }
    for (const k of fields) if (k in b) (v as any)[k] = b[k];
    if (rerender) invalidateRender(v);
    else if (v.status === "todo") v.status = "doing";
  }
  saveVideo(v);
  return NextResponse.json(v);
}
