import "./channel-env";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, beforeEach, describe, it } from "node:test";
import type { Platform, Profile, PublishResult, ScheduleEntry, Video } from "../lib/types";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-publish-duplicate-"));
const data = path.join(tmp, "data"), media = path.join(tmp, "media");
Object.assign(process.env, { DATA_DIR: data, MEDIA_DIR: media, TZ_OFFSET: "+07:00", PUBLISH_DRY_RUN: "1",
  FB_PAGE_ID: "page-test", FB_PAGE_TOKEN: "test-token", FB_PROFILE: "kenh-zernio-rieng" });
let store: typeof import("../lib/data");
let publish: typeof import("../lib/publish");
const clock = (local: string) => new Date(`${local}+07:00`);

before(async () => {
  store = await import("../lib/data");
  publish = await import("../lib/publish");
});
beforeEach(() => {
  fs.rmSync(data, { recursive: true, force: true });
  fs.rmSync(media, { recursive: true, force: true });
  fs.mkdirSync(path.join(data, "profiles"), { recursive: true });
  fs.mkdirSync(media, { recursive: true });
  const profile: Profile = { slug: "kenh-zernio-rieng", name: "Kênh Zernio Riêng", initials: "CN", sample: false, updatedAt: "",
    tts: { engine: "edge", voice: "vi-VN", rate: "+0%" }, slotTimes: { sang: "07:00", trua: "11:00", chieu: "17:30", toi: "20:00" },
    channels: [{ platform: "facebook", handle: "page-test", name: "FB", connected: true, via: "direct" }],
    sections: { info: [], voice: [], ttsNotes: [], colors: [], hashtags: [] } };
  store.saveProfile(profile);
});

/** A video already posted for real on `posted`, plus one due slot targeting `platforms`. */
function setup(posted: Platform[], platforms: Platform[]) {
  const results: PublishResult[] = posted.map((platform) => ({ platform, ok: true, via: "facebook-reels", id: `${platform}-1`, at: "2026-10-25T04:00:00Z" }));
  const video: Video = { id: "vid-dup", ideaId: "idea-dup", profile: "kenh-zernio-rieng", title: "t", status: "published", caption: "c", hashtags: [],
    scenes: [{ title: "a", narration: "b" }], tts: { engine: "edge", voice: "vi-VN", rate: "+0%" }, music: "none",
    render: { state: "done", output: "out/vid-dup.mp4", finishedAt: "2026-10-25T00:00:00Z" }, publish: results,
    createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z" };
  store.saveVideo(video);
  fs.mkdirSync(path.join(media, "out"), { recursive: true });
  fs.writeFileSync(path.join(media, "out/vid-dup.mp4"), "video fixture");
  const entry: ScheduleEntry = { id: "slot-dup", profile: "kenh-zernio-rieng", date: "2026-10-26", time: "07:00", slot: "sang", videoId: video.id, platforms, status: "planned" };
  store.saveSchedule([entry]);
}

describe("due publishing never reposts a platform that already has a real post", () => {
  it("fails a slot whose platforms were all already posted, without calling any publisher", async () => {
    setup(["facebook", "youtube"], ["facebook", "youtube"]);
    const result = await publish.runDuePublishing(clock("2026-10-26T07:01:00"), 12, () => {});
    const e = store.getSchedule()[0];
    assert.equal(e.status, "failed");
    assert.match(e.note || "", /không tự đăng lại/);
    assert.equal(e.results, undefined);
    assert.equal(result.published, 0);
    assert.equal(store.getVideo("vid-dup")!.publish!.length, 2);
  });

  it("only attempts the platforms that have not been posted yet", async () => {
    setup(["youtube"], ["facebook", "youtube"]);
    await publish.runDuePublishing(clock("2026-10-26T07:01:00"), 12, () => {});
    const e = store.getSchedule()[0];
    assert.deepEqual(e.platforms, ["facebook"]);
    assert.deepEqual((e.results || []).map((r) => r.platform), ["facebook"]);
  });
});
