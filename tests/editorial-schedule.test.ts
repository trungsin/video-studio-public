import "./channel-env";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, beforeEach, describe, it } from "node:test";
import type { Idea, Profile, ScheduleEntry, Video } from "../lib/types";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-editorial-schedule-"));
const data = path.join(tmp, "data"), media = path.join(tmp, "media");
Object.assign(process.env, { DATA_DIR: data, MEDIA_DIR: media, TZ_OFFSET: "+07:00", PUBLISH_DRY_RUN: "1",
  FB_PAGE_ID: "page-test", FB_PAGE_TOKEN: "test-token", FB_PROFILE: "kenh-bien-tap", ZERNIO_API_KEY: "test-key" });
let schedule: typeof import("../lib/editorial-schedule");
let store: typeof import("../lib/data");
let research: typeof import("../lib/idea-research");
let production: typeof import("../lib/editorial-production");
let publish: typeof import("../lib/publish");
let profile: Profile;
const clock = (local: string) => new Date(`${local}+07:00`);
const cfg = (patch: Partial<import("../lib/editorial-schedule").EditorialScheduleConfig> = {}) =>
  ({ enabled: true, publishEnabled: false, paused: false, suppressedDates: [], ...patch });

function fixture(id: string, pillar: string, createdAt = "2026-10-16T00:00:00Z") {
  const script = { scenes: [{ title: "Một con số", narration: "Một con số có nguồn" }], caption: "Một con số", hashtags: [] };
  const draft = { value: 42, unit: "%", quote: "42%", url: "https://example.org/fact", publisher: "Nguồn chính", location: "Việt Nam", conditions: "Năm 2026", caveat: "Ước tính" };
  const digest = research.evidenceDigest(draft);
  const idea = { id: `idea-${id}`, profile: "kenh-bien-tap", title: id, pillar, status: "ready", script,
    evidence: { draft, digest, approved: { digest, at: "2026-10-18T00:00:00Z", by: "owner" } }, history: [], createdAt, updatedAt: createdAt } as Idea;
  const video: Video = { id, profile: "kenh-bien-tap", ideaId: idea.id, title: id, status: "done", caption: "", hashtags: [], scenes: [],
    tts: { engine: "vieneu", voice: "Mai Anh", rate: "+0%" }, music: "none",
    render: { state: "done", output: `${id}.mp4`, finishedAt: `2026-10-18T00:00:00Z-${id}` },
    editorial: { evidenceDigest: digest, scriptDigest: production.scriptDigest(script), renderId: `2026-10-18T00:00:00Z-${id}` },
    publish: [], createdAt, updatedAt: createdAt };
  store.saveIdea(idea); store.saveVideo(video);
  fs.writeFileSync(path.join(media, `${id}.mp4`), "video fixture");
  return { idea, video };
}

before(async () => {
  store = await import("../lib/data");
  research = await import("../lib/idea-research");
  production = await import("../lib/editorial-production");
  schedule = await import("../lib/editorial-schedule");
  publish = await import("../lib/publish");
});
beforeEach(() => {
  fs.rmSync(data, { recursive: true, force: true });
  fs.rmSync(media, { recursive: true, force: true });
  fs.mkdirSync(path.join(data, "profiles"), { recursive: true });
  fs.mkdirSync(media, { recursive: true });
  profile = { slug: "kenh-bien-tap", name: "Kênh Biên Tập", initials: "NS", sample: false, tts: { engine: "vieneu", voice: "Mai Anh", rate: "+0%" }, channels: [
    { platform: "facebook", handle: "page-test", name: "FB", connected: true, via: "direct" },
    { platform: "youtube", handle: "", name: "YT", connected: false, via: "direct" },
    { platform: "tiktok", handle: "@test", name: "TT", connected: true, via: "zernio", accountId: "test-account" },
  ], slotTimes: { sang: "07:00", trua: "11:30", chieu: "17:30", toi: "20:30" }, sections: { info: [], voice: [], ttsNotes: [], colors: [], hashtags: [] }, updatedAt: "" };
  store.saveProfile(profile);
});

