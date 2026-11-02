import Link from "next/link";
import IdeaActions from "@/components/IdeaActions";
import IdeaToolbar from "@/components/IdeaToolbar";
import { currentProfile } from "@/lib/current";
import Thumb from "@/components/Thumb";
import { listIdeas, listVideos } from "@/lib/data";
import { ideaThumb } from "@/lib/thumbs";
import { llmConfigured } from "@/lib/llm";
import { STATUS_FLOW, STATUS_LABEL, type IdeaStatus } from "@/lib/types";

const STATUS_CLS: Record<IdeaStatus, string> = {
  idea: "bg-slate-100 text-slate-600", script: "bg-sky-50 text-sky-700", mow: "bg-amber-100 text-amber-800", legal: "bg-orange-100 text-orange-800",
  production: "bg-blue-50 text-blue-700", ready: "bg-emerald-50 text-emerald-700", scheduled: "bg-indigo-50 text-indigo-700", published: "bg-emerald-100 text-emerald-800", rejected: "bg-rose-100 text-rose-700",
};

export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { profile } = await currentProfile();
  const all = listIdeas(profile?.slug);
  const list = status ? all.filter((i) => i.status === status) : all;
  const videos = new Map(listVideos(profile?.slug).map((v) => [v.id, v]));
  const tabs: (IdeaStatus | "")[] = ["", ...STATUS_FLOW, "rejected"];
  return (
    <div className="space-y-5">
      <header>
        <div className="kicker">Sổ ý tưởng</div>
        <h1 className="mt-1 text-2xl font-bold">{all.length} ý tưởng của {profile?.name}</h1>
        <p className="text-xs text-slate-500">Quy trình: Ý tưởng → Kịch bản → MOW (duyệt nội dung) → Legal → Sản xuất → Sẵn sàng → Lên lịch → Đã đăng</p>
      </header>
      <div className="flex gap-2"><Link href="/y-tuong/bang" className="btn">⌗ Bảng nối dây (thời kỳ × series)</Link></div>
      <IdeaToolbar llm={llmConfigured()} />
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => {
          const n = t ? all.filter((i) => i.status === t).length : all.length;
          const active = (status || "") === t;
          return <Link key={t || "all"} href={t ? `/y-tuong?status=${t}` : "/y-tuong"} className={`rounded-lg px-2.5 py-1 text-xs ${active ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{t ? STATUS_LABEL[t] : "Tất cả"} <span className="opacity-60">{n}</span></Link>;
        })}
      </div>
      <div className="card divide-y divide-slate-100">
        {list.length === 0 && <p className="p-6 text-xs text-slate-500">Không có ý tưởng ở bước này.</p>}
        {list.map((i) => (
          <div key={i.id} className="flex items-start gap-4 px-4 py-3">
            <Thumb v={ideaThumb(i, videos, profile)} className="h-12 w-7" />
            <span className={`pill mt-0.5 w-20 justify-center ${STATUS_CLS[i.status]}`}>{STATUS_LABEL[i.status]}</span>
            <div className="min-w-0 flex-1">
              <Link href={`/y-tuong/${i.id}`} className="text-sm font-medium hover:text-blue-700">{i.title}</Link>
              {i.sample && <span className="pill ml-2 bg-amber-50 text-amber-700">mẫu</span>}
              <div className="text-[11px] text-slate-500">{[i.pillar, i.hook].filter(Boolean).join(" · ")}</div>
              {i.script && <div className="mt-0.5 text-[11px] text-slate-400">{i.script.scenes.length} cảnh · {i.script.scenes.reduce((n, s) => n + s.narration.split(/\s+/).length, 0)} từ</div>}
              {(i.review?.mow?.ok === false || i.review?.legal?.ok === false) && <div className="mt-0.5 text-[11px] text-rose-600">↩ {i.review?.legal?.ok === false ? `Legal: ${i.review.legal.note || ""}` : `MOW: ${i.review?.mow?.note || ""}`}</div>}
            </div>
            <IdeaActions id={i.id} status={i.status} hasScript={!!i.script} videoId={i.videoId} />
          </div>
        ))}
      </div>
    </div>
  );
}
