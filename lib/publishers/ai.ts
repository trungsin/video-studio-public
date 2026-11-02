import type { Profile, Video } from "../types";

export const DEFAULT_AI_TEXT = "Nội dung minh họa có sử dụng AI.";

/** Ưu tiên: video.aiDisclosure > profile.aiDisclosure.enabled > env AI_DISCLOSURE (mặc định bật). */
export function aiDisclosureOn(v?: Pick<Video, "aiDisclosure"> | null, p?: Pick<Profile, "aiDisclosure"> | null, env: Record<string, string | undefined> = process.env): boolean {
  if (typeof v?.aiDisclosure === "boolean") return v.aiDisclosure;
  if (typeof p?.aiDisclosure?.enabled === "boolean") return p.aiDisclosure.enabled;
  const g = (env.AI_DISCLOSURE ?? "1").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(g);
}

export function aiDisclosureText(p?: Pick<Profile, "aiDisclosure"> | null, env: Record<string, string | undefined> = process.env): string {
  return (p?.aiDisclosure?.text || env.AI_DISCLOSURE_TEXT || DEFAULT_AI_TEXT).trim();
}

/** Thêm dòng khai báo AI vào cuối caption (không thêm lặp nếu đã có). */
export function withAiLine(caption: string, on: boolean, text: string): string {
  const c = caption.trimEnd();
  if (!on || !text) return c;
  if (c.toLowerCase().includes(text.toLowerCase())) return c;
  return c ? `${c}\n\n${text}` : text;
}
