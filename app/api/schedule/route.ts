import { isEditorial } from "@/lib/channel-config";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getIdea, getProfile, getSchedule, getVideo, MEDIA_DIR, newId, saveIdea, saveSchedule, setIdeaStatus, withScheduleLock } from "@/lib/data";
import { allowedEditorialPlatforms, editorialRevision, readEditorialScheduleConfig, saveEditorialScheduleConfig } from "@/lib/editorial-schedule";
import type { ScheduleEntry, SlotKey } from "@/lib/types";

const SLOT_KEYS: SlotKey[] = ["sang", "trua", "chieu", "toi"];

export async function GET() {
  return NextResponse.json(getSchedule());
}

/** Gán ý tưởng/video vào khung (date, slot). Ghi đè nếu khung đã có bài chưa đăng. */
export async function POST(req: Request) {
  const b = await req.json();
  const { date, slot, ideaId } = b as { date: string; slot: SlotKey; ideaId: string };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !SLOT_KEYS.includes(slot)) return NextResponse.json({ error: "Khung không hợp lệ" }, { status: 400 });
  const idea = getIdea(ideaId);
  if (!idea) return NextResponse.json({ error: "Không tìm thấy ý tưởng" }, { status: 404 });
  const p = getProfile(idea.profile);
  return withScheduleLock(() => {
    const entries = getSchedule();
    const clash = entries.find((e) => e.profile === idea.profile && e.date === date && (e.slot === slot || (isEditorial(idea.profile) && e.time === (p?.slotTimes[slot] || "12:00"))));
    if (clash && clash.status !== "planned") return NextResponse.json({ error: "Khung đang đăng, đã đăng hoặc cần đối soát" }, { status: 409 });
    if (isEditorial(idea.profile) && entries.filter((e) => e.profile === idea.profile && e.date === date && e !== clash).length >= 2)
      return NextResponse.json({ error: "Profile biên tập tối đa hai bài mỗi ngày" }, { status: 409 });
    const rest = entries.filter((e) => e !== clash && !(e.ideaId === idea.id && e.status === "planned"));
    const v = idea.videoId ? getVideo(idea.videoId) : null;
    let editorial: ScheduleEntry["editorial"];
    let platforms = (b.platforms as ScheduleEntry["platforms"]) || (p?.channels.filter((c) => c.connected).map((c) => c.platform) ?? []);
    if (isEditorial(idea.profile)) {
      const revision = v && editorialRevision(v);
      if (!v || v.status !== "done" || v.render.state !== "done" || !v.render.output || !fs.existsSync(path.join(MEDIA_DIR, v.render.output)) || !revision || !p)
        return NextResponse.json({ error: "Video chưa hoàn tất hoặc nguồn, kịch bản, bản render đã đổi" }, { status: 409 });
      const allowed = allowedEditorialPlatforms(p, v).platforms;
      if (b.platforms && (!Array.isArray(b.platforms) || !b.platforms.length || b.platforms.some((plat: string) => !allowed.includes(plat as typeof allowed[number]))))
        return NextResponse.json({ error: "Có nền tảng chưa kết nối, chưa cấu hình hoặc TikTok thiếu xác nhận bản render" }, { status: 409 });
      platforms = b.platforms || allowed;
      if (!platforms.length) return NextResponse.json({ error: "Chưa có nền tảng đăng hợp lệ" }, { status: 409 });
      editorial = revision;
    }
    const entry: ScheduleEntry = {
      id: newId("slot"), profile: idea.profile, date, slot, time: p?.slotTimes[slot] || "12:00", ideaId: idea.id, videoId: v?.id,
      platforms, status: "planned", ...(editorial ? { editorial } : {}),
    };
    rest.push(entry);
    saveSchedule(rest);
    if (idea.status === "ready") { setIdeaStatus(idea, "scheduled", `Lên lịch ${date} ${entry.time}`); saveIdea(idea); }
    return NextResponse.json(entry);
  });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  return withScheduleLock(() => {
    const entries = getSchedule();
    const e = entries.find((x) => x.id === id);
    if (!e) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
    if (e.status !== "planned") return NextResponse.json({ error: "Chỉ có thể gỡ bài chưa đăng" }, { status: 409 });
    if (isEditorial(e.profile)) {
      const cfg = readEditorialScheduleConfig();
      if (!cfg.suppressedDates.includes(e.date)) cfg.suppressedDates.push(e.date);
      saveEditorialScheduleConfig(cfg);
    }
    saveSchedule(entries.filter((x) => x.id !== id));
    const idea = e.ideaId ? getIdea(e.ideaId) : null;
    if (idea?.status === "scheduled") { setIdeaStatus(idea, "ready", "Gỡ khỏi lịch"); saveIdea(idea); }
    return NextResponse.json({ ok: true });
  });
}

/** Owner's explicit switches; never enable live publishing as a side effect of planning. */
export async function PATCH(req: Request) {
  const b = await req.json() as { enabled?: boolean; paused?: boolean; publishEnabled?: boolean; restoreDate?: string };
  if (!Object.keys(b).length || Object.keys(b).some((k) => !["enabled", "paused", "publishEnabled", "restoreDate"].includes(k))
    || (b.enabled !== undefined && typeof b.enabled !== "boolean")
    || (b.paused !== undefined && typeof b.paused !== "boolean")
    || (b.publishEnabled !== undefined && typeof b.publishEnabled !== "boolean")
    || (b.restoreDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(b.restoreDate)))
    return NextResponse.json({ error: "Cấu hình không hợp lệ" }, { status: 400 });
  return withScheduleLock(() => {
    const cfg = readEditorialScheduleConfig();
    if (b.enabled !== undefined) cfg.enabled = b.enabled;
    if (b.paused !== undefined) cfg.paused = b.paused;
    if (b.publishEnabled !== undefined) cfg.publishEnabled = b.publishEnabled;
    if (b.restoreDate) cfg.suppressedDates = cfg.suppressedDates.filter((date) => date !== b.restoreDate);
    saveEditorialScheduleConfig(cfg);
    return NextResponse.json(cfg);
  });
}
