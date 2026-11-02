import { NextResponse } from "next/server";
import { PROFILE_COOKIE } from "@/lib/current";
import { NO_CHANNEL_MSG, saveYtConnection } from "@/lib/youtube-connect";
import {
  exchangeCode, fetchMyChannel, loopbackRedirect, parsePasted, requestOrigin, sameHost, timingSafeEq,
  unpackDesktopState, YT_DESKTOP_COOKIE, YT_DESKTOP_PATH, ytDesktopConfigured,
} from "@/lib/youtube-oauth";

export const dynamic = "force-dynamic";

function done(q: Record<string, string>, slug?: string, clear = true) {
  const res = new NextResponse(null, { status: 303, headers: { Location: `/profile?${new URLSearchParams(q)}`, "cache-control": "no-store" } });
  if (clear) res.cookies.set(YT_DESKTOP_COOKIE, "", { path: YT_DESKTOP_PATH, maxAge: 0 });
  if (slug) res.cookies.set(PROFILE_COOKIE, slug, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return res;
}

/**
 * Nhận URL loopback (hoặc mã) người dùng dán ở /profile, đổi code + PKCE verifier lấy refresh token.
 * Chỉ admin (middleware). Không bao giờ log/hiện token hay code.
 */
export async function POST(req: Request) {
  // Chặn CSRF: form phải gửi từ chính app
  const o = req.headers.get("origin");
  if (o && o !== "null" && !sameHost(requestOrigin(req.headers, req.url), o)) return done({ yt: "error", msg: "Yêu cầu không đến từ app" }, undefined, false);

  const saved = unpackDesktopState(req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${YT_DESKTOP_COOKIE}=([^;]+)`))?.[1]);
  if (!saved) return done({ yt: "error", msg: "Phiên kết nối hết hạn (30 phút). Bấm \"Mở Google để cấp quyền\" lại rồi dán URL mới" });
  const slug = saved.slug;

  let pasted = "";
  try { pasted = String((await req.formData()).get("pasted") || ""); } catch { /* form rỗng */ }
  const p = parsePasted(pasted);
  // Dán sai: giữ cookie để người dùng dán lại
  if (!p) return done({ yt: "error", msg: "Không đọc được URL/mã. Copy cả địa chỉ trên thanh trình duyệt (bắt đầu bằng http://127.0.0.1:8765/?state=...)" }, slug, false);
  if (p.state && !timingSafeEq(p.state, saved.state)) return done({ yt: "error", msg: "URL này thuộc lần cấp quyền khác (state không khớp). Dán URL của lần mở Google gần nhất" }, slug, false);
  if (p.error) return done({ yt: p.error === "access_denied" ? "denied" : "error", msg: p.error.slice(0, 100) }, slug);
  if (!ytDesktopConfigured()) return done({ yt: "no_desktop_client" }, slug);

  try {
    const tok = await exchangeCode(fetch, process.env, p.code!, loopbackRedirect(), {
      clientId: process.env.YT_DESKTOP_CLIENT_ID, clientSecret: process.env.YT_DESKTOP_CLIENT_SECRET, codeVerifier: saved.verifier,
    });
    const channel = await fetchMyChannel(fetch, tok.accessToken);
    if (!channel?.id?.trim()) return done({ yt: "error", msg: NO_CHANNEL_MSG }, slug);
    saveYtConnection(slug, "desktop", tok.refreshToken, channel);
    return done({ yt: "ok", channel: channel.title || "" }, slug);
  } catch (e) {
    // Mã chỉ dùng được 1 lần -> xoá cookie, bắt đầu lại
    return done({ yt: "error", msg: (e as Error).message.slice(0, 200) }, slug);
  }
}
