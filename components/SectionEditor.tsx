"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Item = { id: string; label: string; value: string; ref?: string; hex?: string };
type Section = "info" | "voice" | "ttsNotes" | "colors" | "hashtags";

async function call(slug: string, body: unknown) {
  const r = await fetch(`/api/profiles/${slug}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) alert((await r.json().catch(() => ({}))).error || "Lỗi lưu");
}

export default function SectionEditor({ slug, section, title, items, hashtags, layout = "rows" }: { slug: string; section: Section; title: string; items?: Item[]; hashtags?: string[]; layout?: "rows" | "colors" | "chips" | "wide" }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Item>({ id: "", label: "", value: "", hex: "#cccccc" });
  const [menu, setMenu] = useState<string | null>(null);
  const [tag, setTag] = useState("");
  const count = layout === "chips" ? hashtags?.length || 0 : items?.length || 0;

  const start = (it?: Item) => { setDraft(it ? { ...it } : { id: "", label: "", value: "", hex: "#cccccc" }); setEditing(it ? it.id : "new"); setMenu(null); };
  const save = async () => {
    await call(slug, { section, op: editing === "new" ? "add" : "update", item: draft });
    setEditing(null); router.refresh();
  };
  const del = async (id: string) => {
    if (!confirm("Xoá mục này?")) return;
    await call(slug, { section, op: "delete", item: { id } }); setMenu(null); router.refresh();
  };

  const form = (
    <div className="space-y-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
      <input className="input" placeholder="Nhãn (VD: Tính cách)" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
      {layout === "colors" && <div className="flex items-center gap-2"><input type="color" value={draft.hex} onChange={(e) => setDraft({ ...draft, hex: e.target.value })} /><input className="input font-mono" value={draft.hex} onChange={(e) => setDraft({ ...draft, hex: e.target.value })} /></div>}
      <textarea className="input min-h-[70px]" placeholder="Nội dung" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
      <div className="flex gap-2"><button className="btn-primary" onClick={save}>Lưu</button><button className="btn" onClick={() => setEditing(null)}>Huỷ</button></div>
    </div>
  );

  const dots = (it: Item) => (
    <div className="relative">
      <button className="px-1 text-slate-500 hover:text-slate-900" onClick={() => setMenu(menu === it.id ? null : it.id)}>•••</button>
      {menu === it.id && (
        <div className="absolute right-0 z-10 w-24 rounded-lg border border-slate-200 bg-white py-1 text-xs shadow-lg">
          <button className="block w-full px-3 py-1 text-left hover:bg-slate-50" onClick={() => start(it)}>Sửa</button>
          <button className="block w-full px-3 py-1 text-left text-red-600 hover:bg-slate-50" onClick={() => del(it.id)}>Xoá</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="card">
      <div className="card-h">
        <h2 className="text-sm font-semibold">{title} <span className="ml-1 text-xs font-normal text-slate-400">{count}</span></h2>
        {layout !== "chips" && <button className="text-[11px] font-medium hover:text-blue-700" onClick={() => start()}>+ Thêm</button>}
      </div>
      {editing === "new" && form}
      {layout === "colors" && (
        <div className="grid grid-cols-3 gap-2 p-3">
          {items?.map((it) => editing === it.id ? <div key={it.id} className="col-span-3">{form}</div> : (
            <div key={it.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2">
              <span className="mt-0.5 h-6 w-6 shrink-0 rounded border border-slate-200" style={{ background: it.hex }} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold">{it.label}</div>
                <div className="truncate font-mono text-[10px] text-slate-500" title={it.value}>{it.hex}{it.value ? ` · ${it.value}` : ""}</div>
              </div>
              {dots(it)}
            </div>
          ))}
        </div>
      )}
      {layout === "chips" && (
        <div className="p-3">
          <div className="flex flex-wrap gap-1.5">
            {hashtags?.map((h) => (
              <span key={h} className="group inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[11px]">
                {h}
                <button title="Xoá" className="hidden text-slate-400 hover:text-red-600 group-hover:inline" onClick={async () => { await call(slug, { section, op: "delete", item: { id: h } }); router.refresh(); }}>×</button>
              </span>
            ))}
          </div>
          <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!tag.trim()) return; await call(slug, { section, op: "add", item: { id: tag.trim(), label: "", value: tag.trim() } }); setTag(""); router.refresh(); }}>
            <input className="input" placeholder="#hashtag mới" value={tag} onChange={(e) => setTag(e.target.value)} />
            <button className="btn">+ Thêm</button>
          </form>
        </div>
      )}
      {(layout === "rows" || layout === "wide") && items?.map((it) => editing === it.id ? <div key={it.id}>{form}</div> : (
        <div key={it.id} className={`grid ${layout === "wide" ? "grid-cols-[160px_1fr_28px]" : "grid-cols-[120px_1fr_28px]"} gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0`}>
          <div className="text-xs text-slate-500">{it.label}</div>
          <div>
            <div className="whitespace-pre-line text-xs">{it.value}</div>
            {it.ref && <div className="ref mt-0.5">{it.ref}</div>}
          </div>
          {dots(it)}
        </div>
      ))}
    </div>
  );
}
