import { zernioDedicated } from "./channel-config";
import { profileEnvKey } from "./profile-env";

/** Nền tảng cho phép nối qua Zernio từ app (các nền tảng khác đi API trực tiếp). */
export const ZERNIO_CONNECT_PLATFORMS = ["threads", "instagram", "tiktok"];
export const ZC_COOKIE = "vs_zc";
export const ZC_PATH = "/api/zernio/connect";

type Env = Record<string, string | undefined>;

/**
 * Tên biến khoá Zernio của profile: `ZERNIO_API_KEY__<SLUG>` nếu có (workspace riêng),
 * profile trong ZERNIO_DEDICATED_PROFILES luôn dùng `ZERNIO_API_KEY_<SLUG>` (không rơi về khoá chung), còn lại khoá chung.
 */
export function zernioKeyName(slug?: string, env: Env = process.env): string {
  const own = slug ? `ZERNIO_API_KEY__${profileEnvKey(slug)}` : "";
  if (own && env[own]) return own;
  return slug && zernioDedicated(slug, env) ? `ZERNIO_API_KEY_${profileEnvKey(slug)}` : "ZERNIO_API_KEY";
}

/** Env Zernio của profile: khoá riêng kèm `ZERNIO_PROFILE_ID__<SLUG>` (không dùng ZERNIO_PROFILE_ID chung) và `ZERNIO_BASE_URL__<SLUG>` nếu có. */
export function zernioEnvForProfile(slug?: string, env: Env = process.env): Env {
  const name = zernioKeyName(slug, env);
  if (name === "ZERNIO_API_KEY") return env;
  const k = slug ? profileEnvKey(slug) : "";
  return { ...env, ZERNIO_API_KEY: env[name], ZERNIO_BASE_URL: env[`ZERNIO_BASE_URL__${k}`] || env.ZERNIO_BASE_URL,
    ZERNIO_PROFILE_ID: env[`ZERNIO_PROFILE_ID__${k}`] || undefined };
}
