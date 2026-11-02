"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CastRef } from "@/lib/types";

type Kind = "characters" | "settings";

function Group({ slug, kind, title, items, hint }: { slug: string; kind: Kind; title: string; items: CastRef[]; hint: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState<{ name: string; description: string; files: FileList | null } | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [desc, setDesc] = useState("");
  const url = `/api/profiles/${slug}/cast`;
  const done = async (r: Response) => { setBusy(""); if (!r.ok) alert((await r.json().catch(() => ({}))).error || "Lỗi"); router.refresh(); };

  async function create() {
    if (!draft?.name.trim()) return;
    const fd = new FormData();
    fd.append("action", "create"); fd.append("kind", kind); fd.append("name", draft.name); fd.append("description", draft.description);
    for (const f of Array.from(draft.files || [])) fd.append("files", f);
    setBusy("create"); await done(await fetch(url, { method: "POST", body: fd })); setDraft(null);
  }
  async function addRefs(id: string, files: FileList) {
    const fd = new FormData(); fd.append("action", "addRefs"); fd.append("kind", kind); fd.append("id", id);
    for (const f of Array.from(files)) fd.append("files", f);
    setBusy(id); await done(await fetch(url, { method: "POST", body: fd }));
  }
  async function generate(id: string) {
    setBusy(`gen${id}`);
    await done(await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "generate", kind, id }) }));
  }
  const patch = async (body: object) => done(await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, ...body }) }));

  return (
    <div className="card">
      <div className="card-h">
        <h3 className="text-sm font-semibold">{title} <span className="ml-1 text-xs font-normal text-slate-400">{items.length}</span></h3>
        <button className="text-[11px] font-medium hover:text-blue-700" onClick={() => setDraft({ name: "", description: "", files: null })}>+ Thêm</button>
      </div>
      {draft && (
        <div className="space-y-2 border-b border-slate-100 bg-slate-50 p-4">
          <input className="input" placeholder="Tên (VD: Mây)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <textarea className="input min-h-[70px]" placeholder={hint} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <input type="file" accept="image/*" multiple className="text-xs" onChange={(e) => setDraft({ ...draft, files: e.target.files })} />
          <div className="flex gap-2"><button className="btn-primary" disabled={busy === "create"} onClick={create}>Lưu</button><button className="btn" onClick={() => setDraft(null)}>Huỷ</button></div>
        </div>
      )}
      {items.length === 0 && !draft && <p className="p-4 text-xs text-slate-500">Chưa có. Thêm ảnh tham chiếu để mọi cảnh giữ cùng gương mặt/trang phục/bối cảnh.</p>}
      {items.map((it) => (
        <div key={it.id} className="border-b border-slate-100 p-4 last:border-0">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-semibold">{it.name} <span className="ml-1 font-mono text-[10px] font-normal text-slate-400">{it.id}</span></div>
            <button className="text-[11px] text-red-500" onClick={async () => { if (confirm("Xoá?")) done(await fetch(`${url}?kind=${kind}&id=${it.id}`, { method: "DELETE" })); }}>Xoá</button>
          </div>
          {edit === it.id ? (
            <div className="mt-1 space-y-1">
              <textarea className="input min-h-[70px] text-xs" value={desc} onChange={(e) => setDesc(e.target.value)} />
              <div className="flex gap-2"><button className="btn-primary" onClick={() => { patch({ id: it.id, description: desc }); setEdit(null); }}>Lưu</button><button className="btn" onClick={() => setEdit(null)}>Huỷ</button></div>
            </div>
          ) : (
            <p className="mt-1 cursor-text text-[11px] text-slate-600" title="Bấm để sửa" onClick={() => { setEdit(it.id); setDesc(it.description); }}>{it.description || <i className="text-slate-400">(chưa có mô tả, bấm để thêm)</i>}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {it.refs.map((r, k) => (
              <div key={r} className="group relative">
                <img src={`/api/assets/${r.replace(/^assets\//, "")}`} alt="" className={`h-24 w-[72px] rounded-md border object-cover ${k === 0 ? "border-blue-400" : "border-slate-200"}`} />
                <div className="absolute inset-x-0 bottom-0 hidden justify-between rounded-b-md bg-black/60 px-1 text-[9px] text-white group-hover:flex">
                  {k > 0 ? <button onClick={() => patch({ id: it.id, makeFirst: r })}>chính</button> : <span>chính</span>}
                  <button onClick={() => patch({ id: it.id, removeRef: r })}>xoá</button>
                </div>
              </div>
            ))}
            <label className="grid h-24 w-[72px] cursor-pointer place-items-center rounded-md border border-dashed border-slate-300 text-center text-[10px] text-slate-400">
              {busy === it.id ? "…" : "+ Ảnh"}
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files?.length && addRefs(it.id, e.target.files)} />
            </label>
            <button className="grid h-24 w-[72px] place-items-center rounded-md border border-dashed border-slate-300 text-center text-[10px] text-slate-500 hover:border-blue-300" disabled={!!busy} onClick={() => generate(it.id)}>
              {busy === `gen${it.id}` ? "Đang tạo…" : "✨ Tạo ảnh AI"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CastEditor({ slug, characters, settings }: { slug: string; characters: CastRef[]; settings: CastRef[] }) {
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">Nhân vật &amp; bối cảnh</h2>
      <p className="mb-2 text-[11px] text-slate-500">Ảnh đầu tiên (viền xanh) là ảnh chính. Mô tả + ảnh tham chiếu được gửi kèm mỗi lần tạo ảnh cảnh để giữ nhân vật và bối cảnh nhất quán. Nhân vật phải là người hư cấu hoặc người đã đồng ý.</p>
      <div className="grid grid-cols-2 items-start gap-4">
        <Group slug={slug} kind="characters" title="Nhân vật" items={characters} hint="Mô tả cố định (tiếng Anh tốt hơn): tuổi, gương mặt, tóc, trang phục, phụ kiện" />
        <Group slug={slug} kind="settings" title="Bối cảnh" items={settings} hint="Mô tả không gian: phòng, vật dụng, màu sắc, ánh sáng" />
      </div>
    </section>
  );
}
