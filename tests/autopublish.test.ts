/**
 * Đăng tự động 07:30/11:30: hàng đợi theo kế hoạch, khung đến giờ, thử lại 1 lần, chặn đăng thật ngoài profile cho phép,
 * khôi phục khi bị ngắt. Không gọi mạng thật (publish được giả lập).
 */
import "./channel-env";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, beforeEach, describe, it } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-auto-"));
const data = path.join(tmp, "data"), media = path.join(tmp, "media"), plan = path.join(tmp, "plan.md");
Object.assign(process.env, { DATA_DIR: data, MEDIA_DIR: media, PUBLISH_DRY_RUN: "1", AUTOPUBLISH_LIVE_PROFILES: "kenh-lich-su" });
let ap: typeof import("../lib/autopublish");
let dataMod: typeof import("../lib/data");
let pub: typeof import("../lib/publish");
let yt: typeof import("../lib/publishers/youtube");

const PLATS = ["facebook", "instagram", "youtube", "tiktok", "threads"] as const;
const cfg = (extra: Record<string, unknown> = {}) => ({
  profile: "kenh-lich-su", enabled: true, times: ["07:30", "11:30"], platforms: [...PLATS], live: true,
  exclude: ["vid-su-11"], youtubePrivacy: "public" as const, planFile: plan, retryDelayMin: 5, graceMin: 90, ...extra,
}) as import("../lib/autopublish").AutoConfig;

function video(id: string, extra: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(media, "out", `${id}.mp4`), "x");
  fs.writeFileSync(path.join(data, "videos", `${id}.json`), JSON.stringify({
    id, profile: "kenh-lich-su", ideaId: `idea-${id}`, title: `T ${id}`, scenes: [], status: "review", createdAt: "2026-10-10T00:00:00Z",
    render: { state: "done", output: `out/${id}.mp4` }, publish: [], ...extra,
  }));
}
const at = (s: string) => new Date(`${s}+07:00`);

before(async () => {
  ap = await import("../lib/autopublish");
  dataMod = await import("../lib/data");
  pub = await import("../lib/publish");
  yt = await import("../lib/publishers/youtube");
});
beforeEach(() => {
  fs.rmSync(data, { recursive: true, force: true });
  fs.rmSync(media, { recursive: true, force: true });
  for (const d of ["profiles", "videos", "ideas"]) fs.mkdirSync(path.join(data, d), { recursive: true });
  fs.mkdirSync(path.join(media, "out"), { recursive: true });
  for (const [slug, sample] of [["kenh-lich-su", false], ["mau", true]] as const)
    fs.writeFileSync(path.join(data, "profiles", `${slug}.json`), JSON.stringify({ slug, name: slug, sample, channels: [], sections: {}, updatedAt: "" }));
  fs.writeFileSync(plan, [
    "- Tập A (vid-su-11 · E06, Nguồn gốc, đăng #2)",
    "- Tập C (vid-su-14 · E09, Nhân vật, đăng #9)",
    "- Tập B (vid-su-12 · E04, Nhân vật, đăng #5)",
    "- Tập D (vid-su-13 · E07, Chiến trận, đăng #7)",
  ].join("\n"));
});

