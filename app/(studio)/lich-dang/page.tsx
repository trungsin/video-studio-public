import { isEditorial } from "@/lib/channel-config";
import AutoPublishPanel from "@/components/AutoPublishPanel";
import EditorialScheduleControls from "./EditorialScheduleControls";
import Calendar from "@/components/Calendar";
import { currentProfile } from "@/lib/current";
import { addDays, getSchedule, listIdeas, listVideos, localDate, weekday } from "@/lib/data";
import { editorialPreview } from "@/lib/editorial-schedule";
import { SLOTS, STATUS_LABEL } from "@/lib/types";
import { ideaThumb, videoThumb } from "@/lib/thumbs";
import { entryState } from "@/lib/view";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const { profile } = await currentProfile();
  if (!profile) return <div className="card p-6 text-sm">Chưa có profile.</div>;
  const today = localDate();
  const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : today;
  const days = Array.from({ length: 7 }, (_, k) => addDays(start, k));
  const ideasArr = listIdeas(profile.slug);
  const videosArr = listVideos(profile.slug);
  const ideas = new Map(ideasArr.map((i) => [i.id, i]));
  const videos = new Map(videosArr.map((v) => [v.id, v]));
  const sched = getSchedule().filter((e) => e.profile === profile.slug);
  const scheduledIdeas = new Set(sched.map((e) => e.ideaId));
  const entries = sched.filter((e) => e.date >= days[0] && e.date <= days[6]).map((e) => ({
    id: e.id, date: e.date, slot: e.slot, time: e.time, status: e.status, ideaId: e.ideaId, note: e.note,
    platforms: e.platforms, auto: Boolean(e.auto), editorial: Boolean(e.editorial), results: e.results,
    title: (e.videoId && videos.get(e.videoId)?.title) || (e.ideaId && ideas.get(e.ideaId)?.title) || "(trống)",
    state: entryState(e, ideas, videos),
    thumb: (() => { const v = e.videoId ? videos.get(e.videoId) : undefined; const i = e.ideaId ? ideas.get(e.ideaId) : undefined; return v ? videoThumb(v) : i ? ideaThumb(i, videos, profile) : undefined; })(),
  }));
  const pool = ideasArr
    .filter((i) => !scheduledIdeas.has(i.id) && !["rejected", "published", "idea"].includes(i.status))
    .map((i) => ({ id: i.id, title: i.title, status: i.status, label: STATUS_LABEL[i.status], hasVideo: !!(i.videoId && videos.get(i.videoId)?.render.state === "done"), thumb: ideaThumb(i, videos, profile) }));
  return (
    <div className="space-y-5">
      <header>
        <div className="kicker">Lịch đăng</div>
        <h1 className="mt-1 text-2xl font-bold">{sched.length} khung đã lên lịch</h1>
        <p className="text-xs text-slate-500">Worker <code>worker/publish.ts</code> đăng các khung đến giờ nếu video đã render xong và đã duyệt (Sẵn sàng).</p>
      </header>
      {!isEditorial(profile.slug) && <AutoPublishPanel profile={profile.slug} />}
      {isEditorial(profile.slug) && <EditorialScheduleControls preview={editorialPreview()} name={profile.name} />}
      <Calendar
        days={days.map((d) => ({ date: d, label: d === today ? "Hôm nay" : weekday(d), today: d === today }))}
        slots={SLOTS.map((s) => ({ key: s.key, label: s.label, time: profile.slotTimes[s.key] }))}
        entries={entries}
        pool={pool}
        prev={addDays(start, -7)}
        next={addDays(start, 7)}
      />
    </div>
  );
}
