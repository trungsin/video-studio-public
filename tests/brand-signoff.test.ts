import "./channel-env";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { PATCH } from "../app/api/videos/[id]/route";
import type { getVideo, saveVideo } from "../lib/data";
import { profileSignoff, withSignoff } from "../lib/script-signoff";
import type { Profile, Scene, Video } from "../lib/types";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-brand-signoff-"));
const previousDataDir = process.env.DATA_DIR;
const previousMediaDir = process.env.MEDIA_DIR;
// Both data and the route must load after this test points DATA_DIR at its own fixture directory.
process.env.DATA_DIR = path.join(root, "data");
process.env.MEDIA_DIR = path.join(root, "media");
let store: { getVideo: typeof getVideo; saveVideo: typeof saveVideo };
let patchVideo: typeof PATCH;

before(async () => {
  store = await import("../lib/data");
  ({ PATCH: patchVideo } = await import("../app/api/videos/[id]/route"));
});
beforeEach(() => fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true }));
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  if (previousMediaDir === undefined) delete process.env.MEDIA_DIR;
  else process.env.MEDIA_DIR = previousMediaDir;
});

const opening: Scene = { title: "Mở đầu", narration: "Chuyện gì xảy ra?" };
const ending: Scene = { title: "Kết", narration: "Lời giải và lưu ý.", visual: "Cảnh kết" };
const signoff = "Theo dõi Kênh Zernio Riêng để chăm cây.";

function video(status: Video["status"] = "done", state: Video["render"]["state"] = "done"): Video {
  return {
    id: "vid-brand-test", ideaId: "idea-brand-test", profile: "kenh-zernio-rieng", title: "Chăm cây",
    status, scenes: [opening, ending], caption: "Một cách chăm cây", hashtags: ["#cay"],
    tts: { engine: "edge", voice: "vi-VN", rate: "+0%" }, music: "none",
    render: { state, output: "out/vid-brand-test.mp4", finishedAt: "2026-10-25T00:00:00Z" },
    createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z",
  };
}

async function editScenes() {
  return patchVideo(
    new Request("http://localhost/api/videos/vid-brand-test", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenes: [opening, { ...ending, narration: "Lời giải được sửa." }] }),
    }),
    { params: Promise.resolve({ id: "vid-brand-test" }) },
  );
}

describe("brand signoff in narration", () => {
  it("appends after the last scene once, preserving the opening and other scene properties", () => {
    const scenes = [opening, ending];
    const appended = withSignoff(scenes, signoff);
    assert.equal(appended[0], opening);
    assert.deepEqual(appended[1], { ...ending, narration: `${ending.narration} ${signoff}` });
    assert.equal(scenes[1].narration, ending.narration, "does not change the approved input script");
    assert.equal(withSignoff(appended, signoff), appended, "a second pass must not duplicate the spoken CTA");
  });

  it("returns the original scenes when the signoff or the scene list is empty", () => {
    const scenes = [opening, ending];
    const empty: Scene[] = [];
    assert.equal(withSignoff(scenes, undefined), scenes);
    assert.equal(withSignoff(scenes, ""), scenes);
    assert.equal(withSignoff(empty, signoff), empty);
  });

  it("uses only the Câu kết voice item, ignoring case and surrounding spaces", () => {
    const profile: Profile = {
      slug: "kenh-zernio-rieng", name: "Kênh Zernio Riêng", initials: "CNM", updatedAt: "2026-10-25T00:00:00Z",
      channels: [], tts: { engine: "edge", voice: "vi-VN", rate: "+0%" },
      slotTimes: { sang: "08:00", trua: "12:00", chieu: "16:00", toi: "20:00" },
      sections: { info: [], voice: [
        { id: "cta", label: "CTA", value: "Không phải câu kết" },
        { id: "signoff", label: "  CÂU KẾT  ", value: `  ${signoff}  ` },
      ], ttsNotes: [], colors: [], hashtags: [] },
    };
    assert.equal(profileSignoff(profile), signoff);
    profile.sections.voice = [{ id: "cta", label: "Lời kết", value: "Không được dùng" }];
    assert.equal(profileSignoff(profile), undefined);
    assert.equal(profileSignoff(undefined), undefined);
  });
});

describe("PATCH video content outside Kênh Biên Tập", () => {
  it("invalidates an unpublished completed render without deleting its old output", async () => {
    store.saveVideo(video());
    const response = await editScenes();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "doing");
    assert.equal(body.render.state, "idle");
    assert.equal(body.render.output, "out/vid-brand-test.mp4");
    assert.equal(body.scenes.at(-1).narration, "Lời giải được sửa.");
    const stored = store.getVideo("vid-brand-test")!;
    assert.equal(stored.status, "doing");
    assert.equal(stored.render.state, "idle");
    assert.equal(stored.render.output, "out/vid-brand-test.mp4");
  });

  it("rejects content edits while rendering and leaves the persisted video untouched", async () => {
    store.saveVideo(video("doing", "running"));
    const before = store.getVideo("vid-brand-test");
    const response = await editScenes();
    assert.equal(response.status, 409);
    assert.deepEqual(store.getVideo("vid-brand-test"), before);
  });

  it("keeps the completed render and published status for a published video's content edit", async () => {
    store.saveVideo(video("published"));
    const response = await editScenes();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "published");
    assert.equal(body.render.state, "done");
    assert.equal(body.render.output, "out/vid-brand-test.mp4");
    assert.equal(store.getVideo("vid-brand-test")!.render.state, "done");
  });

  it("keeps an approved render when the editor saves caption changes with unchanged rendered fields", async () => {
    const approved = video();
    store.saveVideo(approved);
    // VideoEditor sends every field on save; only caption differs here.
    const response = await patchVideo(
      new Request("http://localhost/api/videos/vid-brand-test", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: approved.title, caption: "Caption mới", hashtags: approved.hashtags, scenes: approved.scenes, tts: approved.tts, music: approved.music }),
      }),
      { params: Promise.resolve({ id: "vid-brand-test" }) },
    );
    assert.equal(response.status, 200);
    const stored = store.getVideo("vid-brand-test")!;
    assert.equal(stored.caption, "Caption mới");
    assert.equal(stored.status, "done");
    assert.equal(stored.render.state, "done");
  });
});
