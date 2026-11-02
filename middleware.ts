import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin, SESSION_COOKIE, sessionToken, safeEqual } from "@/lib/auth";
import { isPublicPath } from "@/lib/public-paths";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  // Cron gọi đăng bài bằng Bearer CRON_SECRET
  const cron = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cron && pathname === "/api/publish/run" && auth && safeEqual(auth, `Bearer ${cron}`)) return NextResponse.next();

  const expected = await sessionToken();
  const got = req.cookies.get(SESSION_COOKIE)?.value;
  if (expected && got && safeEqual(got, expected)) return NextResponse.next();

  // "/" khi chưa đăng nhập: trang chủ công khai (Google OAuth cần homepage xem được không cần đăng nhập)
  if (pathname === "/") return NextResponse.rewrite(new URL("/welcome", req.url));
  if (pathname.startsWith("/api/") && !(req.method === "GET" && (pathname === "/api/youtube/oauth/start" || pathname === "/api/youtube/oauth/callback"))) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  // Middleware cần URL tuyệt đối: dựng từ Host/X-Forwarded-* (không dùng req.url = 0.0.0.0 khi chạy sau proxy/Tailscale)
  const next = `${pathname}${req.nextUrl.search}`;
  const loc = next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
  return NextResponse.redirect(`${publicOrigin(req.headers, req.url)}${loc}`);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
