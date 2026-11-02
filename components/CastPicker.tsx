"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Opt = { id: string; name: string; thumb?: string };

/** Chọn nhân vật + bối cảnh cho ý tưởng/video (PATCH {characterId, settingId}). */
export default function CastPicker({ url, characters, settings, characterId, settingId, disabled }: { url: string; characters: Opt[]; settings: Opt[]; characterId?: string; settingId?: string; disabled?: boolean }) {
  const router = useRouter();
  const [c, setC] = useState(characterId || characters[0]?.id || "");
  const [s, setS] = useState(settingId || settings[0]?.id || "");
  async function save(nc: string, ns: string) {
    setC(nc); setS(ns);
    const r = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterId: nc, settingId: ns }) });
    if (!r.ok) alert((await r.json()).error); router.refresh();
  }
  if (!characters.length && !settings.length) return <p className="text-[11px] text-slate-500">Chưa có nhân vật/bối cảnh. Thêm ở Profile &amp; kênh.</p>;
  const thumb = (o?: Opt) => o?.thumb ? <img src={`/api/assets/${o.thumb.replace(/^assets\//, "")}`} alt="" className="h-10 w-8 rounded object-cover" /> : null;
  return (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <label className="flex items-center gap-2">{thumb(characters.find((x) => x.id === c))}<span className="flex-1 space-y-1"><span className="block text-slate-500">Nhân vật</span>
        <select disabled={disabled} className="input" value={c} onChange={(e) => save(e.target.value, s)}>{characters.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></span></label>
      <label className="flex items-center gap-2">{thumb(settings.find((x) => x.id === s))}<span className="flex-1 space-y-1"><span className="block text-slate-500">Bối cảnh</span>
        <select disabled={disabled} className="input" value={s} onChange={(e) => save(c, e.target.value)}>{settings.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></span></label>
    </div>
  );
}
