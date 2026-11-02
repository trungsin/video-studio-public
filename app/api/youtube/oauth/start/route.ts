import { NextResponse } from "next/server";
import { connectGuard } from "@/lib/owner";
import { getProfile, safeSlug } from "@/lib/data";
import { buildAuthUrl, newState, packState, redirectUriFor, requestOrigin, sameHost, YT_STATE_COOKIE, ytClientConfigured } from "@/lib/youtube-oauth";

export const dynamic = "force-dynamic";
const back = (q: string) => new NextResponse(null, { status: 303, headers: { Location: `/profile?${q}` } });

/** Bắt đầu kết nối YouTube (chỉ admin: middleware đã kiểm phiên đăng nhập). */
export async function GET(req: Request) {
  if (!ytClientConfigured()) return back("yt=no_client");
  const url = new URL(req.url);
  const origin = requestOrigin(req.headers, req.url);
  const redirectUri = redirectUriFor(origin);
  if (!redirectUri) return back("yt=need_https");

  // Profile phải được chỉ rõ (?profile=) — không tự lấy profile đang chọn, để kết nối thật không rơi nhầm vào profile mẫu
  let p = null;
  try { p = getProfile(safeSlug(url.searchParams.get("profile") || "")); } catch { p = null; }
  const g = connectGuard("youtube", p, { hasToken: false });
  if (!g.ok) return back(`yt=${g.code}${p ? `&profile=${encodeURIComponent(p.slug)}` : ""}`);
  const slug = p!.slug;

  // Cookie state phải nằm trên đúng origin của callback: nếu đang mở app qua địa chỉ khác (VD http://...:3100), chuyển sang địa chỉ HTTPS trước
  const target = new URL(redirectUri);
  if (!sameHost(origin, redirectUri)) {
    return NextResponse.redirect(`${target.origin}/api/youtube/oauth/start?profile=${encodeURIComponent(slug)}`, 303);
  }

  const state = newState();
  const res = NextResponse.redirect(buildAuthUrl(process.env.YT_CLIENT_ID!, redirectUri, state), 302);
  res.cookies.set(YT_STATE_COOKIE, packState(state, slug), {
    httpOnly: true, sameSite: "lax", path: "/api/youtube/oauth", maxAge: 600, secure: target.protocol === "https:",
  });
  res.headers.set("cache-control", "no-store");
  return res;
}
