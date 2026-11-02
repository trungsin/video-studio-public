import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { approvedEvidence } from "./idea-research";
import { editorialProfile, isEditorial } from "./channel-config";
import { DATA_DIR, getIdea, getProfile, getVideo, listIdeas, MEDIA_DIR, saveIdea, saveVideo, setIdeaStatus } from "./data";
import { llmConfigured, writeScript } from "./llm";
import { ensureVideo } from "./workflow";
import type { Idea, Script, Video } from "./types";


export function scriptDigest(script: Script): string {
  return crypto.createHash("sha256").update(JSON.stringify(script)).digest("hex");
}
/** Check literal numeric claims; written-out numbers still require MOW/Legal review. */
export function validateEditorialScript(idea: Idea): string | null {
  const evidence = approvedEvidence(idea);
  if (!evidence || !idea.script) return "Thiếu nguồn hoặc kịch bản đã duyệt";
  const numbers = (text: string) => [...text.replace(/https?:\/\/\S+/gu, "").matchAll(/(?<![\p{L}\d])\d+(?:[.,]\d+)?(?![\p{L}\d])/gu)].map((match) => Number(match[0].replace(",", ".")));
  if (!numbers(idea.script.caption).includes(evidence.value)) return "Caption phải nêu đúng con số đã duyệt";
  const claims = [idea.script.caption, ...idea.script.scenes.flatMap((scene) => [scene.title, scene.narration])].flatMap(numbers);
  if (claims.some((value) => value !== evidence.value)) return "Kịch bản có số khác số liệu đã duyệt";
  return null;
}

export function editorialValid(idea: Idea, video: Video): boolean {
  const evidence = approvedEvidence(idea);
  return Boolean(evidence && idea.script && video.ideaId === idea.id && isEditorial(video.profile)
    && video.editorial?.evidenceDigest === evidence.digest
    && video.editorial.scriptDigest === scriptDigest(idea.script));
}

/** A change in approved evidence or script must remove downstream publication eligibility. */
export function invalidateEditorial(idea: Idea, note: string): void {
  if (!isEditorial(idea.profile) || idea.status === "published") return;
  idea.review = undefined;
  if (idea.script && !["idea", "script"].includes(idea.status)) setIdeaStatus(idea, "script", note);
  const video = idea.videoId && getVideo(idea.videoId);
  if (video && video.status !== "published") {
    video.status = "doing";
    video.editorial = undefined;
    // Preserve the previous output for diagnosis, but never treat it as the current render.
    if (video.render.state === "done") video.render.state = "idle";
    saveVideo(video);
  }
}

/** Bind the exact reviewed script and source before starting a render. */
export function prepareEditorialVideo(idea: Idea): Video {
  const evidence = approvedEvidence(idea);
  if (!isEditorial(idea.profile) || !evidence || !idea.script || !idea.review?.mow?.ok || !idea.review?.legal?.ok || idea.status !== "production") {
    throw new Error("Cần nguồn và kịch bản được duyệt MOW/Legal trước khi render");
  }
  const numericError = validateEditorialScript(idea);
  if (numericError) throw new Error(numericError);
  const video = ensureVideo(idea);
  const digest = scriptDigest(idea.script);
  if (video.editorial?.evidenceDigest !== evidence.digest || video.editorial?.scriptDigest !== digest) {
    if (video.render.state === "running" || video.render.state === "queued") throw new Error("Video đang render bản trước");
    // Giữ ảnh/clip của cảnh có mô tả hình không đổi: sửa lời đọc không được sinh lại ảnh AI (tốn API, ảnh mới chưa QC).
    const previous = video.scenes;
    video.scenes = idea.script.scenes.map((scene, k) => {
      const old = previous[k];
      return old && old.visual === scene.visual && !scene.image && !scene.clip
        ? { ...scene, image: old.image, clip: old.clip, clipStart: old.clipStart }
        : { ...scene };
    });
    video.caption = idea.script.caption;
    video.hashtags = idea.script.hashtags;
    video.tts = getProfile(editorialProfile())?.tts || video.tts;
    video.sources = [`${evidence.publisher}: ${evidence.url}`];
    video.verifyNotes = `${evidence.value} ${evidence.unit} — ${evidence.quote}\nĐiều kiện: ${evidence.conditions}\nLưu ý: ${evidence.caveat}`;
    video.editorial = { evidenceDigest: evidence.digest, scriptDigest: digest };
    video.render = { state: "idle" };
    video.status = "todo";
    saveVideo(video);
  }
  return video;
}

