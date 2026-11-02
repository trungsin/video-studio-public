import path from "node:path";
import { getProfile, listProfiles, saveProfile } from "./data";
import { upsertEnv } from "./envfile";
import { ytCredentialKey, ytEnvForProfile } from "./youtube-credentials";
import type { YtClientKind } from "./youtube-oauth";

/** Store a verified channel under its profile only; never move or overwrite the legacy owner. */
export function saveYtConnection(slug: string, kind: YtClientKind, refreshToken: string,
  channel: { id?: string; title?: string; customUrl?: string } | null, now = new Date()) {
  if (!channel?.id?.trim()) throw new Error(NO_CHANNEL_MSG);
  const p = getProfile(slug);
  if (!p) throw new Error(`Không tìm thấy profile ${slug}`);
  if (p.sample) throw new Error(`Profile mẫu "${slug}" không nhận kết nối thật`);
  const id = channel.id.trim();
  if (process.env.YT_PROFILE && process.env.YT_PROFILE !== slug &&
    process.env.YT_REFRESH_TOKEN && process.env.YT_CHANNEL_ID === id) {
    throw new Error(`Kênh YouTube này đã kết nối với profile "${process.env.YT_PROFILE}"`);
  }
  for (const other of listProfiles()) {
    if (other.slug !== slug) {
      const credentials = ytEnvForProfile(other.slug);
      if (credentials.YT_REFRESH_TOKEN && credentials.YT_CHANNEL_ID === id) {
        throw new Error(`Kênh YouTube này đã kết nối với profile "${other.slug}"`);
      }
    }
  }
  const updates: Record<string, string> = {
    [ytCredentialKey(slug, "YT_REFRESH_TOKEN")]: refreshToken,
    [ytCredentialKey(slug, "YT_TOKEN_CLIENT")]: kind,
    [ytCredentialKey(slug, "YT_TOKEN_ISSUED_AT")]: now.toISOString(),
    [ytCredentialKey(slug, "YT_CHANNEL_ID")]: id,
  };
  upsertEnv(process.env.ENV_FILE || path.resolve(".env"), updates);
  Object.assign(process.env, updates); // available to the current process; workers read ENV_FILE afresh

  let ch = p.channels.find((c) => c.platform === "youtube");
  if (!ch) { ch = { platform: "youtube", handle: "", name: "", connected: false }; p.channels.push(ch); }
  ch.connected = true;
  ch.via = "direct";
  delete ch.accountId;
  if (channel?.title) ch.name = channel.title;
  if (channel?.customUrl) ch.handle = channel.customUrl.startsWith("@") ? channel.customUrl : `@${channel.customUrl}`;
  saveProfile(p);

  console.log(`[youtube-oauth] connected channel for profile ${slug} via ${kind} client`);
}

export const NO_CHANNEL_MSG = "Tài khoản Google này chưa có kênh YouTube. Tạo kênh (hoặc chọn đúng Brand Account) rồi kết nối lại";
