"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isVideoRef, mediaUrl, thumbUrl } from "@/lib/media-url";
import type { ArchiveView } from "@/lib/thumbs";
import type { Scene, Video } from "@/lib/types";
import CastPicker from "./CastPicker";
import TikTokPanel from "./TikTokPanel";
import { VOICES } from "./TtsSettings";

type Opt = { id: string; name: string; thumb?: string };

/** Ô hình của cảnh: clip (poster + phát lặp), ảnh, hoặc ảnh tư liệu đầu tiên + số ảnh. */
function SceneMedia({ s, archive, placeholder }: { s: Scene; archive: Record<string, ArchiveView>; placeholder: string }) {
  const m = s.clip || s.image;
  if (m) return isVideoRef(m)
    ? <video src={mediaUrl(m)} poster={thumbUrl(m, 360)} className="h-full w-full object-cover" muted autoPlay loop playsInline preload="metadata" />
    : <img src={thumbUrl(m, 360)} alt="" className="h-full w-full object-cover" />;
  const items = (s.archive?.items || []).map((x) => archive[x.id]).filter((x) => x && !x.missing);
  if (items.length) return (
    <>
      <img src={items[0].thumb} alt={items[0].label} title={`${items[0].label}\n${items[0].credit}`} className="h-full w-full object-cover" />
      <span className="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-medium text-white">📷 {items.length} ảnh tư liệu</span>
    </>
  );
  if (s.archive?.query) return <span className="px-1">📷 Ảnh tư liệu: tự tìm “{s.archive.query}” khi render</span>;
  return <span className="px-1">{placeholder}</span>;
}

