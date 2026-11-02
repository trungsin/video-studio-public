/**
 * Đặt nhãn kênh (profile.brand), câu kết "Câu kết" và nối câu kết vào lời cảnh cuối
 * của kịch bản/video CHƯA ĐĂNG. Mặc định chỉ xem trước; ghi dữ liệu khi có --apply.
 *   npx tsx scripts/migrate-video-brand-cta.ts [--apply] [--config data/brand-cta.json] [--videos slug-a,slug-b] [--include-video vid-x]
 * Không đụng: video/ý tưởng đã đăng (kể cả một nền tảng), video đang render, khung đang đăng.
 * Video bị đổi lời: render cũ hết hiệu lực (status doing, render idle), cần render + duyệt lại.
 * Chạy lại an toàn: câu kết đã có thì bỏ qua.
 */
import { loadEnv } from "./load-env";

loadEnv();
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes("--apply");

/**
 * Cấu hình thương hiệu đã duyệt: JSON `{"profiles": {"<slug>": {"brand", "signoff?"}}, "videos": ["<slug>", ...]}`.
 * Mặc định `data/brand-cta.json` (dữ liệu của bản triển khai, không có trong code); `--config <file>` để đổi.
 * "videos" = profile được sửa lời video chưa đăng (ghi đè bằng --videos).
 */
type BrandCfg = { profiles: Record<string, { brand: string; signoff?: string }>; videos?: string[] };

async function main() {
  const { getProfile, saveProfile, listVideos, listIdeas, getIdea, saveIdea, saveVideo, getSchedule, newId } = await import("../lib/data");
  const { realSuccess } = await import("../lib/publish");
  const { DATA_DIR } = await import("../lib/data");
  const { isEditorial } = await import("../lib/channel-config");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const cfgFile = arg("config") || path.join(DATA_DIR, "brand-cta.json");
  const BRAND = JSON.parse(fs.readFileSync(cfgFile, "utf8")) as BrandCfg;
  const PROFILES = BRAND.profiles || {};
  const { withSignoff } = await import("../lib/script-signoff");
  type Scene = import("../lib/types").Scene;

  const videoProfiles = (arg("videos") ? arg("videos")!.split(",") : BRAND.videos || []).filter(Boolean);
  const include = new Set((arg("include-video") || "").split(",").filter(Boolean));
  for (const slug of videoProfiles) if (!PROFILES[slug]) throw new Error(`Profile ngoài phạm vi: ${slug}`);
  // Profile biên tập khóa kịch bản bằng digest nguồn/kịch bản/render đã duyệt: đổi lời phải qua luồng duyệt biên tập.
  const locked = videoProfiles.find((slug) => isEditorial(slug));
  if (locked) throw new Error(`${locked}: sửa câu kết qua luồng duyệt biên tập, không qua migration`);

  // 1. Profile: nhãn + mục "Câu kết" (cập nhật mục sẵn có, không tạo trùng).
  for (const [slug, cfg] of Object.entries(PROFILES)) {
    const p = getProfile(slug);
    if (!p) { console.log(`PROFILE ${slug}: không có, bỏ qua`); continue; }
    const item = p.sections.voice.find((x) => x.label.trim().toLowerCase() === "câu kết");
    const changes = [p.brand !== cfg.brand && `brand=${cfg.brand}`, cfg.signoff && item?.value !== cfg.signoff && `câu kết=${cfg.signoff}`].filter(Boolean);
    console.log(`PROFILE ${slug}: ${changes.join(" · ") || "đã đúng"}`);
    if (!apply || !changes.length) continue;
    p.brand = cfg.brand;
    if (cfg.signoff) {
      if (item) item.value = cfg.signoff;
      else p.sections.voice.push({ id: newId("voice"), label: "Câu kết", value: cfg.signoff });
    }
    saveProfile(p);
  }

  const sched = getSchedule();
  const lockedBySchedule = new Set(sched.filter((e) => e.videoId && (e.status === "publishing" || e.status === "published")).map((e) => e.videoId!));
  const fix = (scenes: Scene[], signoff: string) => withSignoff(scenes, signoff);
  const same = (a: Scene[], b: Scene[]) => JSON.stringify(a) === JSON.stringify(b);

  // 2. Video chưa đăng + kịch bản ý tưởng gắn với video.
  const touchedIdeas = new Set<string>();
  for (const slug of videoProfiles) {
    const signoff = PROFILES[slug].signoff;
    if (!signoff) continue;
    for (const v of listVideos(slug)) {
      if (include.size && !include.has(v.id)) continue;
      const published = v.status === "published" || (v.publish || []).some(realSuccess) || lockedBySchedule.has(v.id);
      const idea = v.ideaId ? getIdea(v.ideaId) : null;
      const skip = published ? "đã đăng/đang đăng" : ["queued", "running"].includes(v.render.state) ? "đang render" : idea?.status === "published" ? "ý tưởng đã đăng" : "";
      if (skip) { console.log(`SKIP ${v.id} (${slug}): ${skip}`); continue; }
      const next = fix(v.scenes, signoff);
      const ideaNext = idea?.script ? fix(idea.script.scenes, signoff) : null;
      const videoChanged = !same(next, v.scenes);
      const ideaChanged = Boolean(ideaNext && idea?.script && !same(ideaNext, idea.script.scenes));
      console.log(JSON.stringify({ video: v.id, profile: slug, status: v.status, render: v.render.state, videoChanged, ideaChanged, hook: v.scenes[0]?.narration, end: next.at(-1)?.narration }));
      if (!apply) continue;
      if (videoChanged) {
        v.scenes = next;
        v.status = "doing";
        if (v.render.state === "done") v.render.state = "idle"; // giữ output để đối chiếu, không còn là bản hiện hành
        saveVideo(v);
      }
      if (idea && ideaChanged && ideaNext && idea.script) {
        idea.script = { ...idea.script, scenes: ideaNext };
        idea.history = [...(idea.history || []), { at: new Date().toISOString(), from: idea.status, to: idea.status, note: "Thêm câu kết thương hiệu vào cảnh cuối; video cần render và duyệt lại" }];
        saveIdea(idea);
      }
      if (idea) touchedIdeas.add(idea.id);
    }
    // 3. Kịch bản chưa có video, chưa qua duyệt (status script): chỉ thêm câu kết, giữ trạng thái.
    for (const idea of listIdeas(slug)) {
      if (touchedIdeas.has(idea.id) || idea.videoId || !idea.script) continue;
      if (idea.status !== "script") {
        if (!same(fix(idea.script.scenes, signoff), idea.script.scenes)) console.log(`SKIP IDEA ${idea.id}: trạng thái ${idea.status}, cần sửa qua bước duyệt`);
        continue;
      }
      const next = fix(idea.script.scenes, signoff);
      if (same(next, idea.script.scenes)) continue;
      console.log(`IDEA ${idea.id}: thêm câu kết`);
      if (!apply) continue;
      idea.script = { ...idea.script, scenes: next };
      saveIdea(idea);
    }
  }
  console.log(apply ? "ĐÃ ÁP DỤNG" : "XEM TRƯỚC (thêm --apply để ghi)");
}
main().catch((e) => { console.error("Lỗi:", (e as Error).message); process.exitCode = 1; });
