import type { Platform } from "./types";
import { ytConnected } from "./youtube-credentials";

type Env = Record<string, string | undefined>;
const PREFIX: Partial<Record<Platform, string>> = { youtube: "YT", facebook: "FB", instagram: "IG", tiktok: "TIKTOK" };

/**
 * Chủ của token chung trong .env ({YT|FB|IG|TIKTOK}_PROFILE, hoặc DIRECT_PROFILE).
 * Với YouTube chỉ dùng để nhận diện token legacy; token profile riêng không dùng chủ chung.
 */
export function directOwner(platform: Platform, env: Env = process.env): string | undefined {
  const k = PREFIX[platform];
  return (k && env[`${k}_PROFILE`]?.trim()) || env.DIRECT_PROFILE?.trim() || undefined;
}

/**
 * Chặn đăng nhầm kênh thật: YouTube cần token đúng profile; các nền tảng khác cần đúng chủ token chung.
 * Profile mẫu không bao giờ đăng thật. Trả về thông báo lỗi, hoặc null nếu được phép.
 */
export function guardPublish(platform: Platform, profile: { slug: string; sample?: boolean } | null | undefined, direct: boolean, env: Env = process.env): string | null {
  if (!profile) return direct && platform === "youtube" ? "YouTube cần profile để chọn kết nối trực tiếp" : null;
  if (profile.sample && env.PUBLISH_DRY_RUN !== "1") return `Profile mẫu "${profile.slug}" không được đăng thật`;
  if (direct) {
    const owner = directOwner(platform, env);
    if (profile.sample) return `Profile mẫu "${profile.slug}" không dùng kết nối ${platform} thật`;
    if (platform === "youtube") {
      if (ytConnected(profile.slug, env)) return null;
      if (owner && owner !== profile.slug) return `Kết nối ${platform} trực tiếp (.env) thuộc profile "${owner}", không đăng cho "${profile.slug}"`;
      return `Profile "${profile.slug}" chưa kết nối YouTube trực tiếp`;
    }
    if (owner && owner !== profile.slug) return `Kết nối ${platform} trực tiếp (.env) thuộc profile "${owner}", không đăng cho "${profile.slug}"`;
  }
  return null;
}

/** Profile nào được nhận kết nối thật mới: YouTube không chuyển quyền token giữa profiles. */
export function connectGuard(platform: Platform, profile: { slug: string; sample?: boolean } | null | undefined, opts: { hasToken: boolean; move?: boolean }, env: Env = process.env):
  { ok: true } | { ok: false; code: "no_profile" | "sample" | "owned_elsewhere"; owner?: string } {
  if (!profile) return { ok: false, code: "no_profile" };
  if (profile.sample) return { ok: false, code: "sample" };
  if (platform === "youtube") return { ok: true };
  const owner = directOwner(platform, env);
  if (opts.hasToken && owner && owner !== profile.slug && !opts.move) return { ok: false, code: "owned_elsewhere", owner };
  return { ok: true };
}