describe("Kênh Biên Tập daily reservation", () => {
  it("uses distinct approved videos at 07:00 and 11:30, honors cutoff, alternates pillars and excludes unconsented channels", () => {
    fixture("v-a", "Trời"); fixture("v-b", "Trời", "2026-10-17T00:00:00Z"); fixture("v-c", "Đồ vật", "2026-10-18T00:00:00Z");
    const preview = schedule.planEditorial(clock("2026-10-20T07:01:00"), [], cfg(), store.listVideos("kenh-bien-tap"), profile);
    assert.deepEqual(preview.proposals.map((p) => `${p.date} ${p.time}:${p.videoId}`),
      ["2026-10-20 11:30:v-a", "2026-10-21 07:00:v-c", "2026-10-21 11:30:v-b"]);
    assert.deepEqual(preview.proposals.map((p) => p.platforms), [["facebook"], ["facebook"], ["facebook"]]);
    assert.match(preview.blockers.join(" "), /youtube: chưa kết nối/);
    assert.match(preview.blockers.join(" "), /tiktok: cần xác nhận riêng/);
    assert.deepEqual(schedule.planEditorial(clock("2026-10-20T11:31:00"), [], cfg(), store.listVideos("kenh-bien-tap"), profile)
      .proposals.map((p) => `${p.date} ${p.time}`), ["2026-10-21 07:00", "2026-10-21 11:30", "2026-10-22 07:00"]);
  });

  it("keeps existing morning reservations, respects manual lunch slots, date suppression and idempotence", () => {
    fixture("v-a", "Trời"); fixture("v-b", "Đồ vật"); fixture("v-c", "Trời"); fixture("v-d", "Đồ vật");
    schedule.saveEditorialScheduleConfig(cfg());
    store.saveSchedule([{ id: "manual", profile: "kenh-bien-tap", date: "2026-10-21", time: "12:00", slot: "trua", ideaId: "other", platforms: [], status: "planned" }]);
    schedule.editorialScheduleTick(clock("2026-10-20T06:59:00"));
    const entries = store.getSchedule();
    assert.deepEqual(entries.filter((e) => e.editorial).map((e) => `${e.date} ${e.time}`),
      ["2026-10-20 07:00", "2026-10-20 11:30", "2026-10-21 07:00", "2026-10-22 07:00"]);
    schedule.editorialScheduleTick(clock("2026-10-20T06:59:00"));
    assert.equal(store.getSchedule().length, 5);
    store.withScheduleLock(() => {
      const remaining = store.getSchedule().filter((e) => e.date !== "2026-10-22");
      store.saveSchedule(remaining);
      schedule.saveEditorialScheduleConfig(cfg({ suppressedDates: ["2026-10-22"], paused: true }));
    });
    schedule.editorialScheduleTick(clock("2026-10-20T06:59:00"));
    assert.equal(store.getSchedule().length, 4);
  });

  it("fills only the missing lunch slot without duplicating an already reserved video or a third daily slot", () => {
    const morning = fixture("v-morning", "Trời"), lunch = fixture("v-lunch", "Đồ vật");
    const extra = fixture("v-extra", "Loài Việt Nam", "2026-10-18T00:00:00Z");
    store.saveSchedule([{ id: "morning", profile: "kenh-bien-tap", date: "2026-10-21", time: "07:00", slot: "sang",
      ideaId: morning.idea.id, videoId: morning.video.id, platforms: ["facebook"], status: "planned",
      editorial: schedule.editorialRevision(morning.video)! }]);
    schedule.saveEditorialScheduleConfig(cfg());
    schedule.editorialScheduleTick(clock("2026-10-20T11:31:00"));
    const day = store.getSchedule().filter((e) => e.date === "2026-10-21");
    assert.equal(day.length, 2);
    assert.deepEqual(day.map((e) => e.time), ["07:00", "11:30"]);
    assert.equal(day[1].videoId, lunch.video.id);
    assert.notEqual(day[1].videoId, extra.video.id);
  });

  it("withdraws stale future reservations, but never edits published or publishing slots", () => {
    const { idea, video } = fixture("v-a", "Trời");
    schedule.saveEditorialScheduleConfig(cfg({ paused: true }));
    const original: ScheduleEntry = { id: "stale", profile: "kenh-bien-tap", date: "2026-10-22", time: "07:00", slot: "sang",
      ideaId: idea.id, videoId: video.id, status: "planned", platforms: ["facebook"], editorial: schedule.editorialRevision(video)! };
    store.saveSchedule([original, { ...original, id: "active", date: "2026-10-21", status: "publishing" },
      { ...original, id: "posted", date: "2026-10-20", status: "published" }]);
    idea.script!.caption = "Edited after render"; store.saveIdea(idea);
    schedule.editorialScheduleTick(clock("2026-10-20T07:01:00"));
    assert.deepEqual(store.getSchedule().map((e) => e.id), ["posted", "active"]);
  });
  it("holds the shared schedule lock only for the mutation and releases it", () => {
    let held = false;
    store.withScheduleLock(() => {
      held = fs.existsSync(path.join(data, ".schedule.lock"));
      store.saveSchedule([{ id: "other", profile: "another", date: "2026-10-21", slot: "sang", time: "07:00", platforms: [], status: "planned" }]);
    });
    assert.equal(held, true);
    assert.equal(fs.existsSync(path.join(data, ".schedule.lock")), false);
    assert.equal(store.getSchedule()[0].id, "other");
  });

  it("does not mark a due dry-run as published and never replays ambiguous publishing", async () => {
    const { video } = fixture("v-a", "Trời");
    schedule.saveEditorialScheduleConfig(cfg({ publishEnabled: true }));
    schedule.editorialScheduleTick(clock("2026-10-20T06:59:00"));
    const result = await publish.runDuePublishing(clock("2026-10-20T07:01:00"), 12, () => {});
    assert.equal(result.failed, 1);
    assert.equal(store.getSchedule()[0].status, "failed");
    assert.notEqual(store.getVideo(video.id)?.status, "published");
    const e = store.getSchedule()[0];
    e.status = "publishing"; e.startedAt = "2026-10-19T00:00:00Z"; e.inflight = "facebook"; e.results = [];
    store.saveSchedule([e]);
    assert.equal(publish.recoverDuePublishing(clock("2026-10-20T07:01:00"), () => {}), 1);
    assert.equal(publish.recoverDuePublishing(clock("2026-10-20T07:01:00"), () => {}), 0);
    assert.match(store.getSchedule()[0].results![0].error!, /Kiểm tra thủ công/);
  });
});
