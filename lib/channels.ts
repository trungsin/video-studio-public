import type { Channel, Platform } from "./types";

export interface ZernioAccount { _id: string; platform: string; username?: string; displayName?: string; isActive?: boolean }

/**
 * Gộp danh sách tài khoản Zernio vào thẻ kênh của profile.
 * Kênh đã đặt via="direct" (API trực tiếp) được giữ nguyên, không bị chuyển sang Zernio.
 * `direct`: nền tảng mà profile này đăng bằng API trực tiếp (VD facebook qua Meta) -> không bao giờ chuyển sang Zernio.
 * Trả về số kênh đã cập nhật.
 */
export function mergeZernioAccounts(channels: Channel[], accounts: ZernioAccount[], direct: Iterable<Platform> = []): number {
  let n = 0;
  const skip = new Set(direct);
  for (const a of accounts) {
    const plat = a.platform as Platform;
    let ch = channels.find((c) => c.platform === plat);
    if (ch?.via === "direct" || skip.has(plat)) continue;
    if (!ch) { ch = { platform: plat, handle: a.username || "", name: a.displayName || "", connected: false }; channels.push(ch); }
    ch.connected = a.isActive !== false;
    ch.via = "zernio";
    ch.accountId = a._id;
    if (a.username) ch.handle = `@${String(a.username).replace(/^@/, "")}`;
    if (a.displayName) ch.name = a.displayName;
    n++;
  }
  return n;
}
