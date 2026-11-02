import Link from "next/link";
import Thumb from "@/components/Thumb";
import { ideaThumb, videoThumb } from "@/lib/thumbs";
import { currentProfile } from "@/lib/current";
import { addDays, getSchedule, listIdeas, listVideos, localDate, weekday } from "@/lib/data";
import { SLOTS, VIDEO_STATUS_LABEL, type VideoStatus } from "@/lib/types";
import { CELL_LABEL, CELL_STYLE, entryState, stagePills } from "@/lib/view";

const VS_COLOR: Record<VideoStatus, string> = { published: "bg-emerald-800", done: "bg-blue-700", review: "bg-orange-500", doing: "bg-amber-400", todo: "bg-slate-300" };

export default async function TodayPage() {
  const { profile } = await currentProfile();
  if (!profile) return <Empty />;
  const slug = profile.slug;
  const today = localDate();
  const ideasArr = listIdeas(slug);
  const videosArr = listVideos(slug);
  const ideas = new Map(ideasArr.map((i) => [i.id, i]));
  const videos = new Map(videosArr.map((v) => [v.id, v]));
  const sched = getSchedule().filter((e) => e.profile === slug);
  const todays = sched.filter((e) => e.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const days = Array.from({ length: 7 }, (_, k) => addDays(today, k));
  const week = sched.filter((e) => e.date >= today && e.date <= days[6]);

  const errors = [
    ...videosArr.filter((v) => v.render.state === "error").map((v) => `${v.title}: render lỗi`),
    ...week.filter((e) => e.status === "failed").map((e) => `${e.date} ${e.time}: đăng thất bại`),
  ];
  const mow = ideasArr.filter((i) => i.status === "mow" || i.status === "script");
  const legal = ideasArr.filter((i) => i.status === "legal");
  const scheduledVideoIds = new Set(sched.map((e) => e.videoId).filter(Boolean));
  const readyUnscheduled = videosArr.filter((v) => v.status === "done" && !scheduledVideoIds.has(v.id));
  const filled = days.reduce((n, d) => n + SLOTS.filter((s) => week.some((e) => e.date === d && e.slot === s.key)).length, 0);

  const vsCount = (Object.keys(VIDEO_STATUS_LABEL) as VideoStatus[]).map((k) => ({ k, n: videosArr.filter((v) => v.status === k).length }));
  const total = videosArr.length || 1;

  // Biểu đồ: tạo mới (ý tưởng) vs đã publish
  const publishedAt = (id: string) => ideas.get(id)?.history.find((h) => h.to === "published")?.at;
  const weeks = Array.from({ length: 8 }, (_, k) => addDays(today, -7 * (7 - k)));
  const weekly = weeks.map((start) => {
    const end = addDays(start, 7);
    return {
      label: start.slice(5).split("-").reverse().join("/"),
      created: ideasArr.filter((i) => localDate(new Date(i.createdAt)) >= start && localDate(new Date(i.createdAt)) < end).length,
      published: ideasArr.filter((i) => { const p = publishedAt(i.id); return p && localDate(new Date(p)) >= start && localDate(new Date(p)) < end; }).length,
    };
  });
  const months = Array.from({ length: 6 }, (_, k) => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - (5 - k)); return d.toISOString().slice(0, 7); });
  const monthly = months.map((m) => ({
    label: `T${Number(m.slice(5))}`,
    created: ideasArr.filter((i) => localDate(new Date(i.createdAt)).startsWith(m)).length,
    published: ideasArr.filter((i) => { const p = publishedAt(i.id); return p && localDate(new Date(p)).startsWith(m); }).length,
  }));

  const [y, mo, d] = today.split("-");
  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <div className="kicker">{weekday(today)}, {d}/{mo}/{y}</div>
          <h1 className="mt-1 text-2xl font-bold">Hôm nay {profile.name} lên {todays.length} bài</h1>
          <p className="text-xs text-slate-500">Quét dữ liệu lúc {new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })} {d}/{mo}/{y}{profile.sample ? " · profile mẫu" : ""}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/lich-dang" className="btn">▦ Mở lịch</Link>
          <Link href="/y-tuong" className="btn-primary">+ Ý tưởng mới</Link>
        </div>
      </header>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Đang chặn quy trình</h2>
          <span className="text-[11px] text-slate-400">Xếp theo mức chặn</span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Blocker tag="Lỗi" tagCls="bg-rose-100 text-rose-700" sub="render, đăng bài, dữ liệu" n={errors.length} unit="lỗi trong 7 ngày tới" lines={errors} href="/san-xuat" link="Xem mục lỗi" />
          <Blocker tag="MOW" tagCls="bg-amber-100 text-amber-800" sub="chặn bước Validate" n={mow.length} unit="kịch bản chờ MOW" lines={mow.slice(0, 3).map((i) => i.title)} href="/y-tuong?status=mow" link="Mở hàng chờ MOW" />
          <Blocker tag="Legal" tagCls="bg-rose-100 text-rose-700" sub="chặn bước Sản xuất" n={legal.length} unit="mục Legal chưa duyệt" lines={legal.length ? legal.slice(0, 3).map((i) => i.title) : ["Legal xét sau khi MOW duyệt."]} href="/y-tuong?status=legal" link="Xem danh sách" />
          <Blocker tag="Legal" tagCls="bg-emerald-100 text-emerald-700" sub="chặn Đã publish" n={readyUnscheduled.length} unit="video xong, chưa được đăng" lines={readyUnscheduled.slice(0, 3).map((v) => `${v.title}${v.render.duration ? ` (9:16, ${Math.round(v.render.duration)}s)` : ""}`)} href="/san-xuat" link="Mở Sản xuất" />
        </div>
      </section>

      <section className="grid grid-cols-[1fr_290px] gap-4">
        <div className="card">
          <div className="card-h"><h2 className="text-sm font-semibold">Lên sóng hôm nay</h2><Link href="/lich-dang" className="text-[11px] font-medium">Xem ngày ›</Link></div>
          {todays.length === 0 && <p className="px-4 py-6 text-xs text-slate-500">Chưa có bài nào trong lịch hôm nay. Kéo video vào lịch ở trang Lịch đăng.</p>}
          {todays.map((e) => {
            const i = e.ideaId ? ideas.get(e.ideaId) : undefined;
            const v = e.videoId ? videos.get(e.videoId) : undefined;
            const s = SLOTS.find((x) => x.key === e.slot)!;
            return (
              <div key={e.id} className="flex items-start gap-4 border-b border-slate-100 px-4 py-3 last:border-0">
                <Thumb v={v ? videoThumb(v) : i ? ideaThumb(i, videos, profile) : null} className="h-12 w-7" />
                <div className="w-14">
                  <div className="font-mono text-sm font-semibold">{e.time}</div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${s.color}`} />{s.label}</div>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{v?.title || i?.title || "(trống)"}</div>
                  <div className="text-[11px] text-slate-500">{profile.name}: {i?.pillar || "—"} · {i?.hook || ""}</div>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {e.status === "published" ? <span className="pill bg-emerald-100 text-emerald-700">Đã đăng</span> : e.status === "failed" ? <span className="pill bg-rose-100 text-rose-700">Đăng lỗi</span> : stagePills(i, v).map((p) => <span key={p.text} className={`pill ${p.cls}`}>{p.text}</span>)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="card">
          <div className="card-h"><h2 className="text-sm font-semibold">7 ngày tới</h2><span className="text-[11px] text-slate-400">{filled}/28 khung có ý tưởng</span></div>
          <div className="p-3">
            <div className="grid grid-cols-[34px_repeat(7,1fr)] gap-1 text-center text-[10px]">
              <div />
              {days.map((d, k) => (
                <div key={d} className={k === 0 ? "rounded bg-blue-50 font-semibold text-blue-700" : "text-slate-500"}>
                  {k === 0 ? "Hôm nay" : weekday(d)}<div className="font-semibold">{Number(d.slice(8))}</div>
                </div>
              ))}
              {SLOTS.map((s) => (
                <Row key={s.key} label={s.label} cells={days.map((d) => entryState(week.find((e) => e.date === d && e.slot === s.key), ideas, videos))} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500">
              {(Object.keys(CELL_LABEL) as (keyof typeof CELL_LABEL)[]).map((k) => (
                <span key={k} className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-sm border ${CELL_STYLE[k]}`} />{CELL_LABEL[k]}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-h"><h2 className="text-sm font-semibold">{videosArr.length} video của {profile.name}</h2><Link href="/san-xuat" className="text-[11px] font-medium">Mở Sản xuất ›</Link></div>
        <div className="p-4">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
            {vsCount.map(({ k, n }) => n ? <div key={k} className={VS_COLOR[k]} style={{ width: `${(n / total) * 100}%` }} /> : null)}
          </div>
          <div className="mt-3 grid grid-cols-5">
            {vsCount.map(({ k, n }) => (
              <div key={k}>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-600"><span className={`h-2 w-2 rounded-sm ${VS_COLOR[k]}`} />{VIDEO_STATUS_LABEL[k]}</div>
                <div className="text-lg font-bold">{n}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <Chart title="Theo tuần" data={weekly} right="8 tuần" />
        <Chart title="Theo tháng" data={monthly} right="6 tháng" />
      </section>
    </div>
  );
}

function Blocker({ tag, tagCls, sub, n, unit, lines, href, link }: { tag: string; tagCls: string; sub: string; n: number; unit: string; lines: string[]; href: string; link: string }) {
  return (
    <div className="card flex min-h-[150px] flex-col p-4">
      <div className="flex items-center gap-2 text-[11px] text-slate-500"><span className={`pill ${tagCls}`}>{tag}</span>{sub}</div>
      <div className="mt-2 flex items-baseline gap-2"><span className="text-3xl font-bold">{n}</span><span className="text-xs text-slate-600">{unit}</span></div>
      <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">{lines.slice(0, 3).map((l, k) => <li key={k} className="truncate">• {l}</li>)}</ul>
      <Link href={href} className="mt-auto pt-2 text-[11px] font-semibold text-blue-700">{link} ›</Link>
    </div>
  );
}

function Row({ label, cells }: { label: string; cells: (keyof typeof CELL_STYLE)[] }) {
  return (
    <>
      <div className="self-center text-left text-[10px] text-slate-500">{label}</div>
      {cells.map((c, k) => <div key={k} title={CELL_LABEL[c]} className={`h-5 rounded border ${CELL_STYLE[c]}`} />)}
    </>
  );
}

function Chart({ title, data, right }: { title: string; data: { label: string; created: number; published: number }[]; right: string }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.created, d.published]));
  return (
    <div className="card">
      <div className="card-h">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-200" />Tạo mới</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-600" />Đã publish</span>
          <span>{right}</span>
        </div>
      </div>
      <div className="flex h-40 items-end gap-3 px-4 pb-2 pt-4">
        {data.map((d) => (
          <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-28 w-full items-end justify-center gap-0.5">
              <div className="relative w-1/3 rounded-t bg-slate-200" style={{ height: `${(d.created / max) * 100}%` }}>{d.created ? <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] text-slate-500">{d.created}</span> : null}</div>
              <div className="relative w-1/3 rounded-t bg-blue-600" style={{ height: `${(d.published / max) * 100}%` }}>{d.published ? <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] text-blue-700">{d.published}</span> : null}</div>
            </div>
            <div className="text-[9px] text-slate-400">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty() {
  return <div className="card p-8 text-sm text-slate-600">Chưa có profile nào trong <code>data/profiles/</code>. Thêm một file JSON (xem README) hoặc chạy lại seed.</div>;
}
