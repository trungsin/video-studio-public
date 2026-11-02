"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export const VOICES = [
  // VieNeu-TTS v3 Turbo: chạy local trên CPU nếu worker cài `vieneu` (tự căn mốc từ bằng faster-whisper),
  // không thì Gradio (VIENEU_GRADIO_URL), cuối cùng edge-tts.
  { id: "Ngọc Huyền", label: "Ngọc Huyền (VieNeu, nữ Bắc, tự nhiên)", engine: "vieneu" },
  { id: "Trúc Ly", label: "Trúc Ly (VieNeu, nữ Bắc, tự nhiên)", engine: "vieneu" },
  { id: "Mai Anh", label: "Mai Anh (VieNeu, nữ Bắc, tin tức)", engine: "vieneu" },
  { id: "Đoan Trang", label: "Đoan Trang (VieNeu, nữ Bắc, tự nhiên)", engine: "vieneu" },
  { id: "Thùy Dung", label: "Thùy Dung (VieNeu, nữ Nam, tin tức)", engine: "vieneu" },
  { id: "Thục Đoan", label: "Thục Đoan (VieNeu, nữ Nam, kể chuyện)", engine: "vieneu" },
  { id: "Ngọc Trân", label: "Ngọc Trân (VieNeu, nữ Trung, tự nhiên)", engine: "vieneu" },
  { id: "Hải Đăng", label: "Hải Đăng (VieNeu, nam Bắc, tự nhiên)", engine: "vieneu" },
  { id: "Thiện Minh", label: "Thiện Minh (VieNeu, nam Bắc, kể chuyện)", engine: "vieneu" },
  { id: "Quang Sơn", label: "Quang Sơn (VieNeu, nam Trung, tự nhiên)", engine: "vieneu" },
  { id: "Minh Triết", label: "Minh Triết (VieNeu, nam Nam, tin tức)", engine: "vieneu" },
  // edge-tts: dự phòng (có mốc từ chính xác)
  { id: "vi-VN-HoaiMyNeural", label: "Hoài My (nữ, edge-tts)", engine: "edge" },
  { id: "vi-VN-NamMinhNeural", label: "Nam Minh (nam, edge-tts)", engine: "edge" },
];

export default function TtsSettings({ slug, tts, slotTimes }: { slug: string; tts: { engine: string; voice: string; rate: string }; slotTimes: Record<string, string> }) {
  const router = useRouter();
  const [t, setT] = useState(tts);
  const [s, setS] = useState(slotTimes);
  const [saved, setSaved] = useState(false);
  async function save() {
    await fetch(`/api/profiles/${slug}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ section: "meta", op: "update", item: { tts: t, slotTimes: s } }) });
    setSaved(true); setTimeout(() => setSaved(false), 1500); router.refresh();
  }
  return (
    <div className="card">
      <div className="card-h"><h2 className="text-sm font-semibold">Cài đặt giọng &amp; khung giờ</h2><button className="text-[11px] font-medium hover:text-blue-700" onClick={save}>{saved ? "Đã lưu ✓" : "Lưu"}</button></div>
      <div className="grid grid-cols-2 gap-3 p-4 text-xs">
        <label className="space-y-1"><span className="text-slate-500">Giọng mặc định</span>
          <select className="input" value={t.voice} onChange={(e) => { const v = VOICES.find((x) => x.id === e.target.value); setT({ ...t, voice: e.target.value, engine: v?.engine || "vieneu" }); }}>
            {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="text-slate-500">Tốc độ (edge)</span>
          <input className="input" value={t.rate} onChange={(e) => setT({ ...t, rate: e.target.value })} placeholder="+0%" />
        </label>
        {Object.entries({ sang: "Sáng", trua: "Trưa", chieu: "Chiều", toi: "Tối" }).map(([k, l]) => (
          <label key={k} className="space-y-1"><span className="text-slate-500">Khung {l}</span>
            <input type="time" className="input" value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
          </label>
        ))}
      </div>
    </div>
  );
}
