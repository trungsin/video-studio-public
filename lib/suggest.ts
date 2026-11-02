import { llmConfigured } from "./llm";
import type { FactRow } from "./graph";
import type { Idea, Profile, Scene } from "./types";

export interface Suggestion { scenes: Scene[]; facts: FactRow[]; source: "llm" | "gemini" | "draft"; message: string }

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

/** Gọi LLM (LLM_BASE_URL/LLM_API_KEY, nếu không có thì Gemini qua endpoint tương thích OpenAI). Lỗi -> throw có mã HTTP. */
async function chat(system: string, user: string): Promise<{ json: any; via: "llm" | "gemini" }> {
  const useLlm = llmConfigured();
  const key = useLlm ? process.env.LLM_API_KEY : process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error("Chưa cấu hình LLM (LLM_BASE_URL/LLM_API_KEY) hay GEMINI_API_KEY"), { code: 0 });
  const base = useLlm ? (process.env.LLM_BASE_URL || "").replace(/\/$/, "") : GEMINI_BASE;
  const model = useLlm ? process.env.LLM_MODEL || "gpt-4o-mini" : process.env.GEMINI_TEXT_MODEL || "gemini-3.5-flash-lite";
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 60_000);
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0.7, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!r.ok) throw Object.assign(new Error(`${useLlm ? "LLM" : "Gemini"} HTTP ${r.status}`), { code: r.status });
    const j = await r.json();
    const m = String(j.choices?.[0]?.message?.content || "").match(/\{[\s\S]*\}/);
    if (!m) throw Object.assign(new Error("LLM không trả JSON"), { code: 0 });
    return { json: JSON.parse(m[0]), via: useLlm ? "llm" : "gemini" };
  } finally { clearTimeout(t); }
}

export function explain(e: unknown): string {
  const code = (e as { code?: number }).code;
  if (code === 402) return "Gemini báo 402: hết credit trả trước (AI Studio). Nạp thêm credit hoặc đặt LLM_BASE_URL/LLM_API_KEY khác.";
  if (code === 429) return "LLM báo 429: vượt hạn mức, thử lại sau.";
  if (code === 404) return "LLM báo 404: model không còn (đặt GEMINI_TEXT_MODEL / LLM_MODEL khác).";
  if (code === 401 || code === 403) return "LLM từ chối khoá API (401/403): kiểm tra khoá trong .env.";
  return `Không gọi được LLM: ${(e as Error).message}`;
}

/** Nháp từ dữ liệu ý tưởng (không cần LLM): hook, cảnh theo góc kể, fact theo nguồn trong kế hoạch. */
export function draftFromIdea(i: Idea): Omit<Suggestion, "source" | "message"> {
  const main = (i.plan?.main || i.angle || "").replace(/\s+/g, " ").trim();
  const sents = main.split(/(?<=[.!?])\s+/).filter(Boolean);
  const body = sents.slice(0, 3);
  const scenes: Scene[] = [
    { title: i.title.split(":")[0].slice(0, 40), narration: i.hook || sents[0] || i.title, motion: "video" },
    ...body.map((s, k) => ({ title: k === 0 ? (i.plan?.year || "").slice(0, 30) : "", narration: s })),
    { title: "Bạn nghĩ sao?", narration: "Bạn nghĩ sao? Bình luận nhé. Sử mình hay lắm. Mình là An, hẹn bạn ở trang sử tiếp theo.", motion: "video" },
  ];
  const facts: FactRow[] = sents.slice(0, 4).map((s, k) => ({ claim: s, source: (i.plan?.sources || "").split(/;\s*/)[k] || i.plan?.sources || "", verdict: "chưa kiểm" }));
  return { scenes, facts };
}

export async function suggestScript(p: Profile, i: Idea): Promise<Suggestion> {
  const sys = "Bạn là biên kịch video ngắn 9:16 tiếng Việt cho kênh lịch sử. Không bịa số liệu; mọi khẳng định phải có nguồn chính thống (cơ quan nhà nước, bảo tàng, sử liệu gốc). Chỉ trả về JSON.";
  const user = `KÊNH: ${p.name}\nÝ TƯỞNG: ${i.title}\nHook gợi ý: ${i.hook || ""}\nGóc kể: ${i.angle || ""}\nSeries: ${i.plan?.series || ""}\nThời: ${i.plan?.eraName || ""} (${i.plan?.year || ""})\nNguồn trong kế hoạch: ${i.plan?.sources || ""}\nLưu ý: ${i.plan?.cautionNote || ""}\n\nViết 5-6 cảnh, tổng 120-170 từ lời đọc (số viết bằng chữ). Cảnh 1 là hook do người dẫn An nói; cảnh cuối là CTA ("Bình luận nhé... Mình là An, hẹn bạn ở trang sử tiếp theo."). Mỗi cảnh: title (≤ 6 từ), narration. Kèm danh sách facts cần kiểm: claim, source (tên nguồn), url (nếu chắc chắn), verdict = "chưa kiểm".\nTrả về {"scenes":[{"title":"","narration":""}],"facts":[{"claim":"","source":"","url":"","verdict":"chưa kiểm"}]}`;
  try {
    const { json, via } = await chat(sys, user);
    const scenes: Scene[] = (json.scenes || []).map((s: any) => ({ title: String(s.title || ""), narration: String(s.narration || "") })).filter((s: Scene) => s.narration);
    if (!scenes.length) throw Object.assign(new Error("LLM trả kịch bản rỗng"), { code: 0 });
    scenes[0].motion = "video"; scenes[scenes.length - 1].motion = "video";
    const facts: FactRow[] = (json.facts || []).map((f: any) => ({ claim: String(f.claim || ""), source: String(f.source || ""), verdict: String(f.verdict || "chưa kiểm"), ...(f.url ? { url: String(f.url) } : {}) }));
    return { scenes, facts, source: via, message: `Đã gợi ý bằng ${via === "llm" ? process.env.LLM_MODEL || "LLM" : "Gemini"}: kiểm lại từng fact trước khi dùng.` };
  } catch (e) {
    return { ...draftFromIdea(i), source: "draft", message: `${explain(e)} Đã tạo nháp từ dữ liệu ý tưởng (hook, góc kể, nguồn kế hoạch) để bạn sửa.` };
  }
}
