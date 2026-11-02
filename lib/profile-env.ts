import type { Platform } from "./types";
import { ytEnvForProfile } from "./youtube-credentials";

type Env = Record<string, string | undefined>;

/** Hậu tố biến .env theo profile: "kenh-cua-toi" -> "KENH_CUA_TOI" (dùng như `FB_PAGE_ID__KENH_CUA_TOI`). */
export const profileEnvKey = (slug: string) => slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const own = (env: Env, name: string, slug?: string) => {
  const k = slug ? profileEnvKey(slug) : "";
  return k ? env[`${name}__${k}`]?.trim() || undefined : undefined;
};

/**
 * Env đăng trực tiếp `platform` cho `slug`:
 * - facebook: `FB_PAGE_ID__<SLUG>` + `FB_PAGE_TOKEN__<SLUG>` thay Page chung, FB_PROFILE = slug.
 * - instagram: `IG_USER_ID__<SLUG>` + token `IG_ACCESS_TOKEN__<SLUG>` (hoặc `FB_PAGE_TOKEN__<SLUG>`), IG_PROFILE = slug.
 * - youtube: chỉ token của chính profile (ytEnvForProfile).
 * Thiếu cấu hình riêng -> env chung, chủ kết nối vẫn do FB_PROFILE/IG_PROFILE/DIRECT_PROFILE quyết định.
 */
export function directEnvForProfile(platform: Platform, slug: string | undefined, env: Env = process.env): Env {
  if (platform === "youtube") return ytEnvForProfile(slug || "", env);
  if (platform === "facebook") {
    const pageId = own(env, "FB_PAGE_ID", slug), token = own(env, "FB_PAGE_TOKEN", slug);
    return pageId && token ? { ...env, FB_PAGE_ID: pageId, FB_PAGE_TOKEN: token, FB_PROFILE: slug } : env;
  }
  if (platform === "instagram") {
    const igUserId = own(env, "IG_USER_ID", slug);
    const token = own(env, "IG_ACCESS_TOKEN", slug) || own(env, "FB_PAGE_TOKEN", slug);
    // luôn ghi đè IG_ACCESS_TOKEN để không dùng nhầm token chung của profile khác
    return igUserId && token ? { ...env, IG_USER_ID: igUserId, IG_ACCESS_TOKEN: token, IG_PROFILE: slug } : env;
  }
  return env;
}
