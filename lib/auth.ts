// Dùng Web Crypto để chạy được cả ở middleware (edge) lẫn route handler (node).
export const SESSION_COOKIE = "vs_session";

export async function sessionToken(): Promise<string | null> {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  const secret = process.env.SESSION_SECRET || "video-studio";
  const data = new TextEncoder().encode(`${secret}:${pw}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Chỉ cho phép đường dẫn nội bộ (chặn open redirect: //host, /\\host, URL tuyệt đối). */
export function safeNext(n: string) {
  return /^\/(?![\/\\])[^\s]*$/.test(n) && !n.startsWith("/login") ? n : "/";
}

/**
 * Origin công khai của request sau proxy (tailscale serve http :3100 / https :443).
 * Ưu tiên X-Forwarded-Proto; nếu proxy không gửi: host có cổng hoặc localhost -> http, không cổng -> https (tailscale serve --https=443).
 */
export function publicOrigin(headers: Headers, fallbackUrl?: string): string {
  const first = (v: string | null) => (v || "").split(",")[0].trim();
  const host = first(headers.get("x-forwarded-host")) || first(headers.get("host")) || (fallbackUrl ? new URL(fallbackUrl).host : "");
  if (!host) return "";
  let proto = first(headers.get("x-forwarded-proto"));
  if (!proto) proto = /:\d+$/.test(host) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}
