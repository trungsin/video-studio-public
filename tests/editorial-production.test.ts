import "./channel-env";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Idea, Video } from "../lib/types";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-editorial-"));
// These modules capture DATA_DIR at import time, so import after setting isolated test env.
process.env.DATA_DIR = path.join(root, "data");
process.env.MEDIA_DIR = path.join(root, "media");
let research: typeof import("../lib/idea-research");
let production: typeof import("../lib/editorial-production");
let store: typeof import("../lib/data");

before(async () => {
  research = await import("../lib/idea-research");
  production = await import("../lib/editorial-production");
  store = await import("../lib/data");
});
beforeEach(() => {
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  for (const dir of ["ideas", "videos", "profiles"]) fs.mkdirSync(path.join(process.env.DATA_DIR!, dir), { recursive: true });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture() {
  const draft = {
    value: 17, unit: "giờ", quote: "Nhóm tỉnh táo trong 17 giờ có phản ứng chậm hơn",
    url: "https://example.org/study", publisher: "Viện nghiên cứu", location: "Bảng 1",
    conditions: "thử nghiệm người trưởng thành", caveat: "Không áp dụng cho trẻ em",
  };
  const digest = research.evidenceDigest(draft);
  const script = {
    scenes: [{ title: "Một con số", narration: "Mười bảy giờ là thời gian được đo.", visual: "sleep study chart" }],
    caption: "Một phép đo về tỉnh táo", hashtags: ["#NoiCoSo"],
  };
  const idea: Idea = {
    id: "idea-ncs-test", profile: "kenh-bien-tap", title: "Sau một đêm không ngủ", status: "ready",
    history: [], script, evidence: { draft, digest, approved: { digest, at: "2026-10-20T00:00:00Z", by: "admin" } },
    review: { mow: { ok: true, at: "2026-10-20T00:00:00Z" }, legal: { ok: true, at: "2026-10-20T00:00:00Z" } },
    videoId: "vid-ncs-test", createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z",
  };
  const video: Video = {
    id: "vid-ncs-test", ideaId: idea.id, profile: idea.profile, title: idea.title, status: "done",
    scenes: script.scenes, caption: script.caption, hashtags: script.hashtags,
    tts: { engine: "vieneu", voice: "Mai Anh", rate: "+0%" }, music: "none",
    render: { state: "done", output: "out/vid-ncs-test.mp4", finishedAt: "2026-10-20T01:00:00Z" },
    editorial: { evidenceDigest: digest, scriptDigest: production.scriptDigest(script), renderId: "2026-10-20T01:00:00Z" },
    createdAt: idea.createdAt, updatedAt: idea.updatedAt,
  };
  return { idea, video };
}

describe("Kênh Biên Tập content revisions", () => {
  it("rejects a video when the approved source or script changes", () => {
    const { idea, video } = fixture();
    assert.equal(production.editorialValid(idea, video), true);
    idea.evidence!.draft.value = 18;
    assert.equal(research.approvedEvidence(idea), null);
    assert.equal(production.editorialValid(idea, video), false);
    idea.evidence!.draft.value = 17;
    idea.script!.scenes[0].narration = "Nội dung thay đổi sau khi duyệt.";
    assert.equal(production.editorialValid(idea, video), false);
  });

  it("withdraws ready/render eligibility after an editorial revision", () => {
    const { idea, video } = fixture();
    store.saveIdea(idea);
    store.saveVideo(video);
    production.invalidateEditorial(idea, "Nguồn thay đổi");
    store.saveIdea(idea);
    const storedIdea = store.getIdea(idea.id)!;
    const storedVideo = store.getVideo(video.id)!;
    assert.equal(storedIdea.status, "script");
    assert.equal(storedIdea.review, undefined);
    assert.equal(storedVideo.status, "doing");
    assert.equal(storedVideo.render.state, "idle");
    assert.equal(storedVideo.editorial, undefined);
  });
  it("requires the approved numeric claim in caption and rejects an extra claim", () => {
    const { idea } = fixture();
    assert.match(production.validateEditorialScript(idea) || "", /Caption/);
    idea.script!.caption = "Sau 17 giờ, phản ứng chậm đi.";
    assert.equal(production.validateEditorialScript(idea), null);
    idea.script!.scenes[0].narration = "Sau 18 giờ thì sao?";
    assert.match(production.validateEditorialScript(idea) || "", /số khác/);
  });
  it("does not mistake digits in a source URL for another numeric claim", () => {
    const { idea } = fixture();
    idea.script!.caption = "Sau 17 giờ. Nguồn: https://example.org/studies/2026/17.html";
    assert.equal(production.validateEditorialScript(idea), null);
    idea.script!.caption = "Sau 18 giờ. Nguồn: https://example.org/studies/2026/17.html";
    assert.match(production.validateEditorialScript(idea) || "", /Caption/);
  });
  it("keeps scene media whose visual is unchanged when a revised script is prepared, so only changed visuals are regenerated", () => {
    const { idea, video } = fixture();
    idea.script = {
      scenes: [
        { title: "Một con số", narration: "Mười bảy giờ là thời gian được đo.", visual: "sleep study chart" },
        { title: "Kết", narration: "Có số mới nói.", visual: "poster with channel logo" },
      ],
      caption: "Sau 17 giờ, phản ứng chậm đi.", hashtags: ["#NoiCoSo"],
    };
    video.scenes = [
      { ...idea.script.scenes[0], image: "uploads/vid-ncs-test/scene-0-ai.png" },
      { ...idea.script.scenes[1], image: "uploads/vid-ncs-test/scene-1-ai.png" },
    ];
    store.saveVideo(video);
    // Revision: narration of scene 1 and visual of scene 2 change (as an approved script edit would).
    idea.script.scenes = [
      { ...idea.script.scenes[0], narration: "Mười bảy giờ là thời gian được đo trong nghiên cứu." },
      { ...idea.script.scenes[1], visual: "street scene, no text, no logo" },
    ];
    idea.status = "production";
    store.saveIdea(idea);
    const prepared = production.prepareEditorialVideo(idea);
    assert.equal(prepared.scenes[0].image, "uploads/vid-ncs-test/scene-0-ai.png");
    assert.equal(prepared.scenes[0].narration, "Mười bảy giờ là thời gian được đo trong nghiên cứu.");
    assert.equal(prepared.scenes[1].image, undefined);
    assert.equal(store.getVideo(video.id)!.scenes[0].image, "uploads/vid-ncs-test/scene-0-ai.png");
  });
});
