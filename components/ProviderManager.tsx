"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProviderView } from "@/lib/provider-store";

type Form = { id: string; label: string; kind: "openai" | "gemini"; baseUrl: string; model: string; size: string; maxRefs: string; note: string; apiKey: string; clearKey: boolean };

const EMPTY: Form = { id: "", label: "", kind: "openai", baseUrl: "", model: "", size: "1024x1536", maxRefs: "", note: "", apiKey: "", clearKey: false };

/** Mẫu điền nhanh. CLIProxyAPI mặc định lắng nghe :8317; trong Docker dùng tên service hoặc host.docker.internal. */
const PRESETS: { name: string; form: Partial<Form> }[] = [
  { name: "CLIProxyAPI · gpt-image-2", form: { id: "cliproxy-gpt", label: "CLIProxyAPI gpt-image-2", kind: "openai", baseUrl: "http://cliproxyapi:8317/v1", model: "gpt-image-2", size: "1024x1536", maxRefs: "4" } },
  { name: "CLIProxyAPI · Gemini image", form: { id: "cliproxy-gemini", label: "CLIProxyAPI Gemini image", kind: "gemini", baseUrl: "http://cliproxyapi:8317/v1beta", model: "gemini-3.1-flash-image", size: "", maxRefs: "4" } },
  { name: "OpenAI", form: { id: "openai-direct", label: "OpenAI gpt-image", kind: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-image-1", size: "1024x1536", maxRefs: "" } },
];

export default function ProviderManager({ initial }: { initial: ProviderView[] }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<Record<string, { state: "run" | "ok" | "err"; text: string; url?: string }>>({});
  const set = (k: keyof Form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  function edit(p: ProviderView) {
    setEditing(p.id);
    setForm({ id: p.id, label: p.label, kind: p.kind, baseUrl: p.baseUrl, model: p.model, size: p.size || "", maxRefs: p.maxRefs === undefined ? "" : String(p.maxRefs), note: p.note || "", apiKey: "", clearKey: false });
    setMsg("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("Đang lưu…");
    const r = await fetch("/api/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, create: !editing }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg(j.error || `Lỗi ${r.status}`);
    setList(j.providers); setForm(EMPTY); setEditing(null); setMsg("Đã lưu ✓"); router.refresh();
  }

  async function remove(id: string) {
    if (!confirm(`Xoá provider "${id}" và khoá API của nó?`)) return;
    const r = await fetch(`/api/providers/${id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return alert(j.error || `Lỗi ${r.status}`);
    setList(j.providers); if (editing === id) { setEditing(null); setForm(EMPTY); }
    router.refresh();
  }

  async function runTest(id: string) {
    setTest((t) => ({ ...t, [id]: { state: "run", text: "Đang sinh ảnh thử (10–60 s)…" } }));
    const r = await fetch(`/api/providers/${id}/test`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const j = await r.json().catch(() => ({}));
    setTest((t) => ({ ...t, [id]: r.ok ? { state: "ok", text: `OK sau ${(j.ms / 1000).toFixed(1)} s`, url: j.url } : { state: "err", text: j.error || `Lỗi ${r.status}` } }));
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_380px]">
      <div className="card">
        <div className="card-h"><h2 className="text-sm font-semibold">Provider ảnh đã thêm</h2><span className="text-[11px] text-slate-500">data/image-providers.json</span></div>
        {list.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">Chưa có provider nào. Thêm ở khung bên phải (có mẫu CLIProxyAPI).</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((p) => {
              const t = test[p.id];
              return (
                <li key={p.id} className="space-y-2 px-4 py-3 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{p.label} <span className="font-mono text-[11px] font-normal text-slate-500">{p.id}</span></div>
                      <div className="mt-0.5 break-all font-mono text-[11px] text-slate-500">{p.kind} · {p.baseUrl} · {p.model}{p.size ? ` · ${p.size}` : ""}{p.maxRefs !== undefined ? ` · ref ≤ ${p.maxRefs}` : ""}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className={`pill ${p.hasKey ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{p.hasKey ? `Khoá ${p.keyMask}` : "Không có khoá"}</span>
                        {p.usedBy.map((s) => <span key={s} className="pill bg-blue-50 text-blue-700">{s}</span>)}
                      </div>
                      {p.note && <p className="mt-1 text-[11px] text-slate-500">{p.note}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button className="btn" disabled={t?.state === "run"} onClick={() => runTest(p.id)}>Thử</button>
                      <button className="btn" onClick={() => edit(p)}>Sửa</button>
                      <button className="btn-danger" onClick={() => remove(p.id)}>Xoá</button>
                    </div>
                  </div>
                  {t && (
                    <div className={`rounded-lg px-2 py-1.5 text-[11px] ${t.state === "err" ? "bg-red-50 text-red-700" : t.state === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-600"}`}>
                      <div className="break-all">{t.text}</div>
                      {t.url && <img src={t.url} alt="Ảnh thử" className="mt-2 h-48 rounded border border-slate-200 object-cover" />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form className="card" onSubmit={save}>
        <div className="card-h"><h2 className="text-sm font-semibold">{editing ? `Sửa ${editing}` : "Thêm provider"}</h2><span className="text-[11px] text-slate-500">{msg}</span></div>
        <div className="space-y-2 p-4 text-xs">
          {!editing && (
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((x) => <button type="button" key={x.name} className="btn" onClick={() => setForm({ ...EMPTY, ...x.form })}>{x.name}</button>)}
            </div>
          )}
          <label className="block">ID <span className="text-slate-400">(a-z, 0-9, -)</span>
            <input className="input font-mono" value={form.id} disabled={!!editing} onChange={(e) => set("id", e.target.value)} placeholder="cliproxy-gpt" required />
          </label>
          <label className="block">Tên hiển thị<input className="input" value={form.label} onChange={(e) => set("label", e.target.value)} /></label>
          <label className="block">Kiểu API
            <select className="input" value={form.kind} onChange={(e) => set("kind", e.target.value)}>
              <option value="openai">OpenAI images (/images/generations, /images/edits)</option>
              <option value="gemini">Gemini generateContent (/models/…:generateContent)</option>
            </select>
          </label>
          <label className="block">Base URL<input className="input font-mono" value={form.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder="http://cliproxyapi:8317/v1" required /></label>
          <label className="block">Model<input className="input font-mono" value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="gpt-image-2" required /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">Kích thước {form.kind === "gemini" && <span className="text-slate-400">(bỏ qua)</span>}
              <input className="input font-mono" value={form.size} onChange={(e) => set("size", e.target.value)} placeholder="1024x1536" />
            </label>
            <label className="block">Số ảnh ref tối đa<input className="input" type="number" min={0} max={16} value={form.maxRefs} onChange={(e) => set("maxRefs", e.target.value)} placeholder="mặc định" /></label>
          </div>
          <label className="block">Khoá API {editing && <span className="text-slate-400">(trống = giữ khoá cũ)</span>}
            <input className="input font-mono" type="password" autoComplete="new-password" value={form.apiKey} onChange={(e) => set("apiKey", e.target.value)} placeholder="sk-… (CLIProxyAPI: một khoá trong api-keys)" />
          </label>
          {editing && <label className="flex items-center gap-2"><input type="checkbox" checked={form.clearKey} onChange={(e) => set("clearKey", e.target.checked)} /> Xoá khoá đã lưu</label>}
          <label className="block">Ghi chú<input className="input" value={form.note} onChange={(e) => set("note", e.target.value)} /></label>
          <div className="flex gap-2 pt-1">
            <button className="btn-primary" disabled={busy}>{editing ? "Lưu" : "Thêm"}</button>
            {editing && <button type="button" className="btn" onClick={() => { setEditing(null); setForm(EMPTY); setMsg(""); }}>Huỷ</button>}
          </div>
          <p className="text-[11px] text-slate-500">Khoá lưu trong file env trên server (biến <code>IMAGE_PROVIDER_KEY__&lt;ID&gt;</code>, quyền 600), không ghi vào data/ hay git. Sau khi thêm, bấm <b>Thử</b> rồi chọn provider ở trang Profile (mục “Ảnh AI cho cảnh”).</p>
        </div>
      </form>
    </div>
  );
}
