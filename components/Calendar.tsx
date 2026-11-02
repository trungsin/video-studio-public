"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Visual } from "@/lib/thumbs";
import Thumb from "./Thumb";

type Cell = { id: string; date: string; slot: string; time: string; title: string; state: string; status: string; ideaId?: string; thumb?: Visual;
  auto?: boolean; editorial?: boolean; note?: string; platforms?: string[]; results?: { platform: string; ok: boolean; via: string; error?: string }[] };
type Pool = { id: string; title: string; status: string; label: string; hasVideo: boolean; thumb?: Visual };

const STATE_CLS: Record<string, string> = {
  ready: "border-emerald-300 bg-emerald-50", pending: "border-amber-200 bg-amber-50", error: "border-rose-300 bg-rose-50",
};

export default function Calendar({ days, slots, entries, pool, prev, next }: { days: { date: string; label: string; today: boolean }[]; slots: { key: string; label: string; time: string }[]; entries: Cell[]; pool: Pool[]; prev: string; next: string }) {
  const router = useRouter();
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function assign(ideaId: string, date: string, slot: string) {
    setBusy(true);
    const r = await fetch("/api/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ideaId, date, slot }) });
    setBusy(false);
    if (!r.ok) alert((await r.json()).error); router.refresh();
  }
  async function remove(id: string) {
    const r = await fetch(`/api/schedule?id=${id}`, { method: "DELETE" });
    if (!r.ok) alert((await r.json()).error); router.refresh();
  }

  return (
    <div className="grid grid-cols-[1fr_240px] items-start gap-4">
      <div className="card overflow-hidden">
        <div className="card-h">
          <div className="flex items-center gap-2">
            <Link href={`/lich-dang?from=${prev}`} className="btn">‹</Link>
            <Link href="/lich-dang" className="btn">Hôm nay</Link>
            <Link href={`/lich-dang?from=${next}`} className="btn">›</Link>
          </div>
          <span className="text-[11px] text-slate-400">{busy ? "Đang lưu…" : "Kéo ý tưởng/video từ cột phải thả vào khung · kéo thẻ trong lịch để đổi khung"}</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: `70px repeat(${days.length}, minmax(0,1fr))` }}>
          <div className="border-b border-slate-100" />
          {days.map((d) => (
            <div key={d.date} className={`border-b border-l border-slate-100 px-1 py-2 text-center text-[10px] ${d.today ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-500"}`}>
              {d.label}<div className="text-sm font-semibold">{Number(d.date.slice(8))}/{Number(d.date.slice(5, 7))}</div>
            </div>
          ))}
          {slots.map((s) => (
            <Row key={s.key}>
              <div className="border-b border-slate-100 px-2 py-2 text-[10px] text-slate-500"><div className="font-semibold text-slate-700">{s.label}</div><div className="font-mono">{s.time}</div></div>
              {days.map((d) => {
                const key = `${d.date}|${s.key}`;
                const e = entries.find((x) => x.date === d.date && x.slot === s.key);
                return (
                  <div
                    key={key}
                    onDragOver={(ev) => { ev.preventDefault(); setOver(key); }}
                    onDragLeave={() => setOver(null)}
                    onDrop={(ev) => { ev.preventDefault(); setOver(null); const id = ev.dataTransfer.getData("text/idea"); if (id) assign(id, d.date, s.key); }}
                    className={`min-h-[78px] border-b border-l border-slate-100 p-1 ${over === key ? "bg-blue-50" : ""}`}
                  >
                    {e && (
                      <div draggable={e.status === "planned"} onDragStart={(ev) => e.ideaId && ev.dataTransfer.setData("text/idea", e.ideaId)} className={`group relative h-full cursor-grab rounded-md border p-1.5 text-[10px] leading-tight ${e.status === "published" ? "border-emerald-400 bg-emerald-100" : e.status === "failed" ? STATE_CLS.error : STATE_CLS[e.state] || "border-slate-200"}`}>
                        <div className="flex gap-1">{e.thumb && e.thumb.kind !== "none" && <Thumb v={e.thumb} className="h-10 w-6" />}<div className="line-clamp-3 font-medium text-slate-800">{e.title}</div></div>
                        <div className="mt-0.5 text-slate-500">{e.auto && `${e.time} · tự động · `}{e.status === "published" ? "✓ đã đăng" : e.status === "failed" ? "✗ chưa đăng/đối soát" : e.status === "publishing" ? "đang đăng" : e.state === "ready" ? "sẵn sàng" : "chờ duyệt"}</div>
                        {(e.auto || e.editorial) && <div className="mt-0.5 text-slate-500">{e.platforms?.join(", ")}{e.note && <div>{e.note}</div>}{e.results?.map((r, i) => <div key={`${r.platform}-${i}`}>{r.platform}: {r.ok && !r.via.startsWith("dry-run") ? "đã đăng" : r.error || "chưa đăng"} ({r.via})</div>)}</div>}
                        {e.status === "planned" && <button onClick={() => remove(e.id)} aria-label={`Gỡ ${e.title} khỏi lịch`} className="absolute right-0.5 top-0.5 hidden rounded px-1 text-slate-400 hover:bg-white hover:text-red-600 group-hover:block">×</button>}
                      </div>
                    )}
                  </div>
                );
              })}
            </Row>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h2 className="text-sm font-semibold">Chưa lên lịch <span className="ml-1 text-xs font-normal text-slate-400">{pool.length}</span></h2></div>
        <div className="max-h-[70vh] space-y-1.5 overflow-y-auto p-2">
          {pool.length === 0 && <p className="p-2 text-[11px] text-slate-500">Hết ý tưởng chờ lịch. Thêm ở Sổ ý tưởng.</p>}
          {pool.map((p) => (
            <div key={p.id} draggable onDragStart={(ev) => ev.dataTransfer.setData("text/idea", p.id)} className="cursor-grab rounded-lg border border-slate-200 bg-white p-2 text-[11px] hover:border-blue-300">
              <div className="flex gap-2">{p.thumb && p.thumb.kind !== "none" && <Thumb v={p.thumb} className="h-10 w-6" />}<div className="min-w-0 flex-1"><div className="font-medium">{p.title}</div>
              <div className="mt-0.5 flex gap-1"><span className="pill bg-slate-100 text-slate-600">{p.label}</span>{p.hasVideo && <span className="pill bg-blue-50 text-blue-700">có video</span>}</div></div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
