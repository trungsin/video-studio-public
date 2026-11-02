import type { Profile } from "./types";
import { BUILTIN_IMAGE_PROVIDERS, isCustomProvider, listCustomProviders } from "./provider-store";

/** Provider ảnh có sẵn trong worker/media_gen.py; provider tự thêm nằm ở data/image-providers.json. */
export const IMAGE_PROVIDERS = BUILTIN_IMAGE_PROVIDERS;
export const IMAGE_PROVIDER_LABEL: Record<string, string> = {
  gemini: "Gemini (kèm ảnh ref)", quanlop: "Quanlop image2 (chỉ prompt)", openai: "OpenAI-compatible", xai: "xAI Grok Imagine", "hf-kontext": "FLUX Kontext (HF)",
};

const builtin = (x: string) => (IMAGE_PROVIDERS as readonly string[]).includes(x);
export const validImageProvider = (x: unknown): x is string => typeof x === "string" && (builtin(x) || isCustomProvider(x));

/** Danh sách cho ô chọn: có sẵn + tự thêm. */
export const imageProviderOptions = () => [
  ...IMAGE_PROVIDERS.map((id) => ({ id, label: IMAGE_PROVIDER_LABEL[id] || id })),
  ...listCustomProviders().map((p) => ({ id: p.id, label: `${p.label} (${p.kind}, ${p.model})` })),
];

/** Provider ảnh có hiệu lực cho profile: profile.imageProvider > IMAGE_PROVIDER > (IMAGE_BASE_URL ? openai : ""). */
export function imageProviderFor(p?: Pick<Profile, "imageProvider"> | null, env: Record<string, string | undefined> = process.env): string {
  if (p?.imageProvider && validImageProvider(p.imageProvider)) return p.imageProvider;
  return env.IMAGE_PROVIDER || (env.IMAGE_BASE_URL ? "openai" : "");
}

/** Dự phòng khi provider chính lỗi (giống provider_chain trong media_gen.py). */
export function imageFallbackFor(provider: string, env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.IMAGE_FALLBACK;
  const list = raw !== undefined ? raw.split(",").map((s) => s.trim().toLowerCase()) : provider === "quanlop" ? ["gemini"] : [];
  return list.filter((x) => x && x !== "none" && x !== provider);
}

/** Tham số CLI media_gen.py cho profile (chỉ khi profile chọn provider riêng). */
export const providerArgs = (p?: Pick<Profile, "imageProvider"> | null): string[] =>
  p?.imageProvider && validImageProvider(p.imageProvider) ? ["--provider", p.imageProvider] : [];
