/**
 * Cấu hình theo kênh của từng bản triển khai: đọc từ biến môi trường (file env trên máy chủ), không viết cứng slug kênh trong code.
 *
 * - EDITORIAL_PROFILE          slug profile chạy luồng biên tập có nguồn (duyệt số liệu → MOW/Legal → render → tối đa 2 khung/ngày)
 * - EDITORIAL_IDEA_GUIDE       hướng dẫn thêm khi AI sinh ý tưởng cho profile đó (VD các tuyến nội dung luân phiên)
 * - ZERNIO_DEDICATED_PROFILES  slug (phân tách dấu phẩy) bắt buộc dùng khoá Zernio riêng `ZERNIO_API_KEY_<SLUG>`, không rơi về khoá chung
 * - SITE_OWNER, SITE_CHANNEL, SITE_FB_PAGE, SITE_VIDEO_KIND_VI, SITE_VIDEO_KIND_EN   nội dung trang công khai (/, /privacy, /terms)
 */
type Env = Record<string, string | undefined>;

const list = (v?: string) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);

export const editorialProfile = (env: Env = process.env) => (env.EDITORIAL_PROFILE || "").trim();
export const isEditorial = (slug?: string | null, env: Env = process.env) => Boolean(slug) && slug === editorialProfile(env);
export const editorialIdeaGuide = (env: Env = process.env) => (env.EDITORIAL_IDEA_GUIDE || "").trim();

// env truyền vào thường là bản dựng riêng cho một lần đăng (thiếu biến này): khi đó dùng cấu hình của tiến trình.
export const zernioDedicated = (slug?: string | null, env: Env = process.env) =>
  Boolean(slug) && list(env.ZERNIO_DEDICATED_PROFILES ?? process.env.ZERNIO_DEDICATED_PROFILES).includes(slug!);

export function siteInfo(env: Env = process.env) {
  return {
    owner: env.SITE_OWNER?.trim() || "the owner",
    channel: env.SITE_CHANNEL?.trim() || "Video Studio",
    fbPage: env.SITE_FB_PAGE?.trim() || "",
    kindVi: env.SITE_VIDEO_KIND_VI?.trim() || "video ngắn",
    kindEn: env.SITE_VIDEO_KIND_EN?.trim() || "short videos",
  };
}
