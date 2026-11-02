import Link from "next/link";
import { currentProfile } from "@/lib/current";
import { listVideos } from "@/lib/data";
import Thumb from "@/components/Thumb";
import { videoThumb } from "@/lib/thumbs";
import { VIDEO_STATUS_LABEL } from "@/lib/types";

const RENDER: Record<string, string> = { idle: "Chưa render", queued: "Chờ render", running: "Đang render", done: "Đã render", error: "Lỗi render" };
const RCLS: Record<string, string> = { idle: "bg-slate-100 text-slate-600", queued: "bg-blue-50 text-blue-700", running: "bg-blue-50 text-blue-700", done: "bg-emerald-50 text-emerald-700", error: "bg-rose-100 text-rose-700" };

export default async function ProductionPage() {
  const { profile } = await currentProfile();
  const videos = listVideos(profile?.slug);
  return (
    <div className="space-y-5">
      <header>
        <div className="kicker">Sản xuất</div>
        <h1 className="mt-1 text-2xl font-bold">{videos.length} video</h1>
        <p className="text-xs text-slate-500">Video được tạo tự động khi ý tưởng qua bước Legal. Mỗi video: TTS → ảnh/clip theo cảnh → render MP4 9:16 có phụ đề chạy theo từng từ.</p>
      </header>
      <div className="card divide-y divide-slate-100">
        {videos.length === 0 && <p className="p-6 text-xs text-slate-500">Chưa có video. Duyệt MOW + Legal một ý tưởng ở Sổ ý tưởng để tạo job.</p>}
        {videos.map((v) => (
          <Link key={v.id} href={`/san-xuat/${v.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50">
            <Thumb v={videoThumb(v)} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{v.title}{v.sample && <span className="pill ml-2 bg-amber-50 text-amber-700">mẫu</span>}</div>
              <div className="text-[11px] text-slate-500">{v.scenes.length} cảnh · giọng {v.tts.voice}{v.render.duration ? ` · ${v.render.duration.toFixed(1)}s` : ""}</div>
              {v.render.error && <div className="truncate text-[11px] text-rose-600">{v.render.error}</div>}
            </div>
            <span className={`pill ${RCLS[v.render.state]}`}>{RENDER[v.render.state]}{v.render.state === "running" && v.render.progress ? ` ${Math.round(v.render.progress * 100)}%` : ""}</span>
            <span className="pill w-20 justify-center bg-slate-100 text-slate-700">{VIDEO_STATUS_LABEL[v.status]}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