/** Danh sách ảnh tư liệu của cảnh: nhãn + ghi công + link trang Commons. */
function ArchiveList({ s, archive }: { s: Scene; archive: Record<string, ArchiveView> }) {
  const items = (s.archive?.items || []).map((x) => archive[x.id] || { id: x.id, label: x.label || x.id, missing: true } as ArchiveView);
  if (!items.length) return null;
  return (
    <ul className="space-y-1 rounded-md border border-amber-100 bg-amber-50/50 p-1.5 text-[11px]">
      {items.map((a) => (
        <li key={a.id} className="flex items-center gap-2">
          {a.thumb ? <img src={a.thumb} alt="" className="h-9 w-9 shrink-0 rounded object-cover" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-slate-200 text-[9px] text-slate-500">?</span>}
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-700">{a.label}</span>
            {a.missing ? <span className="block text-rose-600">Không thấy {a.id} trong data/archive</span>
              : <span className="block truncate text-slate-500">{a.credit}{a.page && <> · <a href={a.page} target="_blank" rel="noreferrer" className="text-blue-700">nguồn</a></>}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function VideoEditor({ initial, channels, dryRun, cast, imageProvider, videoProvider, archive = {} }: { initial: Video; channels: { platform: string; connected: boolean }[]; dryRun: boolean; cast: { characters: Opt[]; settings: Opt[] }; imageProvider: string; videoProvider: string; archive?: Record<string, ArchiveView> }) {
  const router = useRouter();
  const [v, setV] = useState<Video>(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [plats, setPlats] = useState<string[]>(channels.filter((c) => c.connected).map((c) => c.platform));
  const [ttReady, setTtReady] = useState(false);
  const ttBlocked = plats.includes("tiktok") && !ttReady;
  const running = v.render.state === "running" || v.render.state === "queued";

  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/videos/${v.id}`);
      if (r.ok) { const j = await r.json(); setV((cur) => ({ ...cur, render: j.render, status: j.status })); if (!["running", "queued"].includes(j.render.state)) router.refresh(); }
    }, 2000);
    return () => clearInterval(t);
  }, [running, v.id, router]);

  const patch = (p: Partial<Video>) => { setV({ ...v, ...p }); setDirty(true); };
  const upd = (k: number, p: Partial<Video["scenes"][number]>) => patch({ scenes: v.scenes.map((s, j) => (j === k ? { ...s, ...p } : s)) });

  async function save() {
    setBusy("save");
    const r = await fetch(`/api/videos/${v.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: v.title, caption: v.caption, hashtags: v.hashtags, scenes: v.scenes, tts: v.tts, music: v.music }) });
    setBusy(""); if (r.ok) { setV(await r.json()); setDirty(false); } else alert((await r.json()).error);
  }
  async function render() {
    if (dirty) await save();
    setBusy("render");
    const r = await fetch(`/api/videos/${v.id}/render`, { method: "POST" });
    setBusy(""); if (!r.ok) return alert((await r.json()).error);
    setV({ ...v, render: { state: "queued", progress: 0, log: ["Đã đưa vào hàng đợi"] } });
  }
  async function upload(k: number, f: File) {
    if (dirty) await save();
    const fd = new FormData(); fd.append("file", f);
    setBusy(`up${k}`);
    const r = await fetch(`/api/videos/${v.id}/upload?scene=${k}`, { method: "POST", body: fd });
    setBusy(""); if (r.ok) setV(await r.json()); else alert((await r.json()).error);
  }
  async function genScene(k: number, video = false) {
    if (dirty) await save();
    setBusy(`gen${k}`);
    const r = await fetch(`/api/videos/${v.id}/scene-image?scene=${k}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ video }) });
    setBusy(""); if (r.ok) setV(await r.json()); else alert((await r.json()).error);
  }
  async function action(a: string) {
    const r = await fetch(`/api/videos/${v.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: a }) });
    if (r.ok) { setV(await r.json()); router.refresh(); } else alert((await r.json()).error);
  }
  async function publishNow() {
    if (!confirm(`Đăng ngay lên: ${plats.join(", ")}${dryRun ? " (DRY RUN, không đăng thật)" : ""}?`)) return;
    setBusy("pub");
    const r = await fetch(`/api/videos/${v.id}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platforms: plats }) });
    setBusy(""); const j = await r.json();
    if (!r.ok) return alert(j.error);
    const g = await fetch(`/api/videos/${v.id}`); if (g.ok) setV(await g.json());
    router.refresh();
  }

  const words = v.scenes.reduce((n, s) => n + (s.narration.trim() ? s.narration.trim().split(/\s+/).length : 0), 0);

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="kicker">{v.id} · <Link href={`/y-tuong/${v.ideaId}`} className="underline">ý tưởng</Link> · <Link href={`/y-tuong/canvas/${v.id}`} className="underline">mở canvas nối dây</Link></div>
          <input className="mt-1 w-full bg-transparent text-2xl font-bold focus:outline-none" value={v.title} onChange={(e) => patch({ title: e.target.value })} />
          <p className="text-xs text-slate-500">{v.scenes.length} cảnh · {words} từ · ước tính ~{Math.round(words / 2.6)}s</p>
        </div>
        <div className="flex gap-2">
          <button className="btn" disabled={!dirty || !!busy} onClick={save}>{busy === "save" ? "…" : dirty ? "Lưu thay đổi" : "Đã lưu"}</button>
          <button className="btn-primary" disabled={running || !!busy} onClick={render}>{running ? "Đang render…" : v.render.state === "done" ? "↻ Render lại" : "▶ Render MP4"}</button>
        </div>
      </header>

      <div className="grid grid-cols-[1fr_320px] items-start gap-4">
        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-2 text-sm font-semibold">Nhân vật &amp; bối cảnh</div>
            <CastPicker url={`/api/videos/${v.id}`} characters={cast.characters} settings={cast.settings} characterId={v.characterId} settingId={v.settingId} />
            <p className="mt-2 text-[11px] text-slate-500">Ảnh AI: {imageProvider || "chưa cấu hình (nền gradient)"} · Image-to-video: {videoProvider || "chưa cấu hình (Ken Burns)"}</p>
          </div>
          <div className="card">
            <div className="card-h"><h2 className="text-sm font-semibold">Giọng đọc &amp; nhạc</h2></div>
            <div className="grid grid-cols-3 gap-3 p-4 text-xs">
              <label className="space-y-1"><span className="text-slate-500">Giọng</span>
                <select className="input" value={v.tts.voice} onChange={(e) => patch({ tts: { ...v.tts, voice: e.target.value, engine: (VOICES.find((x) => x.id === e.target.value)?.engine || "vieneu") as "edge" | "vieneu" } })}>
                  {VOICES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="text-slate-500">Tốc độ</span><input className="input" value={v.tts.rate} onChange={(e) => patch({ tts: { ...v.tts, rate: e.target.value } })} /></label>
              <label className="space-y-1"><span className="text-slate-500">Nhạc nền</span>
                <select className="input" value={v.music} onChange={(e) => patch({ music: e.target.value as Video["music"] })}><option value="synth">Nhạc nền tự tổng hợp (miễn phí bản quyền)</option><option value="none">Không nhạc</option></select>
              </label>
            </div>
          </div>
          <div className="card divide-y divide-slate-100">
            <div className="card-h"><h2 className="text-sm font-semibold">Cảnh</h2><button className="text-[11px] font-medium" onClick={() => patch({ scenes: [...v.scenes, { title: "", narration: "" }] })}>+ Thêm cảnh</button></div>
            {v.scenes.map((s, k) => (
              <div key={k} className="grid grid-cols-[90px_1fr] gap-3 p-4">
                <label className="group relative grid h-40 cursor-pointer place-items-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-[10px] text-slate-400">
                  <SceneMedia s={s} archive={archive} placeholder={busy === `up${k}` || busy === `gen${k}` ? "Đang xử lý…" : "+ Ảnh/clip\n(trống = ảnh AI / nền màu)"} />
                  <input type="file" accept="image/*,video/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(k, e.target.files[0])} />
                </label>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2"><span className="font-mono text-xs text-slate-400">{k + 1}</span><input className="input font-semibold" placeholder="Tiêu đề trên màn hình (chữ động)" value={s.title} onChange={(e) => upd(k, { title: e.target.value })} /></div>
                  <textarea className="input min-h-[64px]" placeholder="Lời đọc" value={s.narration} onChange={(e) => upd(k, { narration: e.target.value })} />
                  <input className="input text-xs text-slate-500" placeholder="Prompt ảnh AI (dùng khi không upload)" value={s.visual || ""} onChange={(e) => upd(k, { visual: e.target.value })} />
                  <ArchiveList s={s} archive={archive} />
                  <div className="flex flex-wrap items-center gap-3 text-[11px]">
                    <button className="text-blue-700 disabled:opacity-40" disabled={!imageProvider || !!busy} title={imageProvider ? `IMAGE_PROVIDER=${imageProvider}` : "Chưa cấu hình IMAGE_PROVIDER"} onClick={() => genScene(k)}>✨ Tạo ảnh AI (kèm ref)</button>
                    <select className="rounded border border-slate-200 px-1 py-0.5" value={s.motion || "kenburns"} onChange={(e) => upd(k, { motion: e.target.value as "kenburns" | "video" })}>
                      <option value="kenburns">Chuyển động: Ken Burns</option><option value="video">Chuyển động: image-to-video</option>
                    </select>
                    {s.motion === "video" && <button className="text-blue-700 disabled:opacity-40" disabled={!videoProvider || !s.image || !!busy} title={videoProvider ? `VIDEO_PROVIDER=${videoProvider}` : "Chưa cấu hình VIDEO_PROVIDER"} onClick={() => genScene(k, true)}>▶ Tạo clip</button>}
                    {!s.image && !s.clip && s.archive && <button className="text-slate-500" onClick={() => upd(k, { archive: undefined })}>Bỏ ảnh tư liệu</button>}
                    {(s.image || s.clip) && <button className="text-slate-500" onClick={() => upd(k, { image: undefined, clip: undefined })}>{s.clip ? "Bỏ clip" : "Bỏ ảnh"}</button>}
                    <button className="text-red-500" onClick={() => patch({ scenes: v.scenes.filter((_, j) => j !== k) })}>Xoá cảnh</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="card space-y-2 p-4">
            <h2 className="text-sm font-semibold">Caption &amp; hashtag</h2>
            <textarea className="input min-h-[70px]" value={v.caption} onChange={(e) => patch({ caption: e.target.value })} />
            <input className="input font-mono text-xs" value={v.hashtags.join(" ")} onChange={(e) => patch({ hashtags: e.target.value.split(/\s+/).filter(Boolean) })} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="card-h"><h2 className="text-sm font-semibold">Kết quả render</h2><span className="text-[11px] text-slate-400">{v.render.state}{v.render.duration ? ` · ${v.render.duration.toFixed(1)}s` : ""}</span></div>
            {v.render.state === "done" && v.render.output ? (
              <video key={v.render.finishedAt} src={`/api/media/${v.render.output}?t=${encodeURIComponent(v.render.finishedAt || "")}`} controls className="aspect-[9/16] w-full bg-black" />
            ) : (
              <div className="grid aspect-[9/16] w-full place-items-center bg-slate-900 text-xs text-slate-400">{running ? `Đang render ${Math.round((v.render.progress || 0) * 100)}%` : v.render.state === "error" ? "Render lỗi" : "Chưa có video"}</div>
            )}
            {running && <div className="h-1 bg-slate-100"><div className="h-1 bg-blue-600 transition-all" style={{ width: `${Math.round((v.render.progress || 0) * 100)}%` }} /></div>}
            {(v.render.log?.length || v.render.error) && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-slate-100 bg-slate-50 p-3 font-mono text-[10px] text-slate-600">{[...(v.render.log || []), v.render.error ? `LỖI: ${v.render.error}` : ""].filter(Boolean).join("\n")}</pre>
            )}
          </div>
          <div className="card p-4 text-xs">
            <h2 className="mb-2 text-sm font-semibold">Duyệt &amp; đăng</h2>
            <div className="mb-3 flex gap-2">
              {v.status === "review" && <button className="btn-primary" onClick={() => action("approve")}>✓ Duyệt video (Sẵn sàng)</button>}
              {(v.status === "done" || v.status === "published") && <span className="pill bg-emerald-50 text-emerald-700">{v.status === "published" ? "Đã publish" : "Đã duyệt · chờ lịch"}</span>}
              {v.status === "done" && <Link className="btn" href="/lich-dang">▦ Lên lịch</Link>}
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              {channels.map((c) => (
                <label key={c.platform} className="flex items-center gap-1"><input type="checkbox" checked={plats.includes(c.platform)} onChange={(e) => setPlats(e.target.checked ? [...plats, c.platform] : plats.filter((x) => x !== c.platform))} />{c.platform}</label>
              ))}
            </div>
            {plats.includes("tiktok") && (
              <TikTokPanel key={v.render.finishedAt || "x"} videoId={v.id} caption={[v.caption, (v.hashtags || []).join(" ")].filter(Boolean).join("\n\n")} duration={v.render.duration} renderDone={v.render.state === "done"} onReady={setTtReady} />
            )}
            {ttBlocked && <p className="mb-2 text-amber-700">TikTok: chọn quyền riêng tư và xác nhận ở trên trước khi đăng.</p>}
            <button className="btn w-full justify-center" disabled={v.render.state !== "done" || !plats.length || busy === "pub" || ttBlocked} onClick={publishNow}>{busy === "pub" ? "Đang đăng…" : `Đăng ngay${dryRun ? " (dry run)" : ""}`}</button>
            {v.publish?.length ? (
              <ul className="mt-3 space-y-1 text-[11px]">
                {[...v.publish].reverse().slice(0, 8).map((r, k) => (
                  <li key={k} className={r.ok ? "text-emerald-700" : "text-rose-600"}>{r.ok ? "✓" : "✗"} {r.platform} · {r.via} · {new Date(r.at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}{r.url ? <> · <a className="underline" href={r.url} target="_blank">link</a></> : ""}{r.error ? ` · ${r.error}` : ""}{r.note ? ` · ${r.note}` : ""}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