describe("hàng đợi", () => {
  it("đọc thứ tự đăng từ kế hoạch", () => {
    const m = ap.planOrder(fs.readFileSync(plan, "utf8"));
    assert.equal(m.get("vid-su-12"), 5);
    assert.equal(m.get("vid-su-14"), 9);
  });
  it("theo kế hoạch, chỉ review/done đã render chưa đăng, bỏ exclude", () => {
    video("vid-su-11"); video("vid-su-14"); video("vid-su-13"); video("vid-su-12", { status: "done" });
    video("vid-su-20", { status: "todo", render: { state: "idle" } });
    video("vid-su-21", { render: { state: "done", output: "out/missing.mp4" } });
    fs.unlinkSync(path.join(media, "out", "vid-su-21.mp4"));
    video("vid-su-22", { status: "published" });
    video("vid-su-23", { publish: [{ platform: "facebook", ok: true, via: "facebook-reels", at: "" }] });
    video("vid-su-24", { publish: [{ platform: "facebook", ok: true, via: "dry-run:facebook-reels", at: "" }] });
    assert.deepEqual(ap.autoQueue(cfg(), []).map((v) => v.id), ["vid-su-12", "vid-su-13", "vid-su-14", "vid-su-24"]);
  });
  it("freshOnly không đăng lại video cũ và newest chọn bản mới nhất trong ngày", () => {
    video("vid-su-12", { createdAt: "2026-10-23T23:05:00Z" });
    video("vid-su-13", { createdAt: "2026-10-24T00:00:00Z" });
    video("vid-su-14", { createdAt: "2026-10-23T16:59:00Z" });
    const fresh = cfg({ freshOnly: true, pick: "newest", exclude: [] });
    assert.deepEqual(ap.autoQueue(fresh, [], "2026-10-24").map((v) => v.id), ["vid-su-13", "vid-su-12"]);
    assert.deepEqual(ap.autoQueue(fresh, [], "2026-10-25").map((v) => v.id), []);
    assert.equal(ap.projectSlots(fresh, at("2026-10-24T07:29:00"), 2, []).slots
      .filter((slot) => slot.video).length, 2);
  });
  it("dự kiến khung và ngày hết hàng", () => {
    video("vid-su-12"); video("vid-su-13"); video("vid-su-14");
    const p = ap.projectSlots(cfg(), at("2026-10-18T14:30:00"), 3, []);
    assert.equal(p.queued, 3);
    assert.deepEqual(p.slots.slice(0, 3).map((s) => `${s.date} ${s.time} ${s.video?.id}`), ["2026-10-19 07:30 vid-su-12", "2026-10-19 11:30 vid-su-13", "2026-10-20 07:30 vid-su-14"]);
    assert.equal(`${p.runsOut?.date} ${p.runsOut?.time}`, "2026-10-20 11:30");
  });
});

describe("đăng thật chỉ khi được phép", () => {
  it("cần live=true + AUTOPUBLISH_LIVE_PROFILES + profile không phải mẫu", () => {
    assert.equal(ap.isLive(cfg()), true);
    assert.equal(ap.isLive(cfg({ live: false })), false);
    assert.equal(ap.isLive(cfg(), { AUTOPUBLISH_LIVE_PROFILES: "" }), false);
    assert.equal(ap.isLive(cfg({ profile: "mau" }), { AUTOPUBLISH_LIVE_PROFILES: "mau" }), false);
  });
});

