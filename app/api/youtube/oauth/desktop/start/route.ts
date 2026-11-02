import { NextResponse } from "next/server";
import { connectGuard } from "@/lib/owner";
import { getProfile, safeSlug } from "@/lib/data";
import {
  buildAuthUrl, challengeS256, loopbackRedirect, newState, newVerifier, packDesktopState, requestOrigin,
  YT_DESKTOP_COOKIE, YT_DESKTOP_PATH, ytDesktopConfigured,
} from "@/lib/youtube-oauth";

export const dynamic = "force-dynamic";
const back = (q: string) => new NextResponse(null, { status: 303, headers: { Location: `/profile?${q}` } });

/**
 * Bắt đầu kết nối YouTube bằng Desktop app client (không cần HTTPS). Chỉ admin (middleware kiểm phiên).
 * Lưu state + PKCE verifier trong cookie httpOnly trên chính địa chỉ đang mở app (VD http://video-studio-box:3100),
 * rồi chuyển tới Google với redirect loopback http://127.0.0.1:8765/.
 */
export async function GET(req: Request) {
  if (!ytDesktopConfigured()) return back("yt=no_desktop_client");
  const url = new URL(req.url);
  // Profile phải được chỉ rõ (?profile=) — không tự lấy profile đang chọn, để kết nối thật không rơi nhầm vào profile mẫu
  let p = null;
  try { p = getProfile(safeSlug(url.searchParams.get("profile") || "")); } catch { p = null; }
  const g = connectGuard("youtube", p, { hasToken: false });
  if (!g.ok) return back(`yt=${g.code}${p ? `&profile=${encodeURIComponent(p.slug)}` : ""}`);
  const slug = p!.slug;

  const state = newState(), verifier = newVerifier();
  const res = NextResponse.redirect(buildAuthUrl(process.env.YT_DESKTOP_CLIENT_ID!, loopbackRedirect(), state, challengeS256(verifier)), 302);
  res.cookies.set(YT_DESKTOP_COOKIE, packDesktopState(state, slug, verifier), {
    httpOnly: true, sameSite: "lax", path: YT_DESKTOP_PATH, maxAge: 1800,
    secure: new URL(requestOrigin(req.headers, req.url)).protocol === "https:",
  });
  res.headers.set("cache-control", "no-store");
  return res;
}
