import { isEditorial } from "./channel-config";
import { getProfile, getVideo, newId, nowIso, saveIdea, saveVideo, setIdeaStatus } from "./data";
import { approvedEvidence } from "./idea-research";
import type { Idea, Video } from "./types";

export type Action = "submit_mow" | "approve" | "reject" | "restore" | "back_to_script" | "mark_ready";

/** Máy trạng thái: idea → script → mow → legal → production → ready → scheduled → published */
export function applyAction(i: Idea, action: Action, note?: string): Idea {
  const at = nowIso();
  if (isEditorial(i.profile) && ["submit_mow", "approve", "mark_ready"].includes(action) && !approvedEvidence(i)) {
    throw new Error("Nguồn và số liệu chưa được duyệt");
  }
  switch (action) {
    case "submit_mow":
      if (!i.script) throw new Error("Chưa có kịch bản");
      if (!["script", "idea"].includes(i.status)) throw new Error("Chỉ gửi MOW từ bước Kịch bản");
      setIdeaStatus(i, "mow", note);
      break;
    case "approve":
      if (i.status === "mow") {
        if (isEditorial(i.profile) && !i.script) throw new Error("Thiếu kịch bản có nguồn");
        i.review = { ...i.review, mow: { ok: true, note, at } };
        setIdeaStatus(i, "legal", note || "MOW duyệt");
      } else if (i.status === "legal") {
        if (isEditorial(i.profile) && !i.review?.mow?.ok) throw new Error("MOW chưa duyệt");
        i.review = { ...i.review, legal: { ok: true, note, at } };
        setIdeaStatus(i, "production", note || "Legal duyệt");
        ensureVideo(i);
      } else throw new Error("Không có gì để duyệt ở bước này");
      break;
    case "reject":
      if (i.status === "mow") { i.review = { ...i.review, mow: { ok: false, note, at } }; setIdeaStatus(i, "script", note || "MOW trả lại"); }
      else if (i.status === "legal") { i.review = { ...i.review, legal: { ok: false, note, at } }; setIdeaStatus(i, "script", note || "Legal trả lại"); }
      else setIdeaStatus(i, "rejected", note || "Loại");
      break;
    case "restore":
      setIdeaStatus(i, i.script ? "script" : "idea", note || "Khôi phục");
      break;
    case "back_to_script":
      setIdeaStatus(i, "script", note);
      break;
    case "mark_ready":
      if (isEditorial(i.profile)) {
        const video = i.videoId && getVideo(i.videoId);
        if (!video || video.status !== "done" || video.render.state !== "done" || !video.editorial?.renderId
          || video.editorial.renderId !== video.render.finishedAt
          || video.editorial.evidenceDigest !== approvedEvidence(i)?.digest) throw new Error("Video chưa đủ điều kiện hoàn tất");
      }
      setIdeaStatus(i, "ready", note);
      break;
  }
  saveIdea(i);
  return i;
}

/** Khi qua Legal: tạo job video từ kịch bản (nếu chưa có). */
export function ensureVideo(i: Idea): Video {
  if (i.videoId) {
    const v = getVideo(i.videoId);
    if (v) return v;
  }
  const p = getProfile(i.profile);
  const v: Video = {
    id: newId("vid"),
    ideaId: i.id,
    profile: i.profile,
    title: i.title,
    status: "todo",
    sample: i.sample,
    characterId: i.characterId,
    settingId: i.settingId,
    scenes: (i.script?.scenes || []).map((s) => ({ ...s })),
    caption: i.script?.caption || i.title,
    hashtags: i.script?.hashtags || [],
    tts: p?.tts || { engine: "vieneu", voice: "Ngọc Huyền", rate: "+0%" },
    music: "synth",
    render: { state: "idle" },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  saveVideo(v);
  i.videoId = v.id;
  return v;
}

/** Trường video được dựng vào MP4 (worker/render.py); đổi trường khác (caption, title, hashtags) không cần render lại. */
export const RENDERED_VIDEO_FIELDS = ["scenes", "tts", "music", "characterId", "settingId"] as const;

/**
 * Nội dung dựng MP4 của video chưa đăng đã đổi: bản render cũ hết hiệu lực (giữ output để đối chiếu),
 * video về "Đang làm" để lịch/tự đăng/đăng ngay không dùng MP4 cũ cho tới khi render và duyệt lại.
 */
export function invalidateRender(v: Video): void {
  if (v.status === "published") return;
  if (v.render.state === "done") v.render.state = "idle";
  v.status = "doing";
}