describe("pre-booked slots inherit only approved automatic TikTok settings", () => {
  it("allows a matching approved slot and blocks other times, statuses, profiles and editorial posts", () => {
    video("vid-su-12", { status: "done" });
    const v = dataMod.getVideo("vid-su-12")!;
    const entry = { id: "slot-existing", profile: v.profile, date: "2026-10-19", time: "07:30",
      slot: "sang", videoId: v.id, platforms: ["facebook", "tiktok"], status: "planned" } as import("../lib/types").ScheduleEntry;
    const approved = cfg({ statuses: ["done"], tiktok: { privacyLevel: "PUBLIC_TO_EVERYONE",
      commercial: "none" }, approvedAt: "2026-10-18T13:56:00+07:00", approval: "Chủ kênh duyệt đăng tự động công khai" });
    assert.equal(ap.scheduledAutoSettings(entry, v, [approved])?.tiktokAuto.privacyLevel, "PUBLIC_TO_EVERYONE");
    assert.equal(ap.scheduledAutoSettings({ ...entry, time: "12:00" }, v, [approved]), null);
    assert.equal(ap.scheduledAutoSettings(entry, { ...v, status: "review" }, [approved]), null);
    assert.equal(ap.scheduledAutoSettings({ ...entry, editorial: {} as any }, v, [approved]), null);
    assert.equal(ap.scheduledAutoSettings({ ...entry, platforms: ["tiktok", "threads"] }, v, [cfg({ ...approved, platforms: ["facebook", "tiktok"] })]), null);
    assert.equal(ap.scheduledAutoSettings(entry, v, [cfg({ ...approved, approvedAt: undefined })]), null);
    assert.equal(ap.scheduledAutoSettings(entry, v, [cfg({ ...approved, enabled: false })]), null);
  });
  it("actually publishes TikTok from a pre-booked approved slot (dry-run network)", async () => {
    video("vid-su-12", { status: "done", render: { state: "done", output: "out/vid-su-12.mp4", finishedAt: "2026-10-18T00:00:00Z" } });
    const profile = dataMod.getProfile("kenh-lich-su")!;
    profile.channels = [{ platform: "tiktok", handle: "@test", name: "Test", connected: true, via: "zernio", accountId: "tt-test" }];
    fs.writeFileSync(path.join(data, "profiles", `${profile.slug}.json`), JSON.stringify(profile));
    dataMod.saveSchedule([{ id: "slot-booked", profile: profile.slug, date: "2026-10-19", time: "07:30",
      slot: "sang", videoId: "vid-su-12", platforms: ["tiktok"], status: "planned" }]);
    fs.writeFileSync(path.join(data, "autopublish.json"), JSON.stringify({ profiles: [cfg({
      statuses: ["done"], tiktok: { privacyLevel: "PUBLIC_TO_EVERYONE", commercial: "none" },
      approvedAt: "2026-10-18T13:56:00+07:00", approval: "Chủ kênh duyệt đăng tự động công khai",
    })] }));
    const originalKey = process.env.ZERNIO_API_KEY;
    process.env.ZERNIO_API_KEY = "test-key";
    try {
      await pub.runDuePublishing(at("2026-10-19T07:31:00"), 12, () => {});
      const result = dataMod.getSchedule()[0].results?.find((r) => r.platform === "tiktok");
      assert.equal(result?.ok, true, result?.error);
      assert.equal(result?.via, "dry-run:zernio");
      assert.equal(dataMod.getSchedule()[0].status, "failed"); // dry-run never counts as a real post
    } finally {
      if (originalKey === undefined) delete process.env.ZERNIO_API_KEY;
      else process.env.ZERNIO_API_KEY = originalKey;
    }
  });
});

