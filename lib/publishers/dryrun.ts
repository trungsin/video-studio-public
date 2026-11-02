import fs from "node:fs";
import { dryCtx } from "./simulate";
import type { Publisher } from "./types";

/**
 * PUBLISH_DRY_RUN=1: chạy đúng adapter thật (facebook/instagram/youtube/tiktok/zernio) nhưng với fetch mô phỏng.
 * Mỗi request (method, URL, header, body; token đã thay bằng <TÊN_BIẾN>) được in ra log, không gọi mạng.
 * Dùng `wrapDry(target)` để chọn adapter sẽ được mô phỏng.
 */
export function wrapDry(target: Publisher | null, env: Record<string, string | undefined> = process.env): Publisher {
  return {
    name: target ? `dry-run:${target.name}` : "dry-run",
    supports: () => true,
    configured: () => true,
    async publish(job) {
      if (!fs.existsSync(job.videoPath)) return { platform: job.platform, ok: false, error: "Không thấy file video" };
      const lines: string[] = [];
      const log = (l: string) => { lines.push(l); console.log(l); };
      if (!target) return { platform: job.platform, ok: true, id: `dry-${Date.now().toString(36)}` };
      log(`[dry-run] ${job.platform} qua ${target.name} (không gọi mạng)`);
      // chưa đồng bộ accountId Zernio thì dùng placeholder để vẫn xem được request
      const j = target.name === "zernio" && !job.accountId ? { ...job, accountId: "<ZERNIO_ACCOUNT_ID>" } : job;
      const r = await target.publish(j, dryCtx(log, env));
      return { ...r, platform: job.platform };
    },
  };
}

export const dryrun = {
  name: "dry-run",
  configured: (env: Record<string, string | undefined> = process.env) => env.PUBLISH_DRY_RUN === "1",
};
