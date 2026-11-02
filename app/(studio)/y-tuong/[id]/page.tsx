import { isEditorial } from "@/lib/channel-config";
import Link from "next/link";
import { notFound } from "next/navigation";
import CastPicker from "@/components/CastPicker";
import IdeaActions from "@/components/IdeaActions";
import IdeaEvidenceEditor from "@/components/IdeaEvidenceEditor";
import ScriptEditor from "@/components/ScriptEditor";
import { castOf } from "@/lib/cast";
import { getIdea, getProfile, listIdeas } from "@/lib/data";
import { approvedEvidence, duplicateOf } from "@/lib/idea-research";
import { STATUS_FLOW, STATUS_LABEL } from "@/lib/types";

export default async function IdeaDetail({ params }: { params: Promise<{ id: string }> }) {
  const i = getIdea((await params).id);
  if (!i) notFound();
  const at = STATUS_FLOW.indexOf(i.status);
  const locked = !["idea", "script"].includes(i.status);
  const cast = castOf(getProfile(i.profile));
  const opt = (x: { id: string; name: string; refs: string[] }) => ({ id: x.id, name: x.name, thumb: x.refs[0] });
  const isNcs = isEditorial(i.profile);
  const near = isNcs ? duplicateOf(i, listIdeas(i.profile).filter((other) => other.id !== i.id)) : null;
  return (
    <div className="space-y-5">
      <div className="flex gap-3 text-xs"><Link href="/y-tuong" className="text-slate-500">‹ Sổ ý tưởng</Link><Link href={`/y-tuong/canvas/${i.videoId || i.id}`} className="text-blue-700">⌗ Mở canvas nối dây</Link></div>
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="kicker">{i.id}{i.sample ? " · mẫu" : ""}</div>
          <h1 className="mt-1 text-2xl font-bold">{i.title}</h1>
          <p className="text-xs text-slate-500">{[i.pillar, i.hook, i.angle].filter(Boolean).join(" · ")}</p>
        </div>
        <IdeaActions id={i.id} status={i.status} hasScript={!!i.script} videoId={i.videoId} />
      </header>
      <div className="flex gap-1">
        {STATUS_FLOW.map((s, k) => (
          <div key={s} className={`flex-1 rounded-md py-1.5 text-center text-[10px] font-medium ${i.status === "rejected" ? "bg-slate-100 text-slate-400" : k < at ? "bg-emerald-100 text-emerald-700" : k === at ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"}`}>{STATUS_LABEL[s]}</div>
        ))}
      </div>
      {isNcs && <>
        {near && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Có thể trùng câu hỏi/cơ chế với <Link className="underline" href={`/y-tuong/${near.id}`}>{near.title}</Link>. So sánh trước khi nghiên cứu; dùng nút “Loại” nếu trùng.</p>}
        <IdeaEvidenceEditor ideaId={i.id} initial={i.evidence} initiallyApproved={!!approvedEvidence(i)} searchAvailable={!!process.env.BRAVE_SEARCH_API_KEY} hint={i.plan?.sources || i.title} />
      </>}
      <div className="card p-4">
        <div className="mb-2 text-sm font-semibold">Nhân vật &amp; bối cảnh của video</div>
        <CastPicker url={`/api/ideas/${i.id}`} characters={cast.characters.map(opt)} settings={cast.settings.map(opt)} characterId={i.characterId} settingId={i.settingId} disabled={locked} />
        <p className="mt-2 text-[11px] text-slate-500">AI viết kịch bản sẽ gắn mô tả nhân vật + bối cảnh này vào prompt ảnh của mọi cảnh.</p>
      </div>
      <div className="grid grid-cols-[1fr_300px] items-start gap-4">
        {i.script || !locked ? <ScriptEditor id={i.id} script={i.script} readOnly={locked} /> : <div className="card p-6 text-xs text-slate-500">Chưa có kịch bản.</div>}
        <div className="card">
          <div className="card-h"><h2 className="text-sm font-semibold">Lịch sử</h2></div>
          <ol className="space-y-2 p-4 text-[11px]">
            {[...i.history].reverse().map((h, k) => (
              <li key={k}>
                <div className="font-medium">{h.from ? `${STATUS_LABEL[h.from]} → ` : ""}{STATUS_LABEL[h.to]}</div>
                <div className="text-slate-500">{new Date(h.at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}{h.note ? ` · ${h.note}` : ""}</div>
              </li>
            ))}
          </ol>
          {locked && <p className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">Kịch bản bị khoá sau khi gửi MOW. Trả lại để sửa.</p>}
        </div>
      </div>
    </div>
  );
}
