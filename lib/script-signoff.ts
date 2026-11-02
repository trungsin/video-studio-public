import type { Profile, Scene } from "./types";

/** Câu kết thương hiệu đọc nguyên văn ở cuối video: mục "Câu kết" trong Giọng văn của profile. */
export function profileSignoff(p: Profile | null | undefined): string | undefined {
  const item = p?.sections.voice.find((x) => x.label.trim().toLowerCase() === "câu kết");
  return item?.value.trim() || undefined;
}

/**
 * Nối câu kết vào lời đọc cảnh cuối (sau lời giải/lưu ý), đúng một lần.
 * Câu kết nằm trong kịch bản được duyệt, không chèn ngầm lúc render.
 */
export function withSignoff(scenes: Scene[], signoff: string | undefined): Scene[] {
  const last = scenes.at(-1);
  if (!signoff || !last || last.narration.includes(signoff)) return scenes;
  return [...scenes.slice(0, -1), { ...last, narration: `${last.narration.trim()} ${signoff}`.trim() }];
}
