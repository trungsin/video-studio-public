import type { Platform, PublishResult, TikTokPostSettings } from "../types";

export interface PublishJob {
  /** Đường dẫn tuyệt đối tới MP4 đã render */
  videoPath: string;
  /** URL công khai của chính MP4 này trên CDN (lib/cdn.ts). Có thì Zernio/Facebook/Instagram tự tải từ CDN;
   *  YouTube/TikTok trực tiếp chỉ nhận byte nên vẫn gửi videoPath (cùng nội dung, cùng sha256). */
  videoUrl?: string;
  title: string;
  /** Caption cuối cùng (đã gộp hashtag và dòng khai báo AI nếu bật) */
  caption: string;
  /** FB: bài viết đầy đủ đăng thêm lên Page feed (kênh bản tin) */
  article?: string;
  /** FB: link nguồn, comment vào Reel */
  sourceLinks?: string[];
  platform: Platform;
  /** accountId của Zernio (khi đi qua Zernio) */
  accountId?: string;
  /** Khai báo nội dung AI: bật cờ AI của từng nền tảng (mặc định true) */
  aiGenerated?: boolean;
  /** ISO time: lên lịch phía nền tảng (hiện chỉ Facebook Reels hỗ trợ) */
  scheduleAt?: string;
  /** Cài đặt TikTok của video; consentValid = đã xác nhận đúng bản render hiện tại */
  tiktok?: TikTokPostSettings & { consentValid?: boolean };
  /** Thời lượng video (giây) để so với giới hạn của creator */
  durationSec?: number;
  /** Ghi đè YT_PRIVACY cho lần đăng này (public | unlisted | private) */
  youtubePrivacy?: "public" | "unlisted" | "private";
}

/** Môi trường chạy adapter: tách fetch/env/sleep để dry-run và test không gọi mạng. */
export interface PublishCtx {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  dryRun: boolean;
}

export interface Publisher {
  name: string;
  /** Nền tảng adapter này đăng được */
  supports: (p: Platform) => boolean;
  /** Đã có đủ env/khoá chưa (không gọi mạng) */
  configured: (env?: Record<string, string | undefined>) => boolean;
  publish: (job: PublishJob, ctx?: PublishCtx) => Promise<Omit<PublishResult, "at" | "via">>;
}