describe("autoTick", () => {
  it("đăng từng nền tảng một lần, không phát lại lỗi mơ hồ hoặc đăng lại cùng khung", async () => {
    video("vid-su-12"); video("vid-su-13");
    const calls: { id: string; plats: string[]; live?: boolean; yp?: string; tt?: unknown }[] = [];
    const sleeps: number[] = [];
    const publish = (async (id: string, plats: any[], o: any = {}) => {
      calls.push({ id, plats, live: o.live, yp: o.youtubePrivacy, tt: o.tiktokAuto });
      const first = calls.length === 1;
      return plats.map((p: string) => {
        o.onStart?.(p);
        const r = p === "facebook" && first ? { platform: p, ok: false, error: "500", at: "", via: "facebook-reels" }
          : p === "tiktok" ? { platform: p, ok: false, id: "post1", error: "processing failed", at: "", via: "zernio" }
          : { platform: p, ok: true, id: `${p}-id`, url: `https://x/${p}`, at: "", via: p };
        o.onResult?.(r);
        return r;
      });
    }) as any;
    const logs: string[] = [];
    const c = cfg({ tiktok: { privacyLevel: "PUBLIC_TO_EVERYONE", allowComment: true, allowDuet: true, allowStitch: true, commercial: "none" }, approvedAt: "2026-10-18T13:56+07:00" });
    const ran = await ap.autoTick(at("2026-10-19T07:31:00"), { publish, sleep: async (ms) => { sleeps.push(ms); }, log: (s) => logs.push(s) }, [c]);
    assert.equal(ran.length, 1);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { id: "vid-su-12", plats: [...PLATS], live: true, yp: "public", tt: calls[0].tt });
    assert.deepEqual(sleeps, []);
    const e = dataMod.getSchedule().find((x) => x.id === "auto-kenh-lich-su-2026-10-19-0730")!;
    assert.equal(e.status, "published");
    assert.equal(e.slot, "sang");
    assert.equal(e.videoId, "vid-su-12");
    assert.match(e.note!, /3\/5 nền tảng · chưa đăng: facebook, tiktok/);
    assert.equal(e.inflight, undefined);
    // nhịp sau cùng khung: không đăng lại; khung 11:30 lấy video kế tiếp
    assert.equal((await ap.autoTick(at("2026-10-19T07:40:00"), { publish, sleep: async () => {}, log: () => {} }, [c])).length, 0);
    await ap.autoTick(at("2026-10-19T11:30:30"), { publish, sleep: async () => {}, log: () => {} }, [c]);
    assert.equal(calls.at(-1)!.id, "vid-su-13");
  });
  it("ngoài cửa sổ giờ / khung đã quá grace thì không làm gì", async () => {
    video("vid-su-12");
    let n = 0;
    const publish = (async () => { n++; return []; }) as any;
    await ap.autoTick(at("2026-10-19T07:29:00"), { publish, log: () => {} }, [cfg()]);
    await ap.autoTick(at("2026-10-19T09:31:00"), { publish, log: () => {} }, [cfg()]);
    await ap.autoTick(at("2026-10-19T07:40:00"), { publish, log: () => {} }, [cfg({ enabled: false })]);
    assert.equal(n, 0);
  });
  it("hết hàng: ghi log, không tạo khung", async () => {
    const logs: string[] = [];
    await ap.autoTick(at("2026-10-23T07:30:10"), { publish: (async () => { throw new Error("không được gọi"); }) as any, log: (s) => logs.push(s) }, [cfg()]);
    assert.equal(dataMod.getSchedule().length, 0);
    assert.match(logs.join("\n"), /hết video/);
  });
  it("profile không được phép -> live=false (đi theo PUBLISH_DRY_RUN)", async () => {
    video("vid-su-12");
    let live: unknown;
    await ap.autoTick(at("2026-10-19T07:30:10"), { publish: (async (_i: string, _p: any, o: any) => { live = o.live; return []; }) as any, log: () => {}, sleep: async () => {} }, [cfg({ live: false })]);
    assert.equal(live, false);
  });
});

describe("khôi phục khi worker bị ngắt", () => {
  it("nền tảng đang đăng dở -> lỗi kiểm tra thủ công, không đăng lại", () => {
    dataMod.saveSchedule([{ id: "auto-x", profile: "kenh-lich-su", date: "2026-10-19", slot: "sang", time: "07:30", videoId: "vid-su-12", platforms: ["facebook", "instagram", "youtube"], status: "publishing", auto: true, inflight: "instagram", startedAt: "2026-10-18T00:00:00Z",
      results: [{ platform: "facebook", ok: true, id: "1", via: "facebook-reels", at: "" }] } as any]);
    assert.equal(ap.recoverInterrupted(() => {}), 1);
    const e = dataMod.getSchedule()[0];
    assert.equal(e.status, "published");
    assert.match(e.results!.find((r) => r.platform === "instagram")!.error!, /Kiểm tra thủ công/);
    assert.ok(e.results!.find((r) => r.platform === "youtube" && !r.ok));
    assert.equal(ap.recoverInterrupted(() => {}), 0);
  });
});

describe("tiện ích đăng", () => {
  it("realSuccess không tính dry-run", () => {
    assert.equal(pub.realSuccess({ platform: "facebook", ok: true, via: "dry-run:facebook-reels", at: "" }), false);
    assert.equal(pub.realSuccess({ platform: "facebook", ok: true, via: "facebook-reels", at: "" }), true);
  });
  it("YouTube Shorts: thêm #Shorts cho video ngắn, bỏ ký tự < >", () => {
    assert.equal(yt.ytDescription("A <b> c", 45), "A b c\n\n#Shorts");
    assert.equal(yt.ytDescription("x #Shorts", 45), "x #Shorts");
    assert.equal(yt.ytDescription("x", 600), "x");
  });
});
