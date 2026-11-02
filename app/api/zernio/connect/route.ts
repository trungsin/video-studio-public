import { NextResponse } from "next/server";
import { getProfile, safeSlug } from "@/lib/data";
import { zernioConnectUrl, zernioCtxForProfile } from "@/lib/publishers/zernio";
import { newState, requestOrigin } from "@/lib/youtube-oauth";
import { ZC_COOKIE, ZC_PATH, ZERNIO_CONNECT_PLATFORMS, zernioKeyName } from "@/lib/zernio-connect";

export const dynamic = "force-dynamic";
const back = (q: Record<string, string>) => new NextResponse(null, { status: 303, headers: { Location: `/profile?${new URLSearchParams(q)}`, "cache-control": "no-store" } });

/**
 * Bắt đầu kết nối một tài khoản qua Zernio (chỉ admin: middleware kiểm phiên). Tạo authUrl mới mỗi lần
 * (GET /v1/connect/{platform}) với redirect về /api/zernio/connect/callback, chống giả mạo bằng nonce trong cookie.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const platform = url.searchParams.get("platform") || "";
  if (!ZERNIO_CONNECT_PLATFORMS.includes(platform)) return back({ zc: "error", msg: "Nền tảng không hỗ trợ nối qua Zernio" });
  let p = null;
  try { p = getProfile(safeSlug(url.searchParams.get("profile") || "")); } catch { p = null; }
  if (!p) return back({ zc: "error", platform, msg: "Chưa chọn profile hợp lệ" });
  if (p.sample) return back({ zc: "error", platform, msg: "Profile MẪU không được nối tài khoản thật" });
  const ctx = zernioCtxForProfile(p.slug);
  if (!ctx.env.ZERNIO_API_KEY) return back({ zc: "error", platform, msg: `Chưa có ${zernioKeyName(p.slug)}` });
  const nonce = newState();
  const redirect = `${requestOrigin(req.headers, req.url)}/api/zernio/connect/callback?${new URLSearchParams({ profile: p.slug, platform, n: nonce })}`;
  try {
    const authUrl = await zernioConnectUrl(platform, redirect, ctx);
    const res = NextResponse.redirect(authUrl, 302);
    res.cookies.set(ZC_COOKIE, `${nonce}.${p.slug}.${platform}`, { httpOnly: true, sameSite: "lax", path: ZC_PATH, maxAge: 1800 });
    res.headers.set("cache-control", "no-store");
    return res;
  } catch (e) {
    return back({ zc: "error", platform, msg: (e as Error).message.slice(0, 200) });
  }
}
