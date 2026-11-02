import type { TikTokPostSettings, Video } from "./types";

export const MUSIC_USAGE_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
export const BRANDED_POLICY_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";
export const CONSENT_TEXT = "Tôi đã xem lại video này và đồng ý đăng lên TikTok. By posting, you agree to TikTok's Music Usage Confirmation.";
export const CONSENT_TEXT_BRANDED = "Tôi đã xem lại video này và đồng ý đăng lên TikTok. By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.";

export const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Công khai (mọi người)",
  MUTUAL_FOLLOW_FRIENDS: "Bạn bè (theo dõi lẫn nhau)",
  FOLLOWER_OF_CREATOR: "Người theo dõi",
  SELF_ONLY: "Chỉ mình tôi",
};

/** Xác nhận còn hiệu lực khi đúng bản render hiện tại. */
export function tiktokConsentValid(v: Pick<Video, "render" | "tiktok">): boolean {
  const t = v.tiktok;
  return Boolean(t?.consentAt && t.privacyLevel && t.consentRender && t.consentRender === (v.render.finishedAt || ""));
}

/** Kiểm tra dữ liệu người dùng gửi lên; trả lỗi tiếng Việt hoặc null. */
export function validateTikTokInput(b: Partial<TikTokPostSettings>, allowed?: string[]): string | null {
  // Zernio yêu cầu privacy_level cả khi gửi bản nháp (TikTok bỏ qua nó trong Creator Inbox)
  if (!b.privacyLevel) return "Chọn quyền riêng tư TikTok (không có mặc định)";
  if (allowed?.length && !allowed.includes(b.privacyLevel)) return `Quyền riêng tư ${b.privacyLevel} không nằm trong các lựa chọn tài khoản cho phép (${allowed.join(", ")})`;
  if (b.commercial === "brand_content" && b.privacyLevel === "SELF_ONLY") return "Branded content visibility cannot be set to private.";
  return null;
}
