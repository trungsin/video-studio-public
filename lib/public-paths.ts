/** Trang công khai (không cần đăng nhập): pháp lý cho Google OAuth + trang giới thiệu. */
export const PUBLIC_PATHS = new Set(["/login", "/api/login", "/privacy", "/terms", "/welcome"]);
export const isPublicPath = (p: string) => PUBLIC_PATHS.has(p.replace(/\/+$/, "") || "/");