/** Shared with manual render endpoint. Python's media/render.lock serializes actual encodes. */
export function queueVideoRender(video: Video): number | undefined {
  if (["queued", "running"].includes(video.render.state)) throw new Error("Đang render");
  if (!video.scenes.some((scene) => scene.narration.trim())) throw new Error("Chưa có lời đọc");
  if (isEditorial(video.profile)) {
    const idea = getIdea(video.ideaId);
    if (!idea || !editorialValid(idea, video) || idea.status !== "production" || !idea.review?.legal?.ok) {
      throw new Error("Nguồn hoặc kịch bản chưa được duyệt cho bản video hiện tại");
    }
  }
  video.render = { state: "queued", progress: 0, log: ["Đã đưa vào hàng đợi"] };
  video.status = "doing";
  saveVideo(video);
  fs.mkdirSync(path.join(MEDIA_DIR, "logs"), { recursive: true });
  const out = fs.openSync(path.join(MEDIA_DIR, "logs", `${video.id}.log`), "a");
  try {
    const child = spawn(process.env.PYTHON_BIN || "python3", [path.resolve("worker/render.py"), "--video", video.id, "--data", DATA_DIR, "--media", MEDIA_DIR], {
      detached: true, stdio: ["ignore", out, out], env: process.env,
    });
    child.on("error", (error) => {
      const latest = getVideo(video.id);
      if (latest?.render.state === "queued") {
        latest.render = { state: "error", error: error.message, log: [error.message] };
        saveVideo(latest);
      }
    });
    child.unref();
    return child.pid;
  } finally { fs.closeSync(out); }
}

/** Check objective media properties, not editorial quality. */
export function checkRenderedMedia(video: Video): string | null {
  if (video.render.state !== "done" || !video.render.output) return "Render chưa hoàn tất";
  const root = path.resolve(MEDIA_DIR);
  const output = path.resolve(root, video.render.output);
  if (!output.startsWith(root + path.sep) || !fs.existsSync(output) || !fs.statSync(output).size) return "Thiếu MP4 hợp lệ";
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", output], { encoding: "utf8", timeout: 15000 });
  if (probe.status !== 0) return "Không đọc được MP4";
  try {
    const metadata: unknown = JSON.parse(probe.stdout);
    if (!metadata || typeof metadata !== "object" || !("streams" in metadata) || !Array.isArray(metadata.streams)) return "Metadata MP4 không hợp lệ";
    const streams: unknown[] = metadata.streams;
    const picture = streams.find((stream) => stream && typeof stream === "object" && "codec_type" in stream && stream.codec_type === "video");
    if (!picture || typeof picture !== "object" || !("width" in picture) || !("height" in picture)
      || typeof picture.width !== "number" || typeof picture.height !== "number" || !picture.height
      || Math.abs(picture.width / picture.height - 9 / 16) > 0.02) return "Khung hình không phải 9:16";
    if (!streams.some((stream) => stream && typeof stream === "object" && "codec_type" in stream && stream.codec_type === "audio")) return "Video không có âm thanh";
    return null;
  } catch { return "Metadata MP4 không hợp lệ"; }
}

/** One idempotent pass; user approvals remain explicit gates. */
export async function productionTick(): Promise<{ action: string; id?: string }> {
  if (process.env.EDITORIAL_PRODUCTION_ENABLED !== "1") return { action: "disabled" };
  const slug = editorialProfile();
  if (!slug) return { action: "disabled" };   // chưa đặt editorialProfile(): không có profile biên tập
  const ideas = listIdeas(slug).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const idea of ideas) {
    if (!approvedEvidence(idea) || idea.status === "published" || idea.status === "rejected") continue;
    if (idea.status === "idea" && !idea.script) {
      if (!llmConfigured()) return { action: "missing-llm", id: idea.id };
      const profile = getProfile(editorialProfile());
      if (!profile) return { action: "missing-profile" };
      const approvedDigest = approvedEvidence(idea)?.digest;
      const updatedAt = idea.updatedAt;
      const proposed = await writeScript(profile, idea);
      const current = getIdea(idea.id);
      if (!current || approvedEvidence(current)?.digest !== approvedDigest || current.updatedAt !== updatedAt || current.status !== "idea" || current.script) continue;
      current.script = proposed;
      setIdeaStatus(current, "script", "Kịch bản từ nguồn đã duyệt");
      saveIdea(current);
      return { action: "script", id: current.id };
    }
    if (idea.status !== "production") continue;
    const video = prepareEditorialVideo(idea);
    if (video.render.state === "done") {
      if (!editorialValid(idea, video)) continue;
      const error = checkRenderedMedia(video);
      if (error) {
        video.render = { ...video.render, state: "error", error };
        saveVideo(video);
        return { action: "invalid-render", id: idea.id };
      }
      if (!video.render.finishedAt) return { action: "invalid-render", id: idea.id };
      if (video.editorial?.renderId === video.render.finishedAt && video.status === "done") continue;
      video.editorial = { ...video.editorial!, renderId: video.render.finishedAt };
      video.status = "done";
      saveVideo(video);
      setIdeaStatus(idea, "ready", "MP4 đạt kiểm tra kỹ thuật; tự hoàn tất sản xuất");
      saveIdea(idea);
      return { action: "ready", id: idea.id };
    }
    if (video.render.state === "idle") {
      if (listIdeas(editorialProfile()).some((candidate) => {
        const active = candidate.videoId && getVideo(candidate.videoId);
        return active && active.id !== video.id && ["queued", "running"].includes(active.render.state);
      })) return { action: "render-busy" };
      queueVideoRender(video);
      return { action: "render-queued", id: idea.id };
    }
  }
  return { action: "idle" };
}
