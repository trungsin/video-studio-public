import Link from "next/link";
import { isLive, loadAutoConfig, projectSlots, readState } from "@/lib/autopublish";
import { getSchedule, weekday } from "@/lib/data";

const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "—";

/** Thẻ "Đăng tự động": khung sắp tới, video trong hàng đợi, ngày hết hàng, kết quả gần nhất. compact = bản rút gọn cho /profile. */
export default function AutoPublishPanel({ profile, compact = false }: { profile: string; compact?: boolean }) {
  const cfg = loadAutoConfig().find((c) => c.profile === profile);
  if (!cfg) return compact ? null : (
    <section className="card p-4 text-xs text-slate-500">Đăng tự động: chưa cấu hình cho profile này (data/autopublish.json).</section>
  );
  const st = readState();
  const hbAge = st.heartbeat ? (Date.now() - new Date(st.heartbeat).getTime()) / 60e3 : Infinity;
  const workerOk = hbAge < 3;
  const live = isLive(cfg);
  const { slots, queued, runsOut } = projectSlots(cfg);
  const recent = getSchedule().filter((e) => e.auto && e.profile === profile).sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || "")).slice(0, compact ? 2 : 6);
  const shown = slots.slice(0, compact ? 4 : 10);
  return (
    <section className="card space-y-3 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Đăng tự động</span>
        <span className={`pill ${cfg.enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{cfg.enabled ? "BẬT" : "TẮT"}</span>
        <span className={`pill ${live ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>{live ? "ĐĂNG THẬT" : "dry-run"}</span>
        <span className={`pill ${workerOk ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>worker {workerOk ? "đang chạy" : st.heartbeat ? `im lặng ${Math.round(hbAge)} phút` : "chưa chạy"}</span>
        <span className="text-xs text-slate-500">{cfg.times.join(" & ")} hằng ngày (giờ VN) → {cfg.platforms.join(", ")}</span>
      </div>
      <p className="text-xs text-slate-600">
        Hàng đợi: <b>{queued}</b> khung có video
        {runsOut ? <> · hết video từ <b>{weekday(runsOut.date)} {runsOut.date.slice(8, 10)}/{runsOut.date.slice(5, 7)} {runsOut.time}</b> (khung trống sẽ được bỏ qua và ghi log)</> : null}
        . Thứ tự theo kế hoạch nội dung; chỉ video Chờ duyệt/Sẵn sàng đã render, chưa đăng{cfg.exclude?.length ? `, trừ ${cfg.exclude.join(", ")}` : ""}.
      </p>
      <ul className="divide-y divide-slate-100 text-xs">
        {shown.map((s) => (
          <li key={`${s.date}-${s.time}`} className="flex gap-3 py-1">
            <span className="w-28 shrink-0 tabular-nums text-slate-500">{weekday(s.date)} {s.date.slice(8, 10)}/{s.date.slice(5, 7)} {s.time}</span>
            {s.video ? <span><code>{s.video.id}</code> {s.video.title}</span> : <span className="text-slate-400">— hết hàng đợi —</span>}
          </li>
        ))}
      </ul>
      {recent.length > 0 && (
        <div className="text-xs">
          <div className="mb-1 font-medium text-slate-600">Đã chạy gần đây</div>
          {recent.map((e) => (
            <div key={e.id} className="py-0.5">
              <span className="tabular-nums text-slate-500">{e.date} {e.time}</span> <code>{e.videoId}</code>{" "}
              <span className={e.status === "published" ? "text-emerald-700" : e.status === "failed" ? "text-rose-700" : "text-amber-700"}>{e.status}</span>{" "}
              {(e.results || []).filter((r, i, a) => a.findLastIndex((x) => x.platform === r.platform) === i).map((r) => (
                r.url && r.ok ? <a key={r.platform} href={r.url} target="_blank" rel="noreferrer" className="mr-1 text-emerald-700 underline">{r.platform}</a>
                  : <span key={r.platform} title={r.error} className={`mr-1 ${r.ok ? "text-emerald-700" : "text-rose-700"}`}>{r.platform}{r.ok ? "" : "✗"}</span>
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-400">
        Cập nhật lần cuối của worker: {fmt(st.heartbeat)}. Cấu hình data/autopublish.json · log /tmp/video-studio-autopublish.log
        {compact && <> · <Link href="/lich-dang" className="underline">xem lịch đăng</Link></>}
      </p>
    </section>
  );
}
